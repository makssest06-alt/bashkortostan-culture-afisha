/**
 * Как ассистент показывает понятое: чипы условий, допущения и причины подбора.
 *
 * Всё строится кодом из условий и полей события. Здесь нет ни одной фразы,
 * которую нельзя проверить по данным: «подходит по возрасту: 6+» берётся
 * из возрастной метки, «в бюджете» из цены.
 */

import { ageRatingMin, getCategory, getCity } from '../../../data/dictionaries';
import { partyTotalMinor } from '../filters';
import type { SearchMatch } from '../filters';
import {
  formatDateRange,
  formatDay,
  formatMinor,
  formatRub,
  pluralRu,
  weekdayInRu,
  weekdayName,
} from '../format';
import { normalizeText, stem, tokenize } from '../text';
import { addDays, valueDate, valueTime, weekdayOf } from '../time';
import type {
  AfishaEvent,
  AssistantAssumption,
  AssistantChip,
  Constraints,
  Occurrence,
  Participants,
} from '../types';
import { EXTRA_CATEGORY_LABELS, PREFERENCES } from './lexicon';
import { partyOf, youngestAge } from './state';

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'состоятся',
  cancelled: 'отменённые',
  postponed: 'перенесённые',
  sold_out: 'билеты кончились',
  unknown: 'статус не подтверждён',
};

function categoryLabel(id: string): string {
  return getCategory(id)?.name.ru ?? EXTRA_CATEGORY_LABELS[id] ?? id;
}

function cityLabel(slug: string): string {
  return getCity(slug)?.name.ru ?? slug;
}

function yearsLabel(age: number): string {
  return `${age} ${pluralRu(age, ['год', 'года', 'лет'])}`;
}

function peopleLabel(count: number): string {
  return `${count} ${pluralRu(count, ['человек', 'человека', 'человек'])}`;
}

