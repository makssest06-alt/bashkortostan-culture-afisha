/**
 * Справочники городов и категорий.
 *
 * Источник истины — API (`GET /cities`, `GET /categories`). Встроенный список
 * нужен только как fallback, чтобы бот поднялся и работал при недоступном API.
 * UI-слой получает этот сервис явно, поэтому подмена справочника в тестах
 * не требует глобального состояния.
 */

export type CityId = string;
export type CategoryId = string;

export interface CityInfo {
  id: CityId;
  name: string;
}

export interface CategoryInfo {
  id: CategoryId;
  name: string;
}

export interface DirectorySource {
  getCities: () => Promise<readonly { id: string; name: string }[]>;
  getCategories: () => Promise<readonly { id: string; name: string }[]>;
}

/** Минимум, который нужен форматированию: только подписи, без управления. */
export interface DirectoryLookup {
  cityName: (id: string | null | undefined) => string | null;
  categoryName: (id: string | null | undefined) => string | null;
}

/** Справочник для клавиатур: подписи, списки и проверка идентификаторов. */
export interface DirectoryCatalog extends DirectoryLookup {
  readonly cities: readonly CityInfo[];
  readonly categories: readonly CategoryInfo[];
  isCityId: (value: string) => boolean;
  isCategoryId: (value: string) => boolean;
}

/** Справочник для распознавания текстовых команд вида «/city Уфа». */
export interface DirectoryResolver extends DirectoryCatalog {
  findCityId: (value: string) => CityId | null;
  findCategoryId: (value: string) => CategoryId | null;
}

export interface DirectoryRefreshStatus {
  /** true, если ответ API прошёл проверку и заменил текущий справочник. */
  loaded: boolean;
  count: number;
  /** true, если API вернул больше записей, чем бот готов держать в памяти. */
  truncated?: boolean;
  error?: string;
}

export interface DirectoryRefreshResult {
  cities: DirectoryRefreshStatus;
  categories: DirectoryRefreshStatus;
}

export const FALLBACK_CITIES: readonly CityInfo[] = [
  { id: 'ufa', name: 'Уфа' },
  { id: 'sterlitamak', name: 'Стерлитамак' },
  { id: 'salavat', name: 'Салават' },
  { id: 'neftekamsk', name: 'Нефтекамск' },
  { id: 'oktyabrsky', name: 'Октябрьский' },
  { id: 'beloretsk', name: 'Белорецк' },
  { id: 'sibay', name: 'Сибай' },
  { id: 'kumertau', name: 'Кумертау' },
];

export const FALLBACK_CATEGORIES: readonly CategoryInfo[] = [
  { id: 'concert', name: 'Концерт' },
  { id: 'performance', name: 'Спектакль' },
  { id: 'exhibition', name: 'Выставка' },
  { id: 'festival', name: 'Фестиваль' },
  { id: 'cinema', name: 'Кино' },
  { id: 'excursion', name: 'Экскурсия' },
  { id: 'other', name: 'Другое' },
];

const MAX_ENTRIES = 500;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Слова, которыми пользователи называют категорию, но которых нет в её
 * названии. Ключ — id категории; работает и для fallback, и для данных API.
 */
const CATEGORY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  cinema: ['кинопоказ', 'кинопоказы', 'кинотеатр'],
};

function normalizeLookup(value: string): string {
  return value.trim().toLowerCase().replace(/^в\s+/u, '').replace(/ё/g, 'е');
}

/**
 * Грубая основа слова для поиска: «Уфе» → «уф», «концерты» → «концерт»,
 * «спектакли» → «спектакл», «экскурсию» → «экскурси». Нужна только для
 * распознавания ввода, на выборку в API не влияет.
 */
function stem(value: string): string {
  return normalizeLookup(value)
    .replace(/(ом|ем|ах|ях|ий|ый|ая|ое|ые|ую)$/u, '')
    .replace(/[аяыеиуюоьй]$/u, '');
}

function matches(
  entry: { id: string; name: string },
  value: string,
  aliases: readonly string[] = [],
): boolean {
  const needle = normalizeLookup(value);
  if (!needle) return false;
  if (entry.id === needle) return true;

  const needleStem = stem(needle);
  return [entry.name, ...aliases].some((candidate) => {
    const normalized = normalizeLookup(candidate);
    if (normalized === needle) return true;
    const candidateStem = stem(normalized);
    return candidateStem.length >= 2 && candidateStem === needleStem;
  });
}

/**
 * Нечёткое добивание по началу слова: «конц» → «Концерт». Срабатывает только
 * при однозначном совпадении, чтобы не угадывать между похожими названиями.
 */
