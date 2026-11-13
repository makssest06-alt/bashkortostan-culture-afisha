import { normalizeText, toVenueSlug } from './identity.js';
import type { CategoryId, CityId, LocalizedText, OccurrenceStatus, OfferAudience, SortKey, DatePreset } from './types.js';

export interface CitySeed {
  slug: CityId;
  name: LocalizedText;
  name_in: LocalizedText;
  lat: number;
  lon: number;
}

export interface CategorySeed {
  id: CategoryId;
  name: LocalizedText;
  name_one: LocalizedText;
}

export interface VenueSeed {
  id: string;
  legacy_id: string;
  city: CityId;
  name: string;
  address: string | null;
  lat?: number;
  lon?: number;
}

export const CITIES: readonly CitySeed[] = [
  { slug: 'ufa', name: { ru: 'Уфа', ba: 'Өфө' }, name_in: { ru: 'в Уфе', ba: 'Өфөлә' }, lat: 54.74, lon: 55.97 },
  { slug: 'sterlitamak', name: { ru: 'Стерлитамак', ba: 'Стәрлетамаҡ' }, name_in: { ru: 'в Стерлитамаке', ba: 'Стәрлетамаҡта' }, lat: 53.63, lon: 55.95 },
  { slug: 'salavat', name: { ru: 'Салават', ba: 'Салауат' }, name_in: { ru: 'в Салавате', ba: 'Салауатта' }, lat: 53.36, lon: 55.93 },
  { slug: 'neftekamsk', name: { ru: 'Нефтекамск', ba: 'Нефтекама' }, name_in: { ru: 'в Нефтекамске', ba: 'Нефтекамала' }, lat: 56.09, lon: 54.25 },
  { slug: 'oktyabrsky', name: { ru: 'Октябрьский', ba: 'Октябрьский' }, name_in: { ru: 'в Октябрьском', ba: 'Октябрьскийҙа' }, lat: 54.48, lon: 53.47 },
  { slug: 'beloretsk', name: { ru: 'Белорецк', ba: 'Белорет' }, name_in: { ru: 'в Белорецке', ba: 'Белоретта' }, lat: 53.96, lon: 58.4 },
  { slug: 'sibay', name: { ru: 'Сибай', ba: 'Сибай' }, name_in: { ru: 'в Сибае', ba: 'Сибайҙа' }, lat: 52.72, lon: 58.67 },
  { slug: 'kumertau', name: { ru: 'Кумертау', ba: 'Күмертау' }, name_in: { ru: 'в Кумертау', ba: 'Күмертауҙа' }, lat: 52.77, lon: 55.78 },
];

export const CATEGORIES: readonly CategorySeed[] = [
  { id: 'concert', name: { ru: 'Концерты', ba: 'Концерттар' }, name_one: { ru: 'Концерт', ba: 'Концерт' } },
  { id: 'performance', name: { ru: 'Спектакли', ba: 'Спектаклдәр' }, name_one: { ru: 'Спектакль', ba: 'Спектакль' } },
  { id: 'exhibition', name: { ru: 'Выставки', ba: 'Күргәҙмәләр' }, name_one: { ru: 'Выставка', ba: 'Күргәҙмә' } },
  { id: 'festival', name: { ru: 'Фестивали', ba: 'Фестивалдәр' }, name_one: { ru: 'Фестиваль', ba: 'Фестиваль' } },
  { id: 'cinema', name: { ru: 'Кино', ba: 'Кино' }, name_one: { ru: 'Кинопоказ', ba: 'Кино' } },
  { id: 'excursion', name: { ru: 'Экскурсии', ba: 'Экскурсиялар' }, name_one: { ru: 'Экскурсия', ba: 'Экскурсия' } },
  { id: 'other', name: { ru: 'Другое', ba: 'Башҡа' }, name_one: { ru: 'Другое', ba: 'Башҡа' } },
];

export const AGE_RATINGS = [
  { id: '0+' as const, min_age: 0, label: { ru: '0+', ba: '0+' } },
  { id: '6+' as const, min_age: 6, label: { ru: '6+', ba: '6+' } },
  { id: '12+' as const, min_age: 12, label: { ru: '12+', ba: '12+' } },
  { id: '16+' as const, min_age: 16, label: { ru: '16+', ba: '16+' } },
  { id: '18+' as const, min_age: 18, label: { ru: '18+', ba: '18+' } },
] as const;

export const OCCURRENCE_STATUSES: readonly OccurrenceStatus[] = ['scheduled', 'cancelled', 'postponed', 'rescheduled', 'unknown'];
export const DEFAULT_OCCURRENCE_STATUSES: readonly OccurrenceStatus[] = ['scheduled', 'rescheduled'];

