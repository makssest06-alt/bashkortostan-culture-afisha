'use client';

/**
 * Состояние диалога /ask. Сервер его не хранит: условия из последнего ответа
 * уходят в поле previous каждого следующего запроса.
 *
 * Два рода запросов ведут себя по-разному:
 *   - фраза: в ленте появляется индикатор «думает», ответ показывается не раньше короткой паузы;
 *   - правка чипа: чипы меняются сразу, выдача притухает и заменяется без паузы.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react';

import { askAssistant } from '@/lib/api/client';
import type {
  AssistantAction,
  AssistantAssumption,
  AssistantChip,
  AssistantClarify,
  AssistantRequest,
  AssistantResponse,
  AssistantResult,
  Constraints,
  ConstraintsPatch,
  EventsQuery,
  Relaxation,
  UnsupportedAction,
} from '@/lib/api/types';

/** Сколько индикатор «думает» держится минимум: без неё ответ правил мелькает. */
const THINKING_MIN_MS = 450;
const RESULT_LIMIT = 6;
export const MAX_MESSAGE_LENGTH = 500;

export type Turn =
  | { id: number; role: 'user'; text: string }
  /** Правка чипа: короткая служебная строка от имени пользователя. */
  | { id: number; role: 'note'; text: string }
  | {
      id: number;
      role: 'assistant';
      text: string;
      action: AssistantAction;
      unsupported: UnsupportedAction[];
    };

/** Последняя выдача: её показывает рабочая область. */
export interface SearchView {
  results: AssistantResult[];
  total: number;
  relaxations: Relaxation[];
  eventsQuery: EventsQuery | null;
  /** Момент получения ответа: от него считается «проверено N часов назад». */
  receivedAt: number;
}

export type Phase = 'idle' | 'thinking' | 'updating' | 'error';

export interface DialogState {
  turns: Turn[];
  constraints: Constraints | null;
  chips: AssistantChip[];
  assumptions: AssistantAssumption[];
  /** Вопрос, на который ассистент ждёт ответа. */
  clarify: AssistantClarify | null;
  view: SearchView | null;
  /** Сегодняшняя дата афиши из последнего ответа. */
  today: string | null;
  phase: Phase;
  /** Чипы до правки: если запрос не удался, они возвращаются на место. */
  chipsBeforePatch: AssistantChip[] | null;
  nextId: number;
}

/** Первый ответ, полученный на сервере по параметру ?q=. */
export interface InitialExchange {
  query: string;
  response: AssistantResponse;
  receivedAt: number;
}

type Action =
  | { type: 'ask'; text: string }
  | { type: 'patch'; note: string; optimisticChips: AssistantChip[] | null }
  | { type: 'answer'; response: AssistantResponse; receivedAt: number }
  | { type: 'fail' }
  | { type: 'retry' }
  | { type: 'reset' };

const EMPTY: DialogState = {
  turns: [],
  constraints: null,
  chips: [],
  assumptions: [],
  clarify: null,
  view: null,
  today: null,
  phase: 'idle',
  chipsBeforePatch: null,
  nextId: 1,
};

function applyResponse(state: DialogState, response: AssistantResponse, receivedAt: number): DialogState {
  const turn: Turn = {
    id: state.nextId,
    role: 'assistant',
    text: response.message,
    action: response.action,
    unsupported: response.unsupported_actions ?? [],
  };
  const next: DialogState = {
    ...state,
    turns: [...state.turns, turn],
    constraints: response.constraints,
    chips: response.chips,
    assumptions: response.assumptions,
    today: response.reference_date,
    phase: 'idle',
    chipsBeforePatch: null,
    nextId: state.nextId + 1,
  };
  if (response.action === 'search') {
    next.clarify = null;
    next.view = {
      results: response.results ?? [],
      total: response.total ?? 0,
      relaxations: response.relaxations ?? [],
      eventsQuery: response.events_query ?? null,
      receivedAt,
    };
  } else if (response.action === 'clarify') {
    // Условий не хватает: прежняя выдача к ним уже не относится.
    next.clarify = response.clarify ?? null;
    next.view = null;
  }
  // out_of_scope условий не меняет: вопрос и выдача остаются как были.
  return next;
}

