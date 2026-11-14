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

import { ApiClientError, askAssistant, confirmAssistantAction } from '@/lib/api/client';
import { keywordFilters, mergeQueries } from '@/lib/api/keyword-filters';
import { browserUserRef } from '@/lib/api/user-ref';
import type {
  AssistantAction,
  AssistantAssumption,
  AssistantChip,
  AssistantClarify,
  AssistantConfirmation,
  AssistantHistoryItem,
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
/** Сколько ждём ассистента, прежде чем перейти на обычный поиск (п. 9.2: p95 ответа агента не больше 8 с). */
const ASSISTANT_TIMEOUT_MS = 8000;
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

/**
 * Резервный режим (п. 7.5): ассистент не ответил, и вместо него работает обычный поиск
 * по каталогу. Условия берутся из прежнего диалога и явных слов последней фразы.
 */
export interface FallbackView {
  query: EventsQuery;
  /** Фраза, на которую ассистент не ответил. */
  text: string;
}

export interface DialogState {
  turns: Turn[];
  constraints: Constraints | null;
  chips: AssistantChip[];
  assumptions: AssistantAssumption[];
  /** Вопрос, на который ассистент ждёт ответа. */
  clarify: AssistantClarify | null;
  /** Запрос подтверждения мутирующего действия (подписка/заявка). */
  confirmation: AssistantConfirmation | null;
  view: SearchView | null;
  /** Сегодняшняя дата афиши из последнего ответа. */
  today: string | null;
  phase: Phase;
  /** Чипы до правки: если запрос не удался, они возвращаются на место. */
  chipsBeforePatch: AssistantChip[] | null;
  /** Ассистент недоступен: показывается обычный поиск. */
  fallback: FallbackView | null;
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
  | { type: 'confirming' }
  | { type: 'confirmDone'; text: string }
  | { type: 'fail' }
  | { type: 'fallback'; query: EventsQuery; text: string; note: string }
  | { type: 'fallbackQuery'; query: EventsQuery }
  | { type: 'retry' }
  | { type: 'reset' };

const EMPTY: DialogState = {
  turns: [],
  constraints: null,
  chips: [],
  assumptions: [],
  clarify: null,
  confirmation: null,
  view: null,
  today: null,
  phase: 'idle',
  chipsBeforePatch: null,
  fallback: null,
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
    confirmation: response.action === 'confirmation_required' ? (response.confirmation ?? null) : null,
    today: response.reference_date,
    phase: 'idle',
    chipsBeforePatch: null,
    fallback: null,
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
  } else if (response.action === 'confirmation_required') {
    next.clarify = null;
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
    case 'confirming':
      return { ...state, phase: 'updating' };
    case 'confirmDone':
      return {
        ...state,
        turns: [...state.turns, { id: state.nextId, role: 'assistant', text: action.text, action: 'search', unsupported: [] }],
        confirmation: null,
        phase: 'idle',
        nextId: state.nextId + 1,
      };
    case 'fail':
      // Условия на сервере не поменялись: возвращаем чипы, которые убрали заранее.
      return { ...state, chips: state.chipsBeforePatch ?? state.chips, chipsBeforePatch: null, phase: 'error' };
    case 'fallback':
      return {
        ...state,
        turns: [
          ...state.turns,
          { id: state.nextId, role: 'assistant', text: action.note, action: 'search', unsupported: [] },
        ],
        chips: state.chipsBeforePatch ?? state.chips,
        chipsBeforePatch: null,
        clarify: null,
        phase: 'idle',
        fallback: { query: action.query, text: action.text },
        nextId: state.nextId + 1,
      };
    case 'fallbackQuery':
      return state.fallback ? { ...state, fallback: { ...state.fallback, query: action.query } } : state;
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
  /** Подтвердить или отменить действие ассистента (подписка/заявка). */
  confirmAction: (decision: 'approve' | 'reject') => void;
  retry: () => void;
  reset: () => void;
  /** Правка фильтров обычного поиска в резервном режиме. */
  setFallbackQuery: (query: EventsQuery) => void;
}

export interface AskDialogOptions {
  /** Демо-переключатель: запросы уходят с пометкой «ассистент недоступен». */
  aiOff: boolean;
  /** Реплика в ленте при переходе на обычный поиск. */
  fallbackNote: string;
}

/** Отказ ассистента, после которого включается обычный поиск: недоступен, сбой сервера, нет сети, тайм-аут. */
function isOutage(error: unknown, timedOut: boolean): boolean {
  if (timedOut) return true;
  return error instanceof ApiClientError && (error.status === 0 || error.status >= 500);
}

export function useAskDialog(
  initial: InitialExchange | null,
  pendingQuery: string | null = null,
  options: AskDialogOptions = { aiOff: false, fallbackNote: '' },
): AskDialog {
  const [state, dispatch] = useReducer(reducer, initial, initialState);
  const latest = useRef(state);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const lastRequest = useRef<{ payload: AssistantRequest; minDelay: number } | null>(null);
  const autoSent = useRef(false);
  const settings = useRef(options);

  useEffect(() => {
    latest.current = state;
  }, [state]);

  useEffect(() => {
    settings.current = options;
  }, [options]);

  const run = useCallback(async (payload: AssistantRequest, minDelay: number) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    sequence.current += 1;
    const ticket = sequence.current;
    lastRequest.current = { payload, minDelay };
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, ASSISTANT_TIMEOUT_MS);
    const { aiOff, fallbackNote } = settings.current;

    try {
      const [response] = await Promise.all([
        askAssistant(payload, { signal: abort.signal, headers: aiOff ? { 'X-Assistant-Demo': 'unavailable' } : undefined }),
        minDelay > 0 ? wait(minDelay) : Promise.resolve(),
      ]);
      if (ticket !== sequence.current) return;
      dispatch({ type: 'answer', response, receivedAt: Date.now() });
    } catch (error) {
      if ((abort.signal.aborted && !timedOut) || ticket !== sequence.current) return;
      console.warn('[ask] запрос к ассистенту не удался', error);
      if (isOutage(error, timedOut)) {
        // Ассистент недоступен: сразу показываем обычный поиск с условиями диалога и словами фразы (п. 7.5).
        const current = latest.current;
        const base = current.fallback?.query ?? current.view?.eventsQuery ?? null;
        const words = payload.message ? keywordFilters(payload.message) : {};
        dispatch({ type: 'fallback', query: mergeQueries(base, words), text: payload.message ?? '', note: fallbackNote });
        return;
      }
      dispatch({ type: 'fail' });
    } finally {
      window.clearTimeout(timer);
    }
  }, []);

  const send = useCallback(
    (raw: string): boolean => {
      const text = raw.trim().slice(0, MAX_MESSAGE_LENGTH);
      const current = latest.current;
      if (!text || current.phase === 'thinking' || current.phase === 'updating') return false;
      dispatch({ type: 'ask', text });
      const history: AssistantHistoryItem[] = current.turns
        .filter((t): t is Extract<Turn, { role: 'user' | 'assistant' }> => t.role === 'user' || t.role === 'assistant')
        .slice(-8)
        .map((t) => ({ role: t.role, content: t.text }));
      const payload: AssistantRequest = {
        message: text,
        limit: RESULT_LIMIT,
        channel: 'web',
        user_ref: browserUserRef(),
      };
      if (history.length > 0) payload.history = history;
      if (current.constraints) payload.previous = current.constraints;
      if (current.clarify) payload.answering = current.clarify.code;
      void run(payload, THINKING_MIN_MS);
      return true;
    },
    [run],
  );

  const confirmAction = useCallback(async (decision: 'approve' | 'reject') => {
    const current = latest.current;
    const pending = current.confirmation;
    if (!pending || current.phase === 'thinking' || current.phase === 'updating') return;
    dispatch({ type: 'confirming' });
    try {
      const res = await confirmAssistantAction({
        confirmation_id: pending.confirmation_id,
        user_ref: browserUserRef(),
        confirm: decision === 'approve',
        decision,
      });
      const fallbackText = decision === 'approve' ? 'Готово: действие выполнено.' : 'Действие отменено.';
      dispatch({ type: 'confirmDone', text: res.message ?? fallbackText });
    } catch (error) {
      console.warn('[ask] подтверждение действия не удалось', error);
      dispatch({ type: 'fail' });
    }
  }, []);

  const applyPatch = useCallback(
    (patch: ConstraintsPatch, note: string, optimisticChips?: AssistantChip[]) => {
      const current = latest.current;
      if (current.phase === 'thinking' || current.phase === 'updating') return;
      dispatch({ type: 'patch', note, optimisticChips: optimisticChips ?? null });
      const payload: AssistantRequest = {
        patch,
        limit: RESULT_LIMIT,
        user_ref: browserUserRef(),
      };
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

  const setFallbackQuery = useCallback((query: EventsQuery) => dispatch({ type: 'fallbackQuery', query }), []);

  return {
    state,
    started: state.turns.length > 0,
    busy: state.phase === 'thinking' || state.phase === 'updating',
    send,
    applyPatch,
    confirmAction,
    retry,
    reset,
    setFallbackQuery,
  };
}
