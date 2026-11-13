/**
 * Правки условий для чипов /ask: чистые функции «что нажали -> какой patch уходит в API».
 *
 * Сервер применяет patch так: сначала unset, потом set, причём set заменяет поле целиком
 * (hard.participants, hard.time, soft.preferences приходят новым объектом, а не сливаются).
 * Поэтому составные поля собираются здесь из текущих условий.
 */

import { addDays, isValidDate, weekendRange } from '@/lib/api/time';
import type {
  AgeRating,
  AssistantAssumption,
  AssistantChip,
  CategoryId,
  ChipKind,
  CityId,
  Constraints,
  ConstraintsPatch,
  HardConstraints,
  Participants,
  SoftConstraints,
} from '@/lib/api/types';

export const MAX_BUDGET = 1_000_000;
export const MAX_ADULTS = 20;
export const MAX_CHILD_AGE = 17;

/** Значение region для «вся республика»: то же, что присылает API в вариантах ослабления. */
export const WHOLE_REGION = 'bashkortostan';

const FAMILY = 'family_friendly';

/** Какие условия можно править значением. Остальные чипы только снимаются. */
export const EDITABLE_KINDS: readonly ChipKind[] = [
  'city',
  'date',
  'time',
  'budget',
  'participants',
  'category',
  'age_rating',
  'query',
];

export function isEditable(chip: AssistantChip): boolean {
  if (!EDITABLE_KINDS.includes(chip.kind)) return false;
  // «Кроме: музеи» и «Лучше без» делят вид с обычной категорией, но правятся иначе: только снятие.
  if (chip.kind === 'category') return chip.key === 'hard.categories_any';
  if (chip.kind === 'query') return chip.key === 'soft.semantic_query';
  return true;
}

function patch(set: { hard?: HardConstraints; soft?: SoftConstraints }, unset: string[] = []): ConstraintsPatch {
  return { reset: false, set, unset };
}

/**
 * Пожелание «для всей семьи» появляется из слов «с ребёнком» и заставляет ассистента
 * спрашивать возраст. Когда состав группы задан явно (или чип «Кто идёт» снят),
 * оно должно уйти вместе с ним: так же поступает сервер на ответ «иду без детей».
 */
function withoutFamily(constraints: Constraints): Pick<ConstraintsPatch, 'unset'> & { soft?: SoftConstraints } {
  const preferences = constraints.soft.preferences ?? [];
  if (!preferences.includes(FAMILY)) return { unset: [] };
  const rest = preferences.filter((item) => item !== FAMILY);
  return rest.length > 0 ? { unset: [], soft: { preferences: rest } } : { unset: ['soft.preferences'] };
}

/** Снятие чипа. */
export function removeChipPatch(chip: AssistantChip, constraints: Constraints): ConstraintsPatch {
  if (chip.key !== 'hard.participants') return patch({}, [...chip.unset]);
  const family = withoutFamily(constraints);
  return patch(family.soft ? { soft: family.soft } : {}, [...chip.unset, ...family.unset]);
}

export function cityPatch(value: CityId | typeof WHOLE_REGION): ConstraintsPatch {
  if (value === WHOLE_REGION) return patch({ hard: { region: WHOLE_REGION } }, ['hard.cities']);
  return patch({ hard: { cities: [value] } }, ['hard.region']);
}

export function datePatch(from: string, to: string = from): ConstraintsPatch {
  return patch({ hard: { date: { from, to } } });
}

export type DatePreset = 'today' | 'tomorrow' | 'weekend';

/** Даты готового периода от сегодняшней даты афиши (reference_date из ответа API). */
export function presetRange(preset: DatePreset, today: string): { from: string; to: string } {
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'tomorrow') {
    const tomorrow = addDays(today, 1);
    return { from: tomorrow, to: tomorrow };
  }
  return weekendRange(today);
}

export type TimePreset = 'morning' | 'daytime' | 'evening';

