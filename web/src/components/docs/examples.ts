/**
 * Настоящие примеры для страницы /developers.
 *
 * Запрос уходит в те же обработчики, что отвечают по адресу /api/v1 (вызов функции, без сети),
 * поэтому в примере стоит ровно то, что получит разработчик: код ответа, заголовки и тело.
 * Даты в демонстрационном каталоге считаются от «сегодня», и пример всегда свежий.
 * Модуль серверный: в клиентские компоненты его не импортировать.
 */

import { GET as getEventById } from '@/app/api/v1/events/[id]/route';
import { GET as getEvents, OPTIONS as optionsEvents } from '@/app/api/v1/events/route';
import { POST as postAssistant } from '@/app/api/v1/assistant/query/route';
import { GET as getDictionaries } from '@/app/api/v1/dictionaries/route';
import { GET as getFacets } from '@/app/api/v1/facets/route';
import { GET as getHealth } from '@/app/api/v1/health/route';
import { GET as getIndex } from '@/app/api/v1/route';

/** Адрес нужен только конструктору Request: обработчики читают из него путь и параметры. */
const INTERNAL_ORIGIN = 'http://afisha.internal';

export type ApiExample = {
  method: 'GET' | 'POST' | 'OPTIONS';
  /** Путь с параметрами: /api/v1/events?city=ufa */
  path: string;
  /** Тело запроса, разложенное по строкам. Только у POST. */
  requestBody?: string;
  status: number;
  /** Тело ответа, разложенное по строкам. Пустая строка, если тела нет. */
  body: string;
  /** Тело ответа как значение: чтобы взять из него идентификатор или условия для следующего запроса. */
  value: unknown;
  lines: number;
  headers: Record<string, string>;
};

async function toExample(
  method: ApiExample['method'],
  path: string,
  response: Response,
  requestBody?: string,
): Promise<ApiExample> {
  const text = await response.text();
  let value: unknown = null;
  let body = text;
  if (text) {
    try {
      value = JSON.parse(text);
      body = JSON.stringify(value, null, 2);
    } catch {
      body = text;
    }
  }
  const headers: Record<string, string> = {};
  response.headers.forEach((headerValue, name) => {
    headers[name.toLowerCase()] = headerValue;
  });
  return { method, path, requestBody, status: response.status, body, value, lines: body ? body.split('\n').length : 0, headers };
}

/** Пример не должен ронять страницу: при сбое блока просто не будет. */
async function attempt(run: () => Promise<ApiExample>): Promise<ApiExample | null> {
  try {
    return await run();
  } catch (error) {
    console.error('[developers] пример ответа не собран', error);
    return null;
  }
}

function get(path: string, handler: (request: Request) => Response | Promise<Response>): Promise<ApiExample | null> {
  return attempt(async () => toExample('GET', path, await handler(new Request(`${INTERNAL_ORIGIN}${path}`))));
}

function getEvent(id: string): Promise<ApiExample | null> {
  const path = `/api/v1/events/${id}`;
  return attempt(async () =>
    toExample(
      'GET',
      path,
      await getEventById(new Request(`${INTERNAL_ORIGIN}${path}`), { params: Promise.resolve({ id }) }),
    ),
  );
}

