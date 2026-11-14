import { z } from 'zod';

export const OccurrenceStatusSchema = z.enum([
  'scheduled',
  'cancelled',
  'postponed',
  'rescheduled',
  'unknown',
]);

export const OccurrenceSchema = z.looseObject({
  id: z.string(),
  date_start: z.string(),
  date_end: z.string().nullable(),
  time_precision: z.enum(['minute', 'date']),
  status: OccurrenceStatusSchema,
  status_verified: z.boolean().optional(),
  previous_date_start: z.string().optional(),
  availability: z.enum(['available', 'sold_out', 'unknown']).optional(),
  is_past: z.boolean(),
});

export const OfferSchema = z.looseObject({
  name: z.string().optional(),
  price: z.number().nullable(),
  audience: z.enum(['adult', 'child', 'reduced']).optional(),
  is_free: z.boolean(),
});

export const EventSourceSchema = z.looseObject({
  source_url: z.string(),
  source_type: z.string(),
  source_hash: z.string(),
  verified_at: z.string().nullable().optional(),
  title: z.string().optional(),
});

export const EventReviewSchema = z.looseObject({
  disputed: z.boolean(),
  reasons: z.array(z.string()),
});

export const EventSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  normalized_title: z.string().optional(),
  category: z.string(),
  tags: z.array(z.string()).default([]),
  date_start: z.string().nullable(),
  date_end: z.string().nullable(),
  duration_min: z.number().nullable(),
  city: z.string(),
  venue: z.string(),
  address: z.string().nullable(),
  lat: z.number().nullable().optional(),
  lon: z.number().nullable().optional(),
  description: z.string(),
  price_min: z.number().nullable(),
  price_max: z.number().nullable(),
  is_free: z.boolean(),
  age_limit: z.number().int().nullable(),
  language: z.string().nullable(),
  org_link: z.string().nullable(),
  source_url: z.string(),
  source_type: z.string().optional(),
  source_hash: z.string().optional(),
  verified_at: z.string().nullable().optional(),
  confidence: z.number().optional(),
  status: z.enum(['published', 'draft', 'cancelled']),
  dedup_key: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  city_id: z.string(),
  venue_id: z.string().optional(),
  time_precision: z.enum(['minute', 'date']).optional(),
  kind: z.string().optional(),
  popularity: z.number().optional(),
  organizer: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  title_ba: z.string().nullable().optional(),
  synthetic: z.boolean().optional(),
  sources: z.array(EventSourceSchema).default([]),
  occurrences: z.array(OccurrenceSchema).default([]),
  offers: z.array(OfferSchema).default([]),
  review: EventReviewSchema.optional(),
});

export const EventListItemSchema = EventSchema.extend({
  matched_occurrence_ids: z.array(z.string()).default([]),
  primary_occurrence_id: z.string().optional(),
});

export const FacetEntrySchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  count: z.number().int().nonnegative(),
});

export const AgeFacetSchema = z.looseObject({
  value: z.number().int().nullable(),
  count: z.number().int().nonnegative(),
});

export const PriceFacetSchema = z.looseObject({
  free: z.number().int().nonnegative().default(0),
  paid: z.number().int().nonnegative().default(0),
  unknown: z.number().int().nonnegative().default(0),
});

/**
 * Счётчики для фильтров. Все поля необязательны: старый бэкенд может
 * не отдать `facets`, а частичный ответ не должен ломать всю выдачу.
 */
export const FacetsSchema = z.looseObject({
  cities: z.array(FacetEntrySchema).default([]),
  categories: z.array(FacetEntrySchema).default([]),
  age_limits: z.array(AgeFacetSchema).default([]),
  price: PriceFacetSchema.default({ free: 0, paid: 0, unknown: 0 }),
  total: z.number().int().nonnegative().default(0),
});

export const RelaxationLabelSchema = z.union([
  z.string(),
  z.looseObject({ ru: z.string(), ba: z.string().optional() }),
]);

/**
 * Вариант ослабления пустой выдачи, который предлагает сервер.
 * `query` — готовые параметры GET /events, `patch` — правка условий
 * ассистента. Бот использует `query`, а `patch` оставляет для будущего.
 */
export const RelaxationSchema = z.looseObject({
  code: z.string(),
  codes: z.array(z.string()).default([]),
  label: RelaxationLabelSchema,
  patch: z.record(z.string(), z.unknown()).optional(),
  query: z.record(z.string(), z.unknown()).optional(),
  count: z.number().int().nonnegative(),
});

export const EventListResponseSchema = z.looseObject({
  items: z.array(EventListItemSchema),
  page: z.number().int(),
  page_size: z.number().int(),
  total: z.number().int(),
  total_pages: z.number().int(),
  facets: FacetsSchema.optional(),
  relaxations: z.array(RelaxationSchema).default([]),
  hidden_unknown_price: z.number().int().optional(),
  hidden_unknown_age: z.number().int().optional(),
});

export const VenueSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  city_id: z.string(),
  city: z.string(),
  address: z.string().nullable().optional(),
  lat: z.number().nullable().optional(),
  lon: z.number().nullable().optional(),
});

export const VenueScheduleSchema = z.looseObject({
  venue: VenueSchema,
  date_from: z.string(),
  date_to: z.string(),
  items: z.array(EventSchema).default([]),
});