/** Те же интервалы, которыми ассистент объясняет слова «утром», «днём», «вечером». */
export const TIME_PRESETS: Record<TimePreset, { start_from: string; start_to: string }> = {
  morning: { start_from: '06:00', start_to: '12:00' },
  daytime: { start_from: '12:00', start_to: '18:00' },
  evening: { start_from: '18:00', start_to: '23:00' },
};

export function timePatch(preset: TimePreset): ConstraintsPatch {
  return patch({ hard: { time: { ...TIME_PRESETS[preset] } } });
}

export type BudgetScope = 'person' | 'total';

export function budgetPatch(amount: number, scope: BudgetScope): ConstraintsPatch {
  if (scope === 'total') {
    return patch({ hard: { max_total_price: amount } }, ['hard.free_only', 'hard.max_price_per_person']);
  }
  return patch({ hard: { max_price_per_person: amount } }, ['hard.free_only', 'hard.max_total_price']);
}

export function freeOnlyPatch(): ConstraintsPatch {
  return patch({ hard: { free_only: true } }, ['hard.max_price_per_person', 'hard.max_total_price', 'hard.currency']);
}

/** Состав группы: число взрослых и возрасты детей. Пустой состав снимает условие. */
export function participantsPatch(
  input: { adults: number | null; childAges: number[] },
  constraints: Constraints,
): ConstraintsPatch {
  const participants: Participants = {};
  if (input.adults !== null) participants.adults = input.adults;
  if (input.childAges.length > 0) {
    participants.children_ages = input.childAges;
    participants.children_count = input.childAges.length;
  }
  const family = withoutFamily(constraints);
  const soft = family.soft ? { soft: family.soft } : {};
  if (Object.keys(participants).length === 0) return patch(soft, ['hard.participants', ...family.unset]);
  return patch({ hard: { participants }, ...soft }, family.unset);
}

export function categoryPatch(category: CategoryId): ConstraintsPatch {
  return patch({ hard: { categories_any: [category] } });
}

export function ageRatingPatch(rating: AgeRating): ConstraintsPatch {
  return patch({ hard: { required_age_rating: rating } });
}

export function queryPatch(text: string): ConstraintsPatch {
  return patch({ soft: { semantic_query: text } });
}

// ---------------------------------------------------------------------------
// Разбор полей редактора
// ---------------------------------------------------------------------------

/** Сумма из поля ввода: «1 500», «1500 ₽». null, если это не сумма в допустимых пределах. */
export function parseAmount(raw: string): number | null {
  const digits = raw.replace(/[\s₽]/g, '');
  if (!/^\d{1,7}$/.test(digits)) return null;
  const amount = Number(digits);
  return amount >= 0 && amount <= MAX_BUDGET ? amount : null;
}

/** Возрасты детей из строки «7, 10». Пустая строка даёт пустой список, мусор даёт null. */
export function parseAges(raw: string): number[] | null {
  const parts = raw
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const ages: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,2}$/.test(part)) return null;
    const age = Number(part);
    if (age > MAX_CHILD_AGE) return null;
    ages.push(age);
  }
  return ages.slice(0, 12);
}

/** Число взрослых: пустое поле даёт null (не задано), ошибка даёт undefined. */
export function parseAdults(raw: string): number | null | undefined {
  const text = raw.trim();
  if (!text) return null;
  if (!/^\d{1,2}$/.test(text)) return undefined;
  const adults = Number(text);
  return adults >= 1 && adults <= MAX_ADULTS ? adults : undefined;
}

export function isFutureDate(value: string, today: string): boolean {
  return isValidDate(value) && value >= today;
}

// ---------------------------------------------------------------------------
// Допущения
// ---------------------------------------------------------------------------

/** Какое условие правит действие «изменить» у допущения. null: править нечего. */
export function assumptionKind(assumption: AssistantAssumption): ChipKind | null {
  switch (assumption.key) {
    case 'date_resolved':
    case 'date_not_set':
      return 'date';
    case 'evening_18_23':
    case 'morning_06_12':
    case 'day_12_18':
      return 'time';
    case 'price_per_person_by_default':
    case 'total_budget':
      return 'budget';
    case 'party_assumed':
    case 'youngest_child':
      return 'participants';
    default:
      return null;
  }
}
