/**
 * ИИ-подбор: фраза на русском превращается в условия, условия в выдачу.
 *
 * Сейчас фразу разбирают правила (src/lib/api/nlu), языковая модель не вызывается.
 * Форма ответа та же, что будет у боевого ассистента: действие, реплика,
 * условия hard/soft, чипы, допущения, уточнение или события с причинами.
 *
 * Три правила, которые не зависят от того, кто разбирает фразу:
 *   1. События и их поля берутся только из каталога. Ничего не дописывается.
 *   2. Жёсткие условия проверяет код. Неизвестная цена или возраст не считаются подходящими.
 *   3. Условия пользователя сами не ослабляются: при пустой выдаче предлагаются варианты с числом.
 */

import { CITIES } from '../../data/dictionaries';
import { loadCatalog } from './db';
import type { Catalog } from './db';
import { computeFacets } from './facets';
import { emptyFilters, occurrenceSortMs, runSearch } from './filters';
import type { SearchFilters, SearchMatch } from './filters';
import { pluralRu } from './format';
import { EXTRA_CATEGORY_LABELS } from './nlu/lexicon';
import { parseMessage } from './nlu/parse';
import type { ParsedMessage } from './nlu/parse';
import { buildAssumptions, buildCaveats, buildChips, buildReasons, scoreMatch } from './nlu/present';
import { DEFAULT_RESULT_LIMIT, MAX_MESSAGE_LENGTH, MAX_RESULT_LIMIT } from './nlu/request';
import {
  applyParsed,
  applyPatch,
  emptyConstraints,
  hasPlace,
  needsChildAge,
  sanitizeConstraints,
  sanitizePatch,
  toEventsQuery,
  toFilters,
} from './nlu/state';
import { buildRelaxations } from './relax';
import { tokenize } from './text';
import { TIMEZONE } from './time';
import type {
  AssistantClarify,
  AssistantRequest,
  AssistantResponse,
  AssistantResult,
  ClarifyCode,
  Constraints,
  Occurrence,
  UnsupportedAction,
} from './types';

const ENGINE = 'rules-mock-v1' as const;

const TEXT = {
  scope:
    'Я помогаю только с афишей: подбираю события по дате, городу, цене и возрасту. Напишите, куда и когда хотите пойти.',
  refuse:
    'Этого я не делаю. Я подбираю события афиши: напишите, куда и когда хотите пойти, и я покажу подходящие.',
  purchase:
    'Купить билеты я не могу: покупка идёт на сайте организатора, кнопка есть в карточке события.',
  booking: 'Забронировать места я не могу: это делается на сайте организатора, ссылка есть в карточке события.',
  nothingNew: 'Новых условий в сообщении не нашёл, оставил прежние.',
  greeting: 'Здравствуйте!',
  askCity: 'В каком городе ищем?',
  askLocation: 'Я не знаю, где вы находитесь. В каком городе ищем?',
  askChildAge: 'Сколько лет ребёнку? От возраста зависит, какие события можно показать.',
  askChildrenAges: 'Сколько лет детям? Назовите возраст каждого: по нему проверю возрастные ограничения.',
  askDate: 'Эта дата уже прошла. На какой день подобрать события?',
  empty: 'По этим условиям событий нет. Ничего не выдумываю: ниже варианты, какое условие изменить.',
  emptyNoOptions: 'По этим условиям событий нет. Попробуйте изменить дату или город.',
} as const;

function eventsWord(count: number): string {
  return pluralRu(count, ['событие', 'события', 'событий']);
}

function isEmpty(constraints: Constraints): boolean {
  return Object.keys(constraints.hard).length === 0 && Object.keys(constraints.soft).length === 0;
}

/** Слова из названий и описаний каталога. */
function buildVocabulary(catalog: Catalog): string[] {
  const words = new Set<string>();
  for (const event of catalog.events) {
    for (const token of tokenize(`${event.title} ${event.description}`)) words.add(token);
  }
  return [...words];
}