function post(path: string, payload: unknown): Promise<ApiExample | null> {
  const requestBody = JSON.stringify(payload, null, 2);
  return attempt(async () =>
    toExample(
      'POST',
      path,
      await postAssistant(
        new Request(`${INTERNAL_ORIGIN}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      ),
      requestBody,
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Запросы, которые в демонстрационном каталоге обычно ничего не находят: берём первый с пустой выдачей. */
const EMPTY_CANDIDATES = [
  '/api/v1/events?city=sibay&date=today',
  '/api/v1/events?city=kumertau&date=today',
  '/api/v1/events?city=beloretsk&date=tomorrow',
  '/api/v1/events?city=sibay&category=festival&free=1',
  '/api/v1/events?city=kumertau&category=excursion&date=today',
];

async function findEmptyExample(): Promise<ApiExample | null> {
  for (const path of EMPTY_CANDIDATES) {
    const example = await get(path, getEvents);
    if (!example || !isRecord(example.value)) continue;
    const { total, relaxations } = example.value;
    if (total === 0 && Array.isArray(relaxations) && relaxations.length > 0) return example;
  }
  return null;
}

export const ASSISTANT_PATH = '/api/v1/assistant/query';
export const ASSISTANT_FIRST_MESSAGE = 'куда пойти в субботу с ребёнком до 1000 ₽';
export const ASSISTANT_FOLLOW_UP = 'в Уфе, 7 лет';

export type ApiExamples = {
  events: ApiExample | null;
  eventsEmpty: ApiExample | null;
  event: ApiExample | null;
  eventNotFound: ApiExample | null;
  facets: ApiExample | null;
  dictionaries: ApiExample | null;
  assistantClarify: ApiExample | null;
  assistantSearch: ApiExample | null;
  health: ApiExample | null;
  index: ApiExample | null;
  validationError: ApiExample | null;
  preflight: ApiExample | null;
};

export async function loadApiExamples(): Promise<ApiExamples> {
  const [events, eventsEmpty, eventNotFound, facets, dictionaries, assistantClarify, health, index, validationError, preflight] =
    await Promise.all([
      get('/api/v1/events?city=ufa&date=weekend&price_max=1000&age=7&page_size=1', getEvents),
      findEmptyExample(),
      getEvent('none'),
      get('/api/v1/facets?date=weekend&audience=kids', getFacets),
      get('/api/v1/dictionaries', getDictionaries),
      post(ASSISTANT_PATH, { message: ASSISTANT_FIRST_MESSAGE }),
      get('/api/v1/health', getHealth),
      get('/api/v1', getIndex),
      get('/api/v1/events?city=moscow', getEvents),
      attempt(async () => toExample('OPTIONS', '/api/v1/events', optionsEvents())),
    ]);

  // Карточка: событие из первого примера. Если выходные пусты, берём ближайшее событие каталога.
  let eventId: string | null = null;
  for (const source of [events, await get('/api/v1/events?page_size=1', getEvents)]) {
    if (eventId || !source || !isRecord(source.value) || !Array.isArray(source.value.items)) continue;
    const firstItem: unknown = source.value.items[0];
    if (isRecord(firstItem) && typeof firstItem.id === 'string') eventId = firstItem.id;
  }
  const event = eventId ? await getEvent(eventId) : null;

  // Второй шаг диалога: ответ на уточнение вместе с условиями из первого ответа.
  let assistantSearch: ApiExample | null = null;
  if (assistantClarify && isRecord(assistantClarify.value) && isRecord(assistantClarify.value.constraints)) {
    const clarify = assistantClarify.value.clarify;
    assistantSearch = await post(ASSISTANT_PATH, {
      message: ASSISTANT_FOLLOW_UP,
      ...(isRecord(clarify) && typeof clarify.code === 'string' ? { answering: clarify.code } : {}),
      limit: 1,
      previous: assistantClarify.value.constraints,
    });
  }

  return {
    events,
    eventsEmpty,
    event,
    eventNotFound,
    facets,
    dictionaries,
    assistantClarify,
    assistantSearch,
    health,
    index,
    validationError,
    preflight,
  };
}

/** Команда curl для примера. Адрес сайта подставляется тот, по которому открыта страница. */
export function curlOf(example: Pick<ApiExample, 'method' | 'path' | 'requestBody'>, origin: string): string {
  const url = `"${origin}${example.path}"`;
  if (example.method === 'GET') return `curl ${url}`;
  if (example.method === 'OPTIONS') return `curl -i -X OPTIONS ${url}`;
  const body = (example.requestBody ?? '{}').replace(/'/g, "'\\''");
  return `curl -X POST ${url} \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`;
}
