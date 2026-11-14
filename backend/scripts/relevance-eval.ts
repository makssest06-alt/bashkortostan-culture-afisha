import { runDeterministicAssistant, type Constraints } from '../src/domain/assistant/nlu.js';
import type { ToolRuntime } from '../src/domain/assistant/tools.js';
import { runCatalogSearch, toListItem, type EventsSearchFilters } from '../src/domain/search.js';
import type { ApiEvent } from '../src/domain/types.js';

export interface RelevanceRow {
  id: string;
  query: string;
  reference_now: string;
  timezone: string;
  previous?: Constraints;
  previous_query?: string;
  expected_first_clarify?: string;
  expected_hard?: Constraints['hard'];
  qrels: Record<string, number>;
}

/** Qrels are exhaustive for the fixed catalog; unjudged IDs score zero. */
export function scoreRanking(ids: string[], qrels: Record<string, number>, k = 5) {
  const seen = new Set<string>();
  const ranked = ids.slice(0, k).map((id) => {
    if (seen.has(id)) return 0;
    seen.add(id);
    return qrels[id] ?? 0;
  });
  const gains = ranked.map((grade, i) => (2 ** grade - 1) / Math.log2(i + 2));
  const ideal = Object.values(qrels).sort((a, b) => b - a).slice(0, k)
    .reduce((sum, grade, i) => sum + (2 ** grade - 1) / Math.log2(i + 2), 0);
  const relevant = Object.values(qrels).filter((grade) => grade >= 2).length;
  const hits = ranked.filter((grade) => grade >= 2).length;
  return {
    precision: hits / k,
    recall: relevant ? hits / relevant : null,
    ndcg: ideal ? gains.reduce((a, b) => a + b, 0) / ideal : null,
  };
}

