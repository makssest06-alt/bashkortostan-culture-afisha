import { describe, expect, it } from 'vitest';

import {
  DirectoryService,
  FALLBACK_CATEGORIES,
  FALLBACK_CITIES,
  type DirectorySource,
} from '../src/directory-service.js';

function source(
  cities: readonly { id: string; name: string }[],
  categories: readonly { id: string; name: string }[],
): DirectorySource {
  return {
    getCities: async () => cities,
    getCategories: async () => categories,
  };
}

describe('DirectoryService: встроенный fallback', () => {
  it('находит город по названию и падежу', () => {
    const directories = new DirectoryService();

    expect(directories.findCityId('Уфа')).toBe('ufa');
    expect(directories.findCityId('в Уфе')).toBe('ufa');
    expect(directories.findCityId('  СТЕРЛИТАМАК ')).toBe('sterlitamak');
    expect(directories.findCityId('Октябрьском')).toBe('oktyabrsky');
    expect(directories.findCityId('Марс')).toBeNull();
  });

  it('находит категорию по названию, падежу и основе', () => {
    const directories = new DirectoryService();

    expect(directories.findCategoryId('концерт')).toBe('concert');
    expect(directories.findCategoryId('концерты')).toBe('concert');
    expect(directories.findCategoryId('спектакли')).toBe('performance');
    expect(directories.findCategoryId('экскурсию')).toBe('excursion');
    expect(directories.findCategoryId('кинопоказ')).toBe('cinema');
    expect(directories.findCategoryId('кинопоказы')).toBe('cinema');
    expect(directories.findCategoryId('нет такой')).toBeNull();
  });

  it('отдаёт имена и проверяет идентификаторы', () => {
    const directories = new DirectoryService();

    expect(directories.cityName('ufa')).toBe('Уфа');
    expect(directories.categoryName('concert')).toBe('Концерт');
    expect(directories.isCityId('ufa')).toBe(true);
    expect(directories.isCategoryId('concert')).toBe(true);
    expect(directories.isCityId('mars')).toBe(false);
    expect(directories.isCategoryId('opera')).toBe(false);
  });

  it('добивает категорию по началу слова, но не угадывает по одной букве', () => {
    const directories = new DirectoryService();

    expect(directories.findCategoryId('конц')).toBe('concert');
    expect(directories.findCategoryId('выст')).toBe('exhibition');
    expect(directories.findCategoryId('к')).toBeNull();
  });

  it('подставляет fallback, если конструктор получил пустой снимок', () => {
    const directories = new DirectoryService({ cities: [], categories: [] });

    expect(directories.cities).toEqual(FALLBACK_CITIES);
    expect(directories.categories).toEqual(FALLBACK_CATEGORIES);
  });
});

describe('DirectoryService: обновление из API', () => {
  it('заменяет встроенные справочники данными API', async () => {
    const directories = new DirectoryService();
    const result = await directories.refresh(
      source(
        [
          { id: 'ufa', name: 'Уфа' },
          { id: 'novy', name: 'Новый город' },
        ],
        [{ id: 'opera', name: 'Опера' }],
      ),
    );

    expect(result.cities).toEqual({ loaded: true, count: 2 });
    expect(result.categories).toEqual({ loaded: true, count: 1 });
    expect(directories.cityName('novy')).toBe('Новый город');
    expect(directories.findCityId('Новый город')).toBe('novy');
    expect(directories.categoryName('opera')).toBe('Опера');
    expect(directories.isCategoryId('concert')).toBe(false);
  });

  it('не затирает рабочий справочник пустым ответом', async () => {
    const directories = new DirectoryService();
    await directories.refresh(source([], []));

    expect(directories.cities).toEqual(FALLBACK_CITIES);
    expect(directories.categories).toEqual(FALLBACK_CATEGORIES);
  });

  it('оставляет fallback, если API недоступен', async () => {
    const directories = new DirectoryService();
    const result = await directories.refresh({
      getCities: async () => {
        throw new Error('network down');
      },
      getCategories: async () => [{ id: 'concert', name: 'Концерт' }],
    });

    expect(result.cities.loaded).toBe(false);
    expect(result.cities.error).toContain('network down');
    expect(result.categories.loaded).toBe(true);
    expect(directories.cityName('ufa')).toBe('Уфа');
  });

  it('отбрасывает пустые, битые и повторные записи', async () => {
    const directories = new DirectoryService();
    const result = await directories.refresh(
      source(
        [
          { id: 'ufa', name: 'Уфа' },
          { id: 'ufa', name: 'Дубль' },
          { id: 'BAD ID', name: 'Битый' },
          { id: 'empty', name: '   ' },
          { id: 'novy', name: '  Новый   город  ' },
        ],
        [{ id: 'concert', name: 'Концерт' }],
      ),
    );

    expect(result.cities).toEqual({ loaded: true, count: 2 });
    expect(directories.cities.map((item) => item.id)).toEqual(['ufa', 'novy']);
    expect(directories.cityName('novy')).toBe('Новый город');
    expect(directories.cityName('ufa')).toBe('Уфа');
  });
});

describe('DirectoryService: границы справочника', () => {
  it('сообщает об усечении, если API вернул больше записей, чем бот держит', async () => {
    const directories = new DirectoryService();
    const cities = Array.from({ length: 501 }, (_, index) => ({
      id: `city-${index + 1}`,
      name: `Город ${index + 1}`,
    }));

    const result = await directories.refresh(
      source(cities, [{ id: 'concert', name: 'Концерт' }]),
    );

    expect(result.cities).toEqual({ loaded: true, count: 500, truncated: true });
    expect(directories.cities).toHaveLength(500);
  });

  it('сохраняет синонимы категорий и для данных из API', async () => {
    const directories = new DirectoryService();
    await directories.refresh(
      source(
        [{ id: 'ufa', name: 'Уфа' }],
        [{ id: 'cinema', name: 'Кинопоказ' }],
      ),
    );

    expect(directories.findCategoryId('кинотеатр')).toBe('cinema');
  });
});