export const SEED_VENUES: readonly VenueSeed[] = [
  { legacy_id: 'ven_ufa_opera', id: toVenueSlug('ven_ufa_opera'), name: 'Башкирский государственный театр оперы и балета', city: 'ufa', address: 'ул. Ленина, 5/1', lat: 54.7222, lon: 55.9447 },
  { legacy_id: 'ven_ufa_gafuri', id: toVenueSlug('ven_ufa_gafuri'), name: 'Башкирский академический театр драмы им. М. Гафури', city: 'ufa', address: 'ул. Заки Валиди, 34' },
  { legacy_id: 'ven_ufa_rusdram', id: toVenueSlug('ven_ufa_rusdram'), name: 'Русский академический театр драмы Республики Башкортостан', city: 'ufa', address: 'проспект Октября, 79' },
  { legacy_id: 'ven_ufa_nmt', id: toVenueSlug('ven_ufa_nmt'), name: 'Национальный молодёжный театр им. М. Карима', city: 'ufa', address: null },
  { legacy_id: 'ven_ufa_puppet', id: toVenueSlug('ven_ufa_puppet'), name: 'Башкирский государственный театр кукол', city: 'ufa', address: 'проспект Октября, 158' },
  { legacy_id: 'ven_ufa_philharmonic', id: toVenueSlug('ven_ufa_philharmonic'), name: 'Башкирская государственная филармония им. Х. Ахметова', city: 'ufa', address: 'ул. Гоголя, 58' },
  { legacy_id: 'ven_ufa_gkz', id: toVenueSlug('ven_ufa_gkz'), name: 'Государственный концертный зал «Башкортостан»', city: 'ufa', address: 'ул. Ленина, 50' },
  { legacy_id: 'ven_ufa_toratau', id: toVenueSlug('ven_ufa_toratau'), name: 'Конгресс-холл «Торатау»', city: 'ufa', address: 'ул. Заки Валиди, 2', lat: 54.7183, lon: 55.9258 },
  { legacy_id: 'ven_ufa_national_museum', id: toVenueSlug('ven_ufa_national_museum'), name: 'Национальный музей Республики Башкортостан', city: 'ufa', address: 'ул. Советская, 14', lat: 54.7203, lon: 55.9461 },
  { legacy_id: 'ven_ufa_nesterov', id: toVenueSlug('ven_ufa_nesterov'), name: 'Башкирский государственный художественный музей им. М. В. Нестерова', city: 'ufa', address: null },
  { legacy_id: 'ven_str_tko', id: toVenueSlug('ven_str_tko'), name: 'Стерлитамакское государственное театрально-концертное объединение', city: 'sterlitamak', address: null },
  { legacy_id: 'ven_str_museum', id: toVenueSlug('ven_str_museum'), name: 'Стерлитамакский историко-краеведческий музей', city: 'sterlitamak', address: null },
  { legacy_id: 'ven_str_gallery', id: toVenueSlug('ven_str_gallery'), name: 'Стерлитамакская картинная галерея', city: 'sterlitamak', address: null },
  { legacy_id: 'ven_slv_theatre', id: toVenueSlug('ven_slv_theatre'), name: 'Салаватский государственный башкирский драматический театр', city: 'salavat', address: null },
  { legacy_id: 'ven_slv_gallery', id: toVenueSlug('ven_slv_gallery'), name: 'Салаватская картинная галерея', city: 'salavat', address: null },
  { legacy_id: 'ven_nfk_philharmonic', id: toVenueSlug('ven_nfk_philharmonic'), name: 'Нефтекамская государственная филармония', city: 'neftekamsk', address: null },
  { legacy_id: 'ven_okt_gdk', id: toVenueSlug('ven_okt_gdk'), name: 'Городской дом культуры', city: 'oktyabrsky', address: null },
  { legacy_id: 'ven_okt_museum', id: toVenueSlug('ven_okt_museum'), name: 'Октябрьский историко-краеведческий музей им. А. П. Шокурова', city: 'oktyabrsky', address: null },
  { legacy_id: 'ven_blr_museum', id: toVenueSlug('ven_blr_museum'), name: 'Белорецкий историко-краеведческий музей', city: 'beloretsk', address: null },
  { legacy_id: 'ven_sib_theatre', id: toVenueSlug('ven_sib_theatre'), name: 'Сибайский государственный башкирский театр драмы им. А. Мубарякова', city: 'sibay', address: null },
  { legacy_id: 'ven_kmt_museum', id: toVenueSlug('ven_kmt_museum'), name: 'Кумертауский историко-краеведческий музей', city: 'kumertau', address: null },
];