/** Города для быстрых ответов: сначала те, где больше событий. */
function cityReplies(catalog: Catalog): string[] {
  const counts = new Map(computeFacets(catalog, emptyFilters()).cities.map((entry) => [entry.id, entry.count]));
  const cities = [...CITIES]
    .sort((a, b) => (counts.get(b.slug) ?? 0) - (counts.get(a.slug) ?? 0))
    .map((city) => city.name.ru);
  return [...cities, 'Вся республика'];
}

function buildClarify(pending: ClarifyCode[], constraints: Constraints, catalog: Catalog): AssistantClarify {
  const code = pending[0];
  if (code === 'date') {
    return { code, pending, question: TEXT.askDate, quick_replies: ['Сегодня', 'Завтра', 'На выходных'] };
  }
  if (code === 'child_age') {
    const count = constraints.hard.participants?.children_count;
    const replies = ['3 года', '5 лет', '7 лет', '10 лет', '14 лет'];
    // О детях известно только из слов «семьёй»: возможно, детей в группе нет.
    if (count === undefined) replies.push('Иду без детей');
    return {
      code,
      pending,
      question: count === 1 ? TEXT.askChildAge : TEXT.askChildrenAges,
      quick_replies: replies,
    };
  }
  return {
    code,
    pending,
    question: code === 'location' ? TEXT.askLocation : TEXT.askCity,
    quick_replies: cityReplies(catalog),
  };
}

/** Лучший сеанс события: ближайший, на который ещё есть билеты. */
function pickOccurrence(match: SearchMatch): Occurrence {
  return match.occurrences.find((occurrence) => occurrence.availability !== 'sold_out') ?? match.primary;
}

