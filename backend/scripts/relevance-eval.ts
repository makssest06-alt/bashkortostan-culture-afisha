import { runDeterministicAssistant, type Constraints } from '../src/domain/assistant/nlu.js';
import type { ToolRuntime } from '../src/domain/assistant/tools.js';
import { runCatalogSearch, toListItem, type EventsSearchFilters } from '../src/domain/search.js';
import type { ApiEvent, ApiEventListItem } from '../src/domain/types.js';

export interface RelevanceRow {
  id: string;
  query: string;
  reference_now: string;
  timezone: string;
  previous?: Constraints;
  expected_hard?: Constraints['hard'];
  qrels: Record<string, number>;
}

/** Qrels are exhaustive for the fixed catalog; unjudged IDs score zero. */
export function scoreRanking(ids: string[], qrels: Record<string, number>, k = 5) {
  const ranked = ids.slice(0, k);
  const gains = ranked.map((id, i) => (2 ** (qrels[id] ?? 0) - 1) / Math.log2(i + 2));
  const ideal = Object.values(qrels).sort((a, b) => b - a).slice(0, k)
    .reduce((sum, grade, i) => sum + (2 ** grade - 1) / Math.log2(i + 2), 0);
  return {
    precision: ranked.filter((id) => (qrels[id] ?? 0) >= 2).length / k,
    ndcg: ideal ? gains.reduce((a, b) => a + b, 0) / ideal : null,
  };
}

/** Compare returned facts to independent catalog facts and explicitly annotated hard constraints. */
export function checkCard(item: ApiEventListItem, occurrenceId: string, source: ApiEvent | undefined, hard: Constraints['hard'] = {}): string[] {
  const errors: string[] = [];
  if (!source) return ['unknown_event'];
  for (const key of ['id', 'title', 'category', 'city_id', 'venue', 'price_min', 'price_max', 'is_free', 'age_limit', 'status', 'language'] as const) {
    if (item[key] !== source[key]) errors.push(`fact:${key}`);
  }
  const occ = source.occurrences.find((o) => o.id === occurrenceId);
  const returnedOcc = item.occurrences.find((o) => o.id === occurrenceId);
  if (!occ || !returnedOcc || (['id', 'date_start', 'date_end', 'time_precision', 'status', 'status_verified', 'availability', 'is_past'] as const).some((key) => occ[key] !== returnedOcc[key])) errors.push('fact:occurrence');
  if (hard.cities?.length && !hard.cities.includes(source.city_id)) errors.push('city');
  if (hard.categories_any?.length && !hard.categories_any.includes(source.category)) errors.push('category');
  if (hard.categories_exclude?.includes(source.category)) errors.push('category_excluded');
  if (hard.free_only && (!source.is_free || source.price_min !== 0)) errors.push('free');
  if (hard.max_price_per_person !== undefined && (source.price_min === null || source.price_min > hard.max_price_per_person)) errors.push('price');
  if (hard.required_age_rating !== undefined && (source.age_limit === null || source.age_limit !== Number.parseInt(hard.required_age_rating, 10))) errors.push('age');
  if (hard.language && source.language !== hard.language) errors.push('language');
  if (hard.title_query && !source.title.toLocaleLowerCase('ru').includes(hard.title_query.toLocaleLowerCase('ru'))) errors.push('title');
  const ages = [...(hard.participants?.children_ages ?? []), ...(hard.participants?.participant_ages ?? [])];
  if (ages.length && (source.age_limit === null || source.age_limit > Math.min(...ages))) errors.push('participant_age');
  if (occ) {
    if (hard.date && (occ.date_start.slice(0, 10) > hard.date.to || (occ.date_end ?? occ.date_start).slice(0, 10) < hard.date.from)) errors.push('date');
    if (hard.time && (occ.time_precision !== 'minute' || (hard.time.start_from && occ.date_start.slice(11, 16) < hard.time.start_from) || (hard.time.start_to && occ.date_start.slice(11, 16) > hard.time.start_to))) errors.push('time');
    if (!(hard.statuses ?? ['scheduled', 'rescheduled']).includes(occ.status)) errors.push('status');
  }
  return errors;
}

export async function evaluateRelevance(rows: RelevanceRow[], events: ApiEvent[]) {
  const byId = new Map(events.map((event) => [event.id, event]));
  if (byId.size !== events.length) throw new Error('Duplicate catalog IDs');
  const details = [];
  for (const row of rows) {
    if (row.timezone !== 'Asia/Yekaterinburg' || !Number.isFinite(Date.parse(row.reference_now))) throw new Error(`Invalid clock for ${row.id}`);
    for (const [id, grade] of Object.entries(row.qrels)) {
      if (!byId.has(id) || ![0, 1, 2].includes(grade)) throw new Error(`Invalid qrel ${row.id}:${id}`);
    }
    const runtime = {
      getAllPublishedEvents: async () => events.filter((event) => event.status === 'published'),
      searchWithConstraints: async (filters: EventsSearchFilters) => {
        const outcome = runCatalogSearch(events, filters);
        return { outcome, items: outcome.matches.map(toListItem), allEvents: events, relaxations: [] };
      },
    } as unknown as ToolRuntime;
    const response = await runDeterministicAssistant({ message: row.query, previous: row.previous }, runtime, new Date(row.reference_now));
    const results = response.results ?? [];
    const ids = results.map(({ event }) => event.id);
    const violations = results.flatMap(({ event, occurrence_id }) => checkCard(event, occurrence_id, byId.get(event.id), row.expected_hard).map((error) => ({ id: event.id, error })));
    details.push({ id: row.id, action: response.action, ids, ...scoreRanking(ids, row.qrels), violations, feedback: Boolean(row.previous) });
  }
  const avg = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return { total: details.length, precisionAt5: avg(details.map((d) => d.precision)), ndcgAt5: avg(details.flatMap((d) => d.ndcg === null ? [] : [d.ndcg])), violations: details.flatMap((d) => d.violations.map((v) => ({ row: d.id, ...v }))), feedback: { total: details.filter((d) => d.feedback).length, precisionAt5: avg(details.filter((d) => d.feedback).map((d) => d.precision)), ndcgAt5: avg(details.filter((d) => d.feedback).flatMap((d) => d.ndcg === null ? [] : [d.ndcg])), violations: details.filter((d) => d.feedback).flatMap((d) => d.violations.map((v) => ({ row: d.id, ...v }))) }, details };
}
