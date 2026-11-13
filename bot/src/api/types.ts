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

export const EventListResponseSchema = z.looseObject({
  items: z.array(EventListItemSchema),
  page: z.number().int(),
  page_size: z.number().int(),
  total: z.number().int(),
  total_pages: z.number().int(),
  facets: z.unknown().optional(),
  relaxations: z.array(z.unknown()).default([]),
  hidden_unknown_price: z.number().int().optional(),
  hidden_unknown_age: z.number().int().optional(),
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
export type City = z.infer<typeof CitySchema>;
export type Category = z.infer<typeof CategorySchema>;
export type Subscription = z.infer<typeof SubscriptionSchema>;
export type SubscriptionList = z.infer<typeof SubscriptionListSchema>;
export type Health = z.infer<typeof HealthSchema>;
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