function participantsLabel(participants: Participants, waitingForAge: boolean): string {
  const parts: string[] = [];
  const ages = participants.children_ages ?? [];
  const children = participants.children_count ?? ages.length;

  if (participants.adults !== undefined && participants.adults > 0) {
    parts.push(`${participants.adults} ${pluralRu(participants.adults, ['взрослый', 'взрослых', 'взрослых'])}`);
  } else if (participants.total !== undefined && children === 0) {
    parts.push(peopleLabel(participants.total));
  }

  if (ages.length === 1) parts.push(`ребёнок ${yearsLabel(ages[0])}`);
  else if (ages.length > 1) parts.push(`дети ${ages.join(' и ')} лет`);
  else if (children === 1) parts.push(waitingForAge ? 'с ребёнком, возраст не указан' : 'с ребёнком');
  else if (children > 1) parts.push(`детей: ${children}`);

  const own = participants.participant_ages ?? [];
  if (own.length > 0) parts.push(`возраст ${own.map(yearsLabel).join(', ')}`);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Чипы
// ---------------------------------------------------------------------------

export function buildChips(constraints: Constraints): AssistantChip[] {
  const { hard, soft } = constraints;
  const chips: AssistantChip[] = [];
  const add = (chip: Omit<AssistantChip, 'removable' | 'unset'> & { unset?: string[] }): void => {
    chips.push({ ...chip, removable: true, unset: chip.unset ?? [chip.key] });
  };

  if (hard.cities?.length) {
    add({ key: 'hard.cities', kind: 'city', label: 'Город', value: hard.cities.map(cityLabel).join(', ') });
  } else if (hard.region) {
    add({ key: 'hard.region', kind: 'city', label: 'Город', value: 'Вся республика' });
  }

  if (hard.date) {
    const single = hard.date.from === hard.date.to;
    const value = single
      ? formatDay(hard.date.from, 'ru', { weekday: 'short' })
      : formatDateRange(hard.date.from, hard.date.to, 'ru');
    add({ key: 'hard.date', kind: 'date', label: 'Дата', value });
  }

  if (hard.time) {
    const { start_from: from, start_to: to, fits_from: fitsFrom, fits_to: fitsTo } = hard.time;
    let value = '';
    if (fitsFrom || fitsTo) value = `в интервале ${fitsFrom ?? '00:00'}-${fitsTo ?? '23:59'}`;
    else if (from && to) value = `начало с ${from} до ${to}`;
    else if (from) value = `начало после ${from}`;
    else if (to) value = `начало до ${to}`;
    if (value) add({ key: 'hard.time', kind: 'time', label: 'Время', value });
  }

  const participants = hard.participants;
  const waitingForAge =
    (participants?.children_count ?? 0) > 0 && !(participants?.children_ages && participants.children_ages.length > 0);
  if (participants) {
    const value = participantsLabel(participants, waitingForAge);
    if (value) add({ key: 'hard.participants', kind: 'participants', label: 'Кто идёт', value });
  }

  if (hard.free_only) {
    add({ key: 'hard.free_only', kind: 'budget', label: 'Цена', value: 'только бесплатно' });
  } else if (hard.max_price_per_person !== undefined) {
    add({
      key: 'hard.max_price_per_person',
      kind: 'budget',
      label: 'Бюджет',
      value: `до ${formatRub(hard.max_price_per_person)} за человека`,
      unset: ['hard.max_price_per_person', 'hard.currency'],
    });
  } else if (hard.max_total_price !== undefined) {
    add({
      key: 'hard.max_total_price',
      kind: 'budget',
      label: 'Бюджет',
      value: `до ${formatRub(hard.max_total_price)} на всех`,
      unset: ['hard.max_total_price', 'hard.currency'],
    });
  }

  if (hard.categories_any?.length) {
    add({
      key: 'hard.categories_any',
      kind: 'category',
      label: 'Категория',
      value: hard.categories_any.map(categoryLabel).join(', '),
    });
  }
  if (hard.categories_exclude?.length) {
    add({
      key: 'hard.categories_exclude',
      kind: 'category',
      label: 'Кроме',
      value: hard.categories_exclude.map(categoryLabel).join(', '),
    });
  }
  if (hard.required_age_rating) {
    add({ key: 'hard.required_age_rating', kind: 'age_rating', label: 'Возрастная метка', value: hard.required_age_rating });
  }
  if (hard.statuses?.length) {
    add({
      key: 'hard.statuses',
      kind: 'status',
      label: 'Статус',
      value: hard.statuses.map((status) => STATUS_LABELS[status] ?? status).join(', '),
    });
  }

  // «Для всей семьи» рядом с чипом «с ребёнком» ничего не добавляет: показываем его, только если детей в составе нет.
  const hasChildren = (participants?.children_count ?? 0) > 0;
  const preferenceLabels = (soft.preferences ?? [])
    .filter((id) => !(id === 'family_friendly' && hasChildren))
    .map((id) => PREFERENCES.find((entry) => entry.id === id)?.label ?? id)
    .filter(Boolean);
  if (preferenceLabels.length > 0) {
    add({ key: 'soft.preferences', kind: 'preference', label: 'Пожелание', value: preferenceLabels.join(', ') });
  }
  if (soft.audience === 'children') {
    add({ key: 'soft.audience', kind: 'preference', label: 'Для кого', value: 'детские события' });
  }
  if (soft.prefer_free) {
    add({ key: 'soft.prefer_free', kind: 'preference', label: 'Пожелание', value: 'лучше бесплатно' });
  } else if (soft.price_direction === 'lower') {
    add({ key: 'soft.price_direction', kind: 'preference', label: 'Пожелание', value: 'подешевле' });
  }
  if (soft.avoid_categories?.length) {
    add({
      key: 'soft.avoid_categories',
      kind: 'preference',
      label: 'Лучше без',
      value: soft.avoid_categories.map(categoryLabel).join(', '),
    });
  }
  if (soft.semantic_query) {
    add({ key: 'soft.semantic_query', kind: 'query', label: 'По словам', value: soft.semantic_query });
  }

  return chips;
}

// ---------------------------------------------------------------------------
// Допущения
// ---------------------------------------------------------------------------

/** Как названа дата относительно сегодня: «завтра = 12 ноября», «суббота = 14 ноября». */
function dateAssumption(from: string, to: string, today: string): string | null {
  const range = formatDateRange(from, to, 'ru');
  if (from === to) {
    if (from === today) return `сегодня = ${range}`;
    if (from === addDays(today, 1)) return `завтра = ${range}`;
    if (from > today && from <= addDays(today, 13)) return `${weekdayName(from, 'ru')} = ${range}`;
    return null;
  }
  const isWeekend = weekdayOf(from) === 6 && weekdayOf(to) === 0 && to === addDays(from, 1);
  if (isWeekend) return `выходные = ${range}`;
  return null;
}

export function buildAssumptions(
  constraints: Constraints,
  today: string,
  notes: readonly AssistantAssumption[],
  options: { searching: boolean },
): AssistantAssumption[] {
  const { hard } = constraints;
  const result: AssistantAssumption[] = [];

  if (hard.date) {
    const text = dateAssumption(hard.date.from, hard.date.to, today);
    if (text) result.push({ key: 'date_resolved', text });
  } else if (options.searching) {
    result.push({ key: 'date_not_set', text: 'дата не названа: показываю ближайшие три недели' });
  }

  const time = hard.time;
  if (time?.start_from === '18:00' && time.start_to === '23:00') {
    result.push({ key: 'evening_18_23', text: 'вечером = начало с 18:00 до 23:00' });
  } else if (time?.start_from === '06:00' && time.start_to === '12:00') {
    result.push({ key: 'morning_06_12', text: 'утром = начало с 6:00 до 12:00' });
  } else if (time?.start_from === '12:00' && time.start_to === '18:00') {
    result.push({ key: 'day_12_18', text: 'днём = начало с 12:00 до 18:00' });
  }

  if (hard.max_price_per_person !== undefined) {
    result.push({
      key: 'price_per_person_by_default',
      text: `до ${formatRub(hard.max_price_per_person)} за человека`,
    });
  }
  if (hard.max_total_price !== undefined) {
    const party = partyOf(constraints);
    const people = party.adults + party.children;
    result.push({
      key: party.adultsAssumed ? 'party_assumed' : 'total_budget',
      text: party.adultsAssumed
        ? `бюджет на всех: считаю ${peopleLabel(people)}, из них взрослых ${party.adults}`
        : `бюджет на всех: ${peopleLabel(people)}`,
    });
  }

  const ages = hard.participants?.children_ages ?? [];
  if (ages.length > 1) {
    result.push({ key: 'youngest_child', text: `возрастную метку проверяю по младшему: ${yearsLabel(Math.min(...ages))}` });
  }

  if (options.searching && !hard.statuses?.length) {
    result.push({
      key: 'default_scheduled_disclosed',
      text: 'отменённые сеансы и сеансы с неподтверждённым статусом скрыты',
    });
  }

  for (const note of notes) {
    if (!result.some((item) => item.key === note.key)) result.push(note);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Причины подбора
// ---------------------------------------------------------------------------

function whenReason(occurrence: Occurrence, today: string): string {
  const date = valueDate(occurrence.start);
  const time = valueTime(occurrence.start);
  if (time) {
    if (date === today) return `сегодня в ${time}`;
    if (date === addDays(today, 1)) return `завтра в ${time}`;
    return `${weekdayInRu(date)}, ${formatDay(date, 'ru')}, в ${time}`;
  }
  if (occurrence.end) return `работает до ${formatDay(valueDate(occurrence.end), 'ru')}`;
  return formatDay(date, 'ru');
}

/** Находит в описании слово или оборот, подтверждающий пожелание. */
function findEvidence(event: AfishaEvent, needles: readonly string[]): string | null {
  const text = `${event.title}. ${event.description}`;
  const normalized = normalizeText(text);
  for (const needle of needles) {
    if (!normalized.includes(needle)) continue;
    if (needle.includes(' ')) return needle;
    // Возвращаем слово целиком, как оно написано в описании.
    const words = text.split(/[^A-Za-zА-Яа-яЁё0-9-]+/).filter(Boolean);
    const found = words.find((item) => normalizeText(item).startsWith(needle));
    return found ? found.toLowerCase() : needle;
  }
  return null;
}

export function buildReasons(match: SearchMatch, occurrence: Occurrence, constraints: Constraints, today: string): string[] {
  const { hard, soft } = constraints;
  const event = match.event;
  const reasons: string[] = [whenReason(occurrence, today)];

  const age = youngestAge(constraints);
  if (age !== null && event.age_rating !== null && ageRatingMin(event.age_rating) <= age) {
    reasons.push(`подходит по возрасту: ${event.age_rating}`);
  }

  const price = event.price_summary;
  if (hard.free_only && price.kind === 'free') {
    reasons.push('вход бесплатный');
  } else if (hard.max_price_per_person !== undefined) {
    if (price.kind === 'free') reasons.push('вход бесплатный, в бюджете');
    else if (price.kind === 'from' && price.amount_minor !== undefined) {
      reasons.push(`цена от ${formatMinor(price.amount_minor)}, в бюджете`);
    }
  } else if (hard.max_total_price !== undefined) {
    const party = partyOf(constraints);
    const total = partyTotalMinor(event, { adults: party.adults, children: party.children });
    if (total !== null) {
      const people = party.adults + party.children;
      reasons.push(total === 0 ? 'вход бесплатный, в бюджете' : `на ${peopleLabel(people)} от ${formatMinor(total)}, в бюджете`);
    }
  } else if (soft.prefer_free && price.kind === 'free') {
    reasons.push('вход бесплатный');
  }

  if (hard.cities?.length) {
    reasons.push(`${event.venue.city_name.ru}: ${event.venue.name}`);
  }
  if (hard.categories_any?.includes(event.category)) {
    reasons.push(`раздел «${categoryLabel(event.category)}»`);
  } else if (age !== null && event.category === 'kids') {
    reasons.push('раздел «Детям»');
  }

  for (const id of soft.preferences ?? []) {
    const preference = PREFERENCES.find((entry) => entry.id === id);
    if (!preference) continue;
    const evidence = findEvidence(event, preference.evidence);
    if (evidence) reasons.push(`в описании: «${evidence}»`);
  }

  if (soft.semantic_query) {
    const haystack = normalizeText(`${event.title} ${event.description}`);
    const hit = tokenize(soft.semantic_query).find((token) => haystack.includes(stem(token)));
    if (hit) reasons.push(`по вашим словам: «${hit}»`);
  }

  return [...new Set(reasons)];
}

export function buildCaveats(event: AfishaEvent, occurrence: Occurrence): string[] {
  const caveats: string[] = [];
  if (occurrence.availability === 'sold_out') caveats.push('билеты на этот сеанс кончились');
  if (occurrence.status === 'rescheduled') caveats.push('сеанс перенесён: проверьте новую дату');
  if (occurrence.status === 'cancelled') caveats.push('сеанс отменён');
  if (occurrence.status === 'postponed') caveats.push('сеанс перенесён, новая дата не объявлена');
  if (occurrence.status === 'unknown') caveats.push('статус сеанса не подтверждён');
  if (event.price_summary.kind === 'unknown') caveats.push('цена не указана');
  return caveats;
}

// ---------------------------------------------------------------------------
// Ранжирование по мягким пожеланиям
// ---------------------------------------------------------------------------

/** Оценка события для порядка выдачи. Жёсткие условия к этому моменту уже проверены. */
export function scoreMatch(match: SearchMatch, occurrence: Occurrence, constraints: Constraints): number {
  const { hard, soft } = constraints;
  const event = match.event;
  let score = event.popularity / 100;

  const hasChildren = (hard.participants?.children_count ?? 0) > 0 || soft.audience === 'children';
  if (hasChildren && event.category === 'kids') score += 0.5;

  for (const id of soft.preferences ?? []) {
    const preference = PREFERENCES.find((entry) => entry.id === id);
    if (preference && findEvidence(event, preference.evidence)) score += 0.6;
  }
  if (soft.semantic_query) {
    const haystack = normalizeText(`${event.title} ${event.description}`);
    const hits = tokenize(soft.semantic_query).filter((token) => haystack.includes(stem(token))).length;
    score += hits * 0.8;
  }

  const price = event.price_summary;
  if (soft.prefer_free && price.kind === 'free') score += 0.4;
  if (soft.price_direction === 'lower') {
    if (price.kind === 'free') score += 0.3;
    else if (price.kind === 'from') score -= Math.min((price.amount_minor ?? 0) / 500_000, 0.6);
  }
  if (soft.avoid_categories?.includes(event.category)) score -= 1;
  if (occurrence.availability === 'sold_out') score -= 1;
  return score;
}
