/**
 * Типы админки: записи событий, правки, журнал, отчёт импорта, заявки организаторов.
 * Контракт тот же, что у API /api/v1/admin/* (contracts/api.openapi.yaml, тег admin).
 */

import type {
  AgeLimit,
  CategoryId,
  CityId,
  EventReview,
  EventSource,
  EventStatus,
  SourceType,
  TimePrecision,
} from '../api/types';

/** Событие, введённое вручную или импортированное: все поля п. 8.1 плюс расширения. */
export interface StoredRecord {
  id: string;
  title: string;
  normalized_title: string;
  category: CategoryId;
  tags: string[];
  date_start: string;
  date_end: string | null;
  duration_min: number | null;
  time_precision: TimePrecision;
  city_id: CityId;
  venue_id: string;
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
  sources: EventSource[];
  review?: EventReview;
  /** Каким импортом запись создана или последний раз обновлена. */
  import_id?: string;
}

/** Поля, которые модератор правит вручную. Даты меняются только у введённых и импортированных записей. */
export interface EditableFields {
  title?: string;
  description?: string;
  category?: CategoryId;
  tags?: string[];
  status?: EventStatus;
  age_limit?: AgeLimit | null;
  price_min?: number | null;
  price_max?: number | null;
  is_free?: boolean;
  address?: string | null;
  org_link?: string | null;
  language?: string | null;
  source_url?: string;
  date_start?: string;
  date_end?: string | null;
}

export const EDITABLE_FIELDS: readonly (keyof EditableFields)[] = [
  'title',
  'description',
  'category',
  'tags',
  'status',
  'age_limit',
  'price_min',
  'price_max',
  'is_free',
  'address',
  'org_link',
  'language',
  'source_url',
  'date_start',
  'date_end',
];

/** Правка поверх демо-события: изменённые поля, решение по спорной карточке, добавленные источники. */
export interface EventPatch {
  fields: EditableFields;
  review?: EventReview;
  extra_sources?: EventSource[];
  updated_at: string;
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export type AuditAction =
  | 'create'
  | 'import'
  | 'update'
  | 'status'
  | 'import_add'
  | 'import_update'
  | 'import_merge'
  | 'moderation'
  | 'application'
  | 'reset';

/** Запись журнала: кто, когда и что изменил (п. 6.1). */
export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: AuditAction;
  entity_type: 'event' | 'import' | 'application' | 'system';
  entity_id: string;
  /** Подпись сущности для человека: название события, имя файла. */
  entity_title?: string;
  changes: FieldChange[];
  import_id?: string;
  note?: string;
}

export interface ImportRejected {
  /** Номер строки файла: у CSV считается с заголовком (первая запись это строка 2), у JSON с 1. */
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

export interface ImportChanged {
  row: number;
  id: string;
  title: string;
  /** Что сделано: добавлено, обновлено, добавлен источник к существующей карточке. */
  outcome: 'added' | 'updated' | 'merged' | 'unchanged';
  note?: string;
}

/** Отчёт об импорте (п. 6.1): сколько добавлено, обновлено, без изменений, отклонено и почему. */
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
  rows: ImportChanged[];
}

export type ApplicationKind = 'organizer_application' | 'correction' | 'question';

/** Заявка или уточнение от организатора (п. 3, п. 6.3: форма с защитой от спама). */
export interface Application {
  id: string;
  at: string;
  kind: ApplicationKind;
  event_id: string | null;
  event_title: string | null;
  name: string;
  contact: string;
  organization: string | null;
  text: string;
  status: 'new' | 'done';
}

export interface AdminState {
  version: 1;
  patches: Record<string, EventPatch>;
  records: Record<string, StoredRecord>;
  audit: AuditEntry[];
  imports: ImportReport[];
  applications: Application[];
}
