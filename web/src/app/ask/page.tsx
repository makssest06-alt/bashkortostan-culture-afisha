import type { Metadata } from 'next';

import { AskExperience } from '@/components/ask/AskExperience';
import type { InitialExchange } from '@/components/ask/useAskDialog';
import { DEFAULT_RESULT_LIMIT, MAX_MESSAGE_LENGTH } from '@/lib/api/nlu/request';
import { assistantDisabled } from '@/lib/api/assistant-availability';
import { askAssistant } from '@/lib/api/server';
import { getServerT } from '@/lib/i18n/server';

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT();
  return { title: t('ask.metaTitle'), description: t('ask.subtitle') };
}

/** Фраза из адреса: /ask?q=куда+пойти+в+субботу. Пустая строка и мусор дают null. */
function readQuery(raw: SearchParams): string | null {
  const value = Array.isArray(raw.q) ? raw.q[0] : raw.q;
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH);
  return text || null;
}

type Start = {
  initial: InitialExchange | null;
  /** Сервер не смог ответить: ту же фразу отправит браузер и покажет ошибку с повтором. */
  pendingQuery: string | null;
};

async function loadStart(raw: SearchParams): Promise<Start> {
  const query = readQuery(raw);
  if (!query) return { initial: null, pendingQuery: null };
  // ИИ выключен на сервере или в демо (?ai=off): фразу отправит браузер и сразу перейдёт на обычный поиск.
  if (assistantDisabled() || raw.ai === 'off') return { initial: null, pendingQuery: query };
  try {
    const response = await askAssistant({ message: query, limit: DEFAULT_RESULT_LIMIT });
    return { initial: { query, response, receivedAt: Date.now() }, pendingQuery: null };
  } catch (error) {
    console.error('[ask] первый ответ на сервере не получен', error);
    return { initial: null, pendingQuery: query };
  }
}

/**
 * ИИ-подбор. Фраза из параметра ?q= уходит ассистенту сразу: первый ответ (вопрос
 * или подборка) собирается на сервере и приходит вместе со страницей.
 * Дальше диалог живёт в браузере и ходит в POST /api/v1/assistant/query.
 */
export default async function AskPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { initial, pendingQuery } = await loadStart(await searchParams);
  return <AskExperience initial={initial} pendingQuery={pendingQuery} />;
}