function reducer(state: DialogState, action: Action): DialogState {
  switch (action.type) {
    case 'ask':
      return {
        ...state,
        turns: [...state.turns, { id: state.nextId, role: 'user', text: action.text }],
        phase: 'thinking',
        nextId: state.nextId + 1,
      };
    case 'patch':
      return {
        ...state,
        turns: [...state.turns, { id: state.nextId, role: 'note', text: action.note }],
        chips: action.optimisticChips ?? state.chips,
        chipsBeforePatch: action.optimisticChips ? state.chips : null,
        phase: 'updating',
        nextId: state.nextId + 1,
      };
    case 'answer':
      return applyResponse(state, action.response, action.receivedAt);
    case 'fail':
      // Условия на сервере не поменялись: возвращаем чипы, которые убрали заранее.
      return { ...state, chips: state.chipsBeforePatch ?? state.chips, chipsBeforePatch: null, phase: 'error' };
    case 'retry':
      return { ...state, phase: 'thinking' };
    case 'reset':
      return EMPTY;
  }
}

function initialState(initial: InitialExchange | null): DialogState {
  if (!initial) return EMPTY;
  const asked = reducer(EMPTY, { type: 'ask', text: initial.query });
  return applyResponse(asked, initial.response, initial.receivedAt);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export interface AskDialog {
  state: DialogState;
  /** Диалог начат: есть хотя бы одна реплика. */
  started: boolean;
  busy: boolean;
  /** Отправить фразу. Возвращает false, если отправлять нечего или идёт запрос. */
  send: (text: string) => boolean;
  /** Правка условий без текста. note попадает в ленту, optimisticChips сразу заменяет чипы. */
  applyPatch: (patch: ConstraintsPatch, note: string, optimisticChips?: AssistantChip[]) => void;
  retry: () => void;
  reset: () => void;
}

export function useAskDialog(initial: InitialExchange | null, pendingQuery: string | null = null): AskDialog {
  const [state, dispatch] = useReducer(reducer, initial, initialState);
  const latest = useRef(state);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const lastRequest = useRef<{ payload: AssistantRequest; minDelay: number } | null>(null);
  const autoSent = useRef(false);

  useEffect(() => {
    latest.current = state;
  }, [state]);

  const run = useCallback(async (payload: AssistantRequest, minDelay: number) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    sequence.current += 1;
    const ticket = sequence.current;
    lastRequest.current = { payload, minDelay };

    try {
      const [response] = await Promise.all([
        askAssistant(payload, { signal: abort.signal }),
        minDelay > 0 ? wait(minDelay) : Promise.resolve(),
      ]);
      if (ticket !== sequence.current) return;
      dispatch({ type: 'answer', response, receivedAt: Date.now() });
    } catch (error) {
      if (abort.signal.aborted || ticket !== sequence.current) return;
      console.warn('[ask] запрос к ассистенту не удался', error);
      dispatch({ type: 'fail' });
    }
  }, []);

  const send = useCallback(
    (raw: string): boolean => {
      const text = raw.trim().slice(0, MAX_MESSAGE_LENGTH);
      const current = latest.current;
      if (!text || current.phase === 'thinking' || current.phase === 'updating') return false;
      dispatch({ type: 'ask', text });
      const payload: AssistantRequest = { message: text, limit: RESULT_LIMIT };
      if (current.constraints) payload.previous = current.constraints;
      if (current.clarify) payload.answering = current.clarify.code;
      void run(payload, THINKING_MIN_MS);
      return true;
    },
    [run],
  );

  const applyPatch = useCallback(
    (patch: ConstraintsPatch, note: string, optimisticChips?: AssistantChip[]) => {
      const current = latest.current;
      if (current.phase === 'thinking' || current.phase === 'updating') return;
      dispatch({ type: 'patch', note, optimisticChips: optimisticChips ?? null });
      const payload: AssistantRequest = { patch, limit: RESULT_LIMIT };
      if (current.constraints) payload.previous = current.constraints;
      void run(payload, 0);
    },
    [run],
  );

  const retry = useCallback(() => {
    const request = lastRequest.current;
    if (!request || latest.current.phase !== 'error') return;
    dispatch({ type: 'retry' });
    void run(request.payload, request.minDelay);
  }, [run]);

  const reset = useCallback(() => {
    controller.current?.abort();
    sequence.current += 1;
    lastRequest.current = null;
    dispatch({ type: 'reset' });
  }, []);

  // Запасной путь для ?q=: сервер не смог ответить сам, фразу отправляет браузер.
  useEffect(() => {
    if (!pendingQuery || autoSent.current) return;
    autoSent.current = true;
    send(pendingQuery);
  }, [pendingQuery, send]);

  return {
    state,
    started: state.turns.length > 0,
    busy: state.phase === 'thinking' || state.phase === 'updating',
    send,
    applyPatch,
    retry,
    reset,
  };
}