/** Compare returned facts to independent catalog facts and explicitly annotated hard constraints. */
export function checkCard(item: ApiEvent, occurrenceId: string, source: ApiEvent | undefined, hard: Constraints['hard'] = {}): string[] {
  const errors: string[] = [];
  if (!source) return ['fact:unknown_event'];
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
  if (hard.max_total_price !== undefined && !source.is_free) {
    const party = hard.participants;
    const children = party?.children_count ?? party?.children_ages?.length ?? 0;
    const adults = party?.adults ?? Math.max(0, (party?.total ?? (children || 1)) - children);
    const offers = source.offers ?? [];
    const cheapest = (child: boolean) => {
      const prices = offers.filter(({ audience }) => child ? audience === 'child' || audience === 'reduced' : !audience || audience === 'adult')
        .flatMap(({ price, is_free }) => is_free ? [0] : price === null ? [] : [price]);
      return prices.length ? Math.min(...prices) : source.price_min;
    };
    const price = (adults ? (cheapest(false) ?? Infinity) * adults : 0)
      + (children ? (cheapest(true) ?? Infinity) * children : 0);
    if (source.price_min === null || price > hard.max_total_price) errors.push('total_price');
  }
  if (hard.required_age_rating !== undefined && (source.age_limit === null || source.age_limit !== Number.parseInt(hard.required_age_rating, 10))) errors.push('age');
  if (hard.language && source.language !== hard.language) errors.push('language');
  if (hard.title_query && !source.title.toLocaleLowerCase('ru').includes(hard.title_query.toLocaleLowerCase('ru'))) errors.push('title');
  const ages = [...(hard.participants?.children_ages ?? []), ...(hard.participants?.participant_ages ?? [])];
  if (ages.length && (source.age_limit === null || source.age_limit > Math.min(...ages))) errors.push('participant_age');
  if (occ) {
    const day = occ.date_start.slice(0, 10);
    const lastDay = occ.time_precision === 'date' ? (occ.date_end ?? occ.date_start).slice(0, 10) : day;
    if (hard.date && (day > hard.date.to || lastDay < hard.date.from)) errors.push('date');
    if (hard.time && (occ.time_precision !== 'minute' || (hard.time.start_from && occ.date_start.slice(11, 16) < hard.time.start_from) || (hard.time.start_to && occ.date_start.slice(11, 16) > hard.time.start_to))) errors.push('time');
    if (hard.time?.fits_from || hard.time?.fits_to) {
      const start = occ.date_start.slice(11, 16);
      const localEnd = occ.date_end && occ.date_end.slice(0, 10) === day ? occ.date_end.slice(11, 16) : null;
      if (occ.time_precision !== 'minute' || (hard.time.fits_from && start < hard.time.fits_from)
        || (hard.time.fits_to && (!localEnd || localEnd > hard.time.fits_to))) errors.push('fitted_time');
    }
    if (occ.is_past) errors.push('past');
    if (!(hard.statuses ?? ['scheduled', 'rescheduled']).some((status) => status === occ.status)) errors.push('status');
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
    const now = new Date(row.reference_now);
    const first = row.previous_query
      ? await runDeterministicAssistant({ message: row.previous_query }, runtime, now)
      : undefined;
    const response = await runDeterministicAssistant(
      { message: row.query, previous: first?.constraints ?? row.previous, answering: first?.clarify?.code, limit: 5 },
      runtime, now,
    );
    const results = response.results ?? [];
    const ids = results.map(({ event }) => event.id);
    const violations = results.flatMap(({ event, occurrence_id }) => checkCard(event, occurrence_id, byId.get(event.id), row.expected_hard).map((error) => ({ id: event.id, error })));
    details.push({ id: row.id, action: response.action, ids, ...scoreRanking(ids, row.qrels), violations,
      multiConstraint: Object.keys(row.expected_hard ?? {}).length >= 3,
      qualifyingOptions: Object.values(row.qrels).filter((grade) => grade >= 2).length,
      hit: ids.slice(0, 5).some((id) => (row.qrels[id] ?? 0) >= 2),
      feedback: Boolean(first ?? row.previous),
      cancelledResults: results.filter(({ event, occurrence_id }) => byId.get(event.id)?.occurrences
        .some((occurrence) => occurrence.id === occurrence_id && occurrence.status === 'cancelled')).length,
      firstClarificationCorrect: row.expected_first_clarify === undefined ? null : first?.clarify?.code === row.expected_first_clarify,
    });
  }
  const avg = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const positive = details.filter((row) => row.qualifyingOptions > 0);
  const multiTurn = details.filter((row) => row.feedback);
  const multiConstraint = positive.filter((row) => row.multiConstraint);
  const violations = details.flatMap((row) => row.violations.map((violation) => ({ row: row.id, ...violation })));
  return {
    total: details.length,
    positiveTotal: positive.length,
    hitAt5: positive.filter((row) => row.hit).length,
    emptyWithMatches: positive.filter((row) => row.action === 'search' && row.ids.length === 0).length,
    falseClarifications: details.filter((row) => row.action === 'clarify').length,
    incorrectFirstClarifications: details.filter((row) => row.firstClarificationCorrect === false).length,
    precisionAt5: avg(details.map((row) => row.precision)),
    recallAt5: avg(details.flatMap((row) => row.recall === null ? [] : [row.recall])),
    ndcgAt5: avg(details.flatMap((row) => row.ndcg === null ? [] : [row.ndcg])),
    cardFactErrors: violations.filter((item) => item.error.startsWith('fact:')).length,
    multiConstraint: {
      total: multiConstraint.length,
      passed: multiConstraint.filter((row) => row.hit && row.violations.length === 0).length,
    },
    hardViolations: violations.filter((item) => !item.error.startsWith('fact:')).length,
    cancelledShownActive: details.reduce((sum, row) => sum + row.cancelledResults, 0),
    noResultsCorrect: details.filter((row) => !row.qualifyingOptions && row.action === 'search' && row.ids.length === 0).length,
    noResultsTotal: details.length - positive.length,
    violations,
    feedback: { total: multiTurn.length, hitAt5: multiTurn.filter((row) => row.hit).length },
    details,
  };
}