export const FULL_DICTIONARIES = {
  timezone: 'Asia/Yekaterinburg' as const,
  currency: 'RUB' as const,
  categories: CATEGORIES.map((c) => ({ ...c })),
  cities: CITIES.map((c) => ({ ...c })),
  age_ratings: AGE_RATINGS.map((a) => ({ ...a })),
  statuses: [
    { id: 'scheduled' as OccurrenceStatus, label: { ru: 'Состоится', ba: 'Буласаҡ' }, tone: 'positive' },
    { id: 'cancelled' as OccurrenceStatus, label: { ru: 'Отменён', ba: 'Юҡҡа сығарылған' }, tone: 'negative' },
    { id: 'postponed' as OccurrenceStatus, label: { ru: 'Перенесён, дата уточняется', ba: 'Кисектерелгән, көнө асыҡлана' }, tone: 'warning' },
    { id: 'rescheduled' as OccurrenceStatus, label: { ru: 'Перенесён на новую дату', ba: 'Яңы көнгә күсерелгән' }, tone: 'warning' },
    { id: 'unknown' as OccurrenceStatus, label: { ru: 'Статус не подтверждён', ba: 'Статусы раҫланмаған' }, tone: 'neutral' },
  ],
  display_statuses: [
    { id: 'scheduled', label: { ru: 'Состоится', ba: 'Буласаҡ' }, tone: 'positive' },
    { id: 'cancelled', label: { ru: 'Отменён', ba: 'Юҡҡа сығарылған' }, tone: 'negative' },
    { id: 'postponed', label: { ru: 'Перенесён, дата уточняется', ba: 'Кисектерелгән, көнө асыҡлана' }, tone: 'warning' },
    { id: 'rescheduled', label: { ru: 'Перенесён', ba: 'Күсерелгән' }, tone: 'warning' },
    { id: 'sold_out', label: { ru: 'Билеты кончились', ba: 'Билеттар бөткән' }, tone: 'neutral' },
    { id: 'unverified', label: { ru: 'Статус не подтверждён', ba: 'Статусы раҫланмаған' }, tone: 'neutral' },
  ],
  availability: [
    { id: 'available', label: { ru: 'Билеты есть', ba: 'Билеттар бар' }, tone: 'positive' },
    { id: 'sold_out', label: { ru: 'Билеты кончились', ba: 'Билеттар бөткән' }, tone: 'neutral' },
    { id: 'unknown', label: { ru: 'Наличие билетов не подтверждёнo', ba: 'Билеттар барлығы раҫланмаған' }, tone: 'neutral' },
  ],
  price_kinds: [
    { id: 'free', label: { ru: 'Бесплатно', ba: 'Бушлай' } },
    { id: 'from', label: { ru: 'Платно', ba: 'Түләүле' } },
    { id: 'unknown', label: { ru: 'Цена не указана', ba: 'Хаҡы күрһәтелмәгән' } },
  ],
  offer_audiences: [
    { id: 'adult' as OfferAudience, label: { ru: 'Взрослый', ba: 'Өлкәндәр өсөн' } },
    { id: 'child' as OfferAudience, label: { ru: 'Детский', ba: 'Балалар өсөн' } },
    { id: 'reduced' as OfferAudience, label: { ru: 'Льготный', ba: 'Ташламалы' } },
  ],
  sorts: [
    { id: 'date' as SortKey, label: { ru: 'Сначала ближайшие', ba: 'Башта яҡындағылары' } },
    { id: 'price' as SortKey, label: { ru: 'Сначала дешевле', ba: 'Башта арзаныраҡтары' } },
    { id: 'popularity' as SortKey, label: { ru: 'Сначала популярные', ba: 'Башта популярҙары' } },
  ],
  date_presets: [
    { id: 'today' as DatePreset, label: { ru: 'Сегодня', ba: 'Бөгөн' } },
    { id: 'tomorrow' as DatePreset, label: { ru: 'Завтра', ba: 'Иртәгә' } },
    { id: 'weekend' as DatePreset, label: { ru: 'На выходных', ba: 'Ял көндәрендә' } },
    { id: 'week' as DatePreset, label: { ru: 'На этой неделе', ba: 'Ошо аҙнала' } },
  ],
};

export function findCity(input: string): CitySeed | undefined {
  const norm = normalizeText(input);
  return CITIES.find(
    (c) => c.slug === norm || normalizeText(c.name.ru) === norm || normalizeText(c.name.ba) === norm,
  );
}

const CATEGORY_ALIASES: Record<string, CategoryId> = {
  concert: 'concert',
  концерт: 'concert',
  концерты: 'concert',
  performance: 'performance',
  спектакль: 'performance',
  спектакли: 'performance',
  театр: 'performance',
  exhibition: 'exhibition',
  выставка: 'exhibition',
  выставки: 'exhibition',
  экспозиция: 'exhibition',
  festival: 'festival',
  фестиваль: 'festival',
  фестивали: 'festival',
  cinema: 'cinema',
  кино: 'cinema',
  кинопоказ: 'cinema',
  фильм: 'cinema',
  excursion: 'excursion',
  экскурсия: 'excursion',
  экскурсии: 'excursion',
  other: 'other',
  другое: 'other',
};

export function parseCategoryAlias(input: string): CategoryId | undefined {
  return CATEGORY_ALIASES[normalizeText(input)];
}

export function isCitySlug(v: string): v is CityId {
  return CITIES.some((c) => c.slug === v);
}

export function isCategoryId(v: string): v is CategoryId {
  return CATEGORIES.some((c) => c.id === v);
}