function findByPrefix<T extends { id: string; name: string }>(
  entries: readonly T[],
  value: string,
  aliases: Readonly<Record<string, readonly string[]>> = {},
): T | null {
  const needle = normalizeLookup(value);
  if (needle.length < 2) return null;

  const found = entries.filter((entry) =>
    [entry.name, ...(aliases[entry.id] ?? [])].some((candidate) =>
      normalizeLookup(candidate).startsWith(needle),
    ),
  );
  return found.length === 1 ? found[0]! : null;
}

interface NormalizedEntries<T> {
  items: T[];
  truncated: boolean;
}

function normalizeEntries<T extends { id: string; name: string }>(
  items: readonly T[],
): NormalizedEntries<T> {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (typeof item?.id !== 'string' || typeof item?.name !== 'string') continue;

    const id = item.id.trim().toLowerCase();
    const name = item.name.replace(/\s+/g, ' ').trim();
    if (!SLUG_RE.test(id) || !name || seen.has(id)) continue;
    if (result.length >= MAX_ENTRIES) return { items: result, truncated: true };

    seen.add(id);
    result.push({ ...item, id, name });
  }
  return { items: result, truncated: false };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export class DirectoryService implements DirectoryResolver {
  private citiesValue: readonly CityInfo[];
  private categoriesValue: readonly CategoryInfo[];

  constructor(
    snapshot: {
      cities?: readonly CityInfo[];
      categories?: readonly CategoryInfo[];
    } = {},
  ) {
    const citySnapshot = normalizeEntries(snapshot.cities ?? []).items;
    const categorySnapshot = normalizeEntries(snapshot.categories ?? []).items;
    this.citiesValue =
      citySnapshot.length > 0 ? citySnapshot : normalizeEntries(FALLBACK_CITIES).items;
    this.categoriesValue =
      categorySnapshot.length > 0
        ? categorySnapshot
        : normalizeEntries(FALLBACK_CATEGORIES).items;
  }

  get cities(): readonly CityInfo[] {
    return this.citiesValue;
  }

  get categories(): readonly CategoryInfo[] {
    return this.categoriesValue;
  }

  /**
   * Обновляет справочники из API. Пустой или битый ответ не затирает рабочий
   * список: бот продолжает работать на предыдущих данных.
   */
  async refresh(source: DirectorySource): Promise<DirectoryRefreshResult> {
    const [cities, categories] = await Promise.allSettled([
      Promise.resolve().then(() => source.getCities()),
      Promise.resolve().then(() => source.getCategories()),
    ]);

    return {
      cities: this.apply(this.citiesValue, cities, (value) => {
        this.citiesValue = value;
      }),
      categories: this.apply(this.categoriesValue, categories, (value) => {
        this.categoriesValue = value;
      }),
    };
  }

  city(id: string | null | undefined): CityInfo | undefined {
    return id ? this.citiesValue.find((item) => item.id === id) : undefined;
  }

  category(id: string | null | undefined): CategoryInfo | undefined {
    return id ? this.categoriesValue.find((item) => item.id === id) : undefined;
  }

  cityName(id: string | null | undefined): string | null {
    return this.city(id)?.name ?? null;
  }

  categoryName(id: string | null | undefined): string | null {
    return this.category(id)?.name ?? null;
  }

  isCityId(value: string): boolean {
    return this.city(value) !== undefined;
  }

  isCategoryId(value: string): boolean {
    return this.category(value) !== undefined;
  }

  findCityId(value: string): CityId | null {
    return this.citiesValue.find((item) => matches(item, value))?.id ?? null;
  }

  findCategoryId(value: string): CategoryId | null {
    const exact = this.categoriesValue.find((item) =>
      matches(item, value, CATEGORY_ALIASES[item.id]),
    );
    if (exact) return exact.id;
    return findByPrefix(this.categoriesValue, value, CATEGORY_ALIASES)?.id ?? null;
  }

  private apply(
    current: readonly { id: string; name: string }[],
    result: PromiseSettledResult<readonly { id: string; name: string }[]>,
    replace: (value: readonly { id: string; name: string }[]) => void,
  ): DirectoryRefreshStatus {
    if (result.status === 'rejected') {
      return { loaded: false, count: current.length, error: errorMessage(result.reason) };
    }

    const next = normalizeEntries(result.value);
    if (next.items.length === 0) {
      return { loaded: false, count: current.length, error: 'пустой справочник в API' };
    }

    replace(next.items);
    return {
      loaded: true,
      count: next.items.length,
      ...(next.truncated ? { truncated: true } : {}),
    };
  }
}
