/**
 * Счётчики для фильтров: сколько событий даст каждое значение.
 *
 * Счётчик по измерению считается без условия этого же измерения
 * (иначе у выбранного города остальные города всегда показывали бы ноль).
 */

import { AGE_RATINGS, CATEGORIES, CITIES } from '../../data/dictionaries';
import type { Catalog } from './db';
import { runSearch } from './filters';
import type { SearchFilters } from './filters';
import type { AgeRating, CategoryId, CityId, FacetEntry, Facets } from './types';

function countBy<T extends string>(values: readonly T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

export function computeFacets(catalog: Catalog, filters: SearchFilters): Facets {
  const withoutCity = runSearch(catalog, { ...filters, cities: [] }).matches;
  const withoutCategory = runSearch(catalog, { ...filters, categories: [], categories_exclude: [] }).matches;
  const withoutRating = runSearch(catalog, { ...filters, age_ratings: [] }).matches;
  const withoutPrice = runSearch(catalog, {
    ...filters,
    price_max: null,
    price_total_max: null,
    free_only: false,
  }).matches;

  const cityCounts = countBy(withoutCity.map((match) => match.event.venue.city));
  const categoryCounts = countBy(withoutCategory.map((match) => match.event.category));
  const ratingCounts = countBy(withoutRating.map((match) => match.event.age_rating ?? 'unknown'));
  const priceCounts = countBy(withoutPrice.map((match) => match.event.price_summary.kind));

  const cities: FacetEntry<CityId>[] = CITIES.map((city) => ({
    id: city.slug,
    name: city.name,
    count: cityCounts.get(city.slug) ?? 0,
  }));
  const categories: FacetEntry<CategoryId>[] = CATEGORIES.map((category) => ({
    id: category.id,
    name: category.name,
    count: categoryCounts.get(category.id) ?? 0,
  }));
  const ageRatings: FacetEntry<AgeRating | 'unknown'>[] = [
    ...AGE_RATINGS.map((rating) => ({
      id: rating.id,
      name: rating.label,
      count: ratingCounts.get(rating.id) ?? 0,
    })),
    {
      id: 'unknown' as const,
      name: { ru: 'Возраст не указан', ba: 'Йәше күрһәтелмәгән' },
      count: ratingCounts.get('unknown') ?? 0,
    },
  ];

  return {
    cities,
    categories,
    age_ratings: ageRatings,
    price: {
      free: priceCounts.get('free') ?? 0,
      paid: priceCounts.get('from') ?? 0,
      unknown: priceCounts.get('unknown') ?? 0,
    },
    total: runSearch(catalog, filters).matches.length,
  };
}
