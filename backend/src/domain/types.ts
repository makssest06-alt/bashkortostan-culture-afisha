export type CategoryId = 'concert' | 'performance' | 'exhibition' | 'festival' | 'cinema' | 'excursion' | 'other';
export type EventStatus = 'published' | 'draft' | 'cancelled';
export type SourceType = 'manual' | 'import' | 'rss' | 'api' | 'page';
export type AgeLimit = 0 | 6 | 12 | 16 | 18;
export type OccurrenceStatus = 'scheduled' | 'cancelled' | 'postponed' | 'rescheduled' | 'unknown';
export type Availability = 'available' | 'sold_out' | 'unknown';
export type TimePrecision = 'minute' | 'date';
export type EventKind = 'standalone' | 'performance_run' | 'exhibition' | 'festival';
export type OfferAudience = 'adult' | 'child' | 'reduced';
export type SortKey = 'date' | 'price' | 'popularity';
export type DatePreset = 'today' | 'tomorrow' | 'weekend' | 'week';

export type CityId =
  | 'ufa'
  | 'sterlitamak'
  | 'salavat'
  | 'neftekamsk'
  | 'oktyabrsky'
  | 'beloretsk'
  | 'sibay'
  | 'kumertau';

export interface LocalizedText {
  ru: string;
  ba: string;
}

export interface ApiOccurrence {
  id: string;
  date_start: string;
  date_end: string | null;
  time_precision: TimePrecision;
  status: OccurrenceStatus;
  status_verified: boolean;
  previous_date_start?: string;
  availability: Availability;
  is_past: boolean;
}

export interface ApiOffer {
  name?: string;
  price: number | null;
  audience?: OfferAudience;
  is_free: boolean;
}

export interface ApiEventSource {
  source_url: string;
  source_type: SourceType;
  source_hash: string;
  verified_at: string | null;
  title?: string;
}

export interface ApiEventReview {
  disputed: boolean;
  reasons: string[];
}

export interface ApiEvent {
  id: string;
  title: string;
  normalized_title: string;
  category: CategoryId;
  tags: string[];
  date_start: string | null;
  date_end: string | null;
  duration_min: number | null;
  city: string;
  venue: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
  description: string;
  price_min: number | null;
  price_max: number | null;
  is_free: boolean;
  age_limit: AgeLimit | null;
  language: string | null;
  org_link: string | null;
  source_url: string;
  source_type: SourceType;
  source_hash: string;
  verified_at: string | null;
  confidence: number;
  status: EventStatus;
  dedup_key: string;
  created_at: string;
  updated_at: string;
  city_id: CityId;
  venue_id: string;
  time_precision: TimePrecision;
  kind: EventKind;
  popularity: number;
  organizer: string | null;
  image: string | null;
  title_ba?: string | null;
  synthetic: boolean;
  sources: ApiEventSource[];
  occurrences: ApiOccurrence[];
  offers: ApiOffer[];
  review?: ApiEventReview;
}

export interface ApiEventListItem extends ApiEvent {
  matched_occurrence_ids: string[];
  primary_occurrence_id: string;
}

export interface AdminEvent extends ApiEvent {
  etag: string;
  merged_into?: string | null;
}

export interface ApiErrorDetail {
  field?: string;
  message: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details: ApiErrorDetail[];
  request_id: string;
}

export interface ImportRejected {
  row: number;
  source_hash?: string;
  reason_code: string;
  reason: string;
}

export interface ImportDisputed {
  row: number;
  id: string;
  title: string;
  reasons: string[];
}

export interface ImportRowResult {
  row: number;
  id?: string;
  title: string;
  outcome: 'added' | 'updated' | 'merged' | 'unchanged';
  note?: string;
}

export interface ImportReport {
  import_id: string;
  at: string;
  actor: string;
  file_name: string | null;
  format: 'csv' | 'json';
  received: number;
  added: number;
  updated: number;
  merged: number;
  unchanged: number;
  rejected: ImportRejected[];
  disputed: ImportDisputed[];
  rows: ImportRowResult[];
}