/**
 * Ответ ассистента. Схема намеренно loose: бэкенд уровня 3 ещё в PR #19,
 * а старый стенд может не знать метода. Неизвестные поля не ломают разбор,
 * отсутствующие массивы получают безопасные значения по умолчанию.
 */
export const AssistantActionSchema = z.enum([
  'search',
  'clarify',
  'out_of_scope',
  'confirmation_required',
]);

export const AssistantChipSchema = z.looseObject({
  key: z.string(),
  kind: z.string().default(''),
  label: z.string(),
  value: z.string().default(''),
  removable: z.boolean().optional(),
  unset: z.array(z.string()).default([]),
});

export const AssistantAssumptionSchema = z.looseObject({
  key: z.string().default(''),
  text: z.string(),
});

export const AssistantClarifySchema = z.looseObject({
  code: z.string(),
  pending: z.array(z.string()).default([]),
  question: z.string(),
  quick_replies: z.array(z.string()).default([]),
});

export const AssistantResultSchema = z.looseObject({
  event: EventListItemSchema,
  occurrence_id: z.string().nullable().optional(),
  reasons: z.array(z.string()).default([]),
  caveats: z.array(z.string()).default([]),
});

export const AssistantConfirmationSchema = z.looseObject({
  confirmation_id: z.string(),
  summary: z.string().default(''),
  expires_at: z.string().optional(),
});

export const AssistantResponseSchema = z.looseObject({
  action: AssistantActionSchema,
  message: z.string(),
  constraints: z.record(z.string(), z.unknown()).default({}),
  chips: z.array(AssistantChipSchema).default([]),
  assumptions: z.array(AssistantAssumptionSchema).default([]),
  clarify: AssistantClarifySchema.optional(),
  results: z.array(AssistantResultSchema).default([]),
  total: z.number().int().nonnegative().default(0),
  hidden_unknown_price: z.number().int().nonnegative().optional(),
  hidden_unknown_age: z.number().int().nonnegative().optional(),
  relaxations: z.array(RelaxationSchema).default([]),
  unsupported_actions: z.array(z.string()).default([]),
  confirmation: AssistantConfirmationSchema.optional(),
  events_query: z.record(z.string(), z.unknown()).optional(),
  reference_date: z.string().optional(),
  timezone: z.string().default('Asia/Yekaterinburg'),
  engine: z.string().default(''),
  trace_id: z.string().optional(),
});

export const CitySchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  name_ba: z.string().optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
});

export const CategorySchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  name_ba: z.string().optional(),
});

export const CityListSchema = z.looseObject({ items: z.array(CitySchema) });
export const CategoryListSchema = z.looseObject({ items: z.array(CategorySchema) });

export const SubscriptionSchema = z.looseObject({
  id: z.string(),
  channel: z.enum(['telegram', 'web']),
  user_ref: z.string().optional(),
  city: z.string().nullable(),
  category: z.string().nullable(),
  period: z.enum(['today', 'tomorrow', 'weekend', 'week']).nullable(),
  created_at: z.string(),
});

export const SubscriptionListSchema = z.looseObject({
  items: z.array(SubscriptionSchema),
});

export const HealthSchema = z.looseObject({
  status: z.string(),
  events_count: z.number().optional(),
  model: z.string().optional(),
  timezone: z.string().optional(),
});

export const ApiErrorBodySchema = z.looseObject({
  code: z.string(),
  message: z.string(),
  details: z
    .array(z.looseObject({ field: z.string().optional(), message: z.string() }))
    .default([]),
  request_id: z.string().optional(),
});

export type OccurrenceStatus = z.infer<typeof OccurrenceStatusSchema>;
export type Occurrence = z.infer<typeof OccurrenceSchema>;
export type Offer = z.infer<typeof OfferSchema>;
export type EventSource = z.infer<typeof EventSourceSchema>;
export type Event = z.infer<typeof EventSchema>;
export type EventListItem = z.infer<typeof EventListItemSchema>;
export type EventListResponse = z.infer<typeof EventListResponseSchema>;
export type FacetEntry = z.infer<typeof FacetEntrySchema>;
export type AgeFacet = z.infer<typeof AgeFacetSchema>;
export type PriceFacet = z.infer<typeof PriceFacetSchema>;
export type Facets = z.infer<typeof FacetsSchema>;
export type Relaxation = z.infer<typeof RelaxationSchema>;
export type Venue = z.infer<typeof VenueSchema>;
export type VenueSchedule = z.infer<typeof VenueScheduleSchema>;
export type AssistantAction = z.infer<typeof AssistantActionSchema>;
export type AssistantChip = z.infer<typeof AssistantChipSchema>;
export type AssistantAssumption = z.infer<typeof AssistantAssumptionSchema>;
export type AssistantClarify = z.infer<typeof AssistantClarifySchema>;
export type AssistantResult = z.infer<typeof AssistantResultSchema>;
export type AssistantConfirmation = z.infer<typeof AssistantConfirmationSchema>;
export type AssistantResponse = z.infer<typeof AssistantResponseSchema>;
export type City = z.infer<typeof CitySchema>;
export type Category = z.infer<typeof CategorySchema>;
export type Subscription = z.infer<typeof SubscriptionSchema>;
export type SubscriptionList = z.infer<typeof SubscriptionListSchema>;
export type Health = z.infer<typeof HealthSchema>;
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