function rank(
  matches: readonly SearchMatch[],
  constraints: Constraints,
  filters: SearchFilters,
  today: string,
): { match: SearchMatch; occurrence: Occurrence }[] {
  return matches
    .map((match) => {
      const occurrence = pickOccurrence(match);
      return { match, occurrence, score: scoreMatch(match, occurrence, constraints) };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        occurrenceSortMs(a.occurrence, filters, today) - occurrenceSortMs(b.occurrence, filters, today) ||
        a.match.event.id.localeCompare(b.match.event.id),
    );
}

function unsupportedNote(actions: readonly UnsupportedAction[]): string | null {
  if (actions.includes('purchase')) return TEXT.purchase;
  if (actions.includes('booking')) return TEXT.booking;
  return null;
}

function placeNote(parsed: ParsedMessage | null): string | null {
  if (parsed?.outsideCity) return `Город ${parsed.outsideCity} за пределами афиши: здесь только события Башкортостана.`;
  if (parsed?.notInDemoCity) return `В демо-каталоге пока нет событий в городе ${parsed.notInDemoCity}.`;
  return null;
}

function missingCategoryNote(constraints: Constraints): string | null {
  const missing = (constraints.hard.categories_any ?? []).find((category) => EXTRA_CATEGORY_LABELS[category]);
  return missing ? `Раздела «${EXTRA_CATEGORY_LABELS[missing]}» в афише пока нет.` : null;
}

function join(...parts: (string | null | false | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(' ');
}

/**
 * Отвечает на фразу пользователя или на правку чипа.
 * @param now момент «сейчас»; в тестах передаётся явно.
 */
export function runAssistant(request: AssistantRequest, now: Date = new Date()): AssistantResponse {
  const catalog = loadCatalog(now);
  const today = catalog.today;
  const limit = Math.min(Math.max(1, request.limit ?? DEFAULT_RESULT_LIMIT), MAX_RESULT_LIMIT);
  const base = { reference_date: today, timezone: TIMEZONE, engine: ENGINE };

  let state = request.previous ? sanitizeConstraints(request.previous) : emptyConstraints();
  const patch = request.patch ? sanitizePatch(request.patch) : null;
  if (patch) state = applyPatch(state, patch);

  const message = (request.message ?? '').trim().slice(0, MAX_MESSAGE_LENGTH);
  let parsed: ParsedMessage | null = null;
  let nothingNew = false;

  if (message) {
    parsed = parseMessage(message, {
      today,
      answering: request.answering,
      awaitingChildAge: needsChildAge(state),
      vocabulary: buildVocabulary(catalog),
    });

    const silent = !parsed.understood && !parsed.greeting && !parsed.hasDomainIntent && parsed.unsupported.length === 0;
    if (parsed.injection || parsed.offTopic || (silent && !parsed.thanks && isEmpty(state))) {
      const response: AssistantResponse = {
        action: 'out_of_scope',
        message: parsed.injection ? TEXT.refuse : TEXT.scope,
        constraints: state,
        chips: buildChips(state),
        assumptions: [],
        ...base,
      };
      if (parsed.unsupported.length > 0) response.unsupported_actions = parsed.unsupported;
      return response;
    }

    nothingNew = silent && !isEmpty(state);
    state = applyParsed(state, parsed);
  }

  // Прошедшую дату не подменяем будущей: убираем её и спрашиваем.
  const pending: ClarifyCode[] = [];
  if (parsed?.pastDate) {
    delete state.hard.date;
    pending.push('date');
  }
  // Сначала место, потом возраст ребёнка: так идёт сценарий «город, затем возраст» и ответ на первый вопрос
  // не заставляет повторять второй дословно.
  if (!hasPlace(state)) pending.push(parsed?.nearMe ? 'location' : 'city');
  if (needsChildAge(state)) pending.push('child_age');

  const unsupported = parsed?.unsupported ?? [];
  const prefix = join(
    parsed?.greeting && TEXT.greeting,
    unsupportedNote(unsupported),
    placeNote(parsed),
    nothingNew && TEXT.nothingNew,
  );

  if (pending.length > 0) {
    const clarify = buildClarify(pending, state, catalog);
    const response: AssistantResponse = {
      action: 'clarify',
      message: join(prefix, clarify.question),
      constraints: state,
      chips: buildChips(state),
      assumptions: buildAssumptions(state, today, parsed?.notes ?? [], { searching: false }),
      clarify,
      ...base,
    };
    if (unsupported.length > 0) response.unsupported_actions = unsupported;
    return response;
  }

  const filters = toFilters(state);
  const outcome = runSearch(catalog, filters);
  const ranked = rank(outcome.matches, state, filters, today);
  const total = ranked.length;
  const results: AssistantResult[] = ranked.slice(0, limit).map(({ match, occurrence }) => ({
    event: match.event,
    occurrence_id: occurrence.id,
    reasons: buildReasons(match, occurrence, state, today),
    caveats: buildCaveats(match.event, occurrence),
  }));

  const relaxations = total === 0 ? buildRelaxations(catalog, filters, { allowChildAge: false }) : [];
  let summary: string;
  if (total === 0) {
    summary = join(missingCategoryNote(state), relaxations.length > 0 ? TEXT.empty : TEXT.emptyNoOptions);
  } else if (total > results.length) {
    summary = `Нашлось ${total} ${eventsWord(total)}. Показываю ${results.length}: самые подходящие.`;
  } else {
    summary = `Нашлось ${total} ${eventsWord(total)} по вашим условиям.`;
  }
  const hidden = join(
    outcome.hidden_unknown_price > 0 &&
      `Ещё ${outcome.hidden_unknown_price} не показываю: цена у них не указана.`,
    outcome.hidden_unknown_age > 0 &&
      `Ещё ${outcome.hidden_unknown_age} не показываю: возрастное ограничение у них не указано.`,
  );

  const response: AssistantResponse = {
    action: 'search',
    message: join(prefix, summary, hidden),
    constraints: state,
    chips: buildChips(state),
    assumptions: buildAssumptions(state, today, parsed?.notes ?? [], { searching: true }),
    results,
    total,
    hidden_unknown_price: outcome.hidden_unknown_price,
    hidden_unknown_age: outcome.hidden_unknown_age,
    ...base,
  };
  if (total === 0) response.relaxations = relaxations;
  if (unsupported.length > 0) response.unsupported_actions = unsupported;
  const eventsQuery = toEventsQuery(state);
  if (eventsQuery) response.events_query = eventsQuery;
  return response;
}
