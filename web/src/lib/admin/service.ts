/**
 * Операции админки поверх хранилища: список и правка событий, импорт, модерация, журнал.
 * Каждое изменение пишет запись в журнал: кто, когда и что (п. 6.1).
 */

import { randomUUID } from 'node:crypto';

import { findEvent, getVenues, loadCatalog } from '../api/db';
import { etagOf } from '../api/http';
import { normalizeText } from '../api/text';
import type { AfishaEvent, ApiErrorDetail, EventStatus } from '../api/types';
import { toApiEvent } from '../api/wire';
import type { ApiEvent } from '../api/wire';
import { planImport } from './import';
import type { ImportContext } from './import';
import { applyEditToRecord } from './records';
import { mutate, readState } from './store';
import type { AdminState, AuditEntry, EditableFields, FieldChange, ImportReport } from './types';
import { validateEdit } from './validate';

export const STATUS_LABELS: Record<EventStatus, string> = {
  published: 'опубликовано',
  draft: 'черновик',
  cancelled: 'отменено',
};

function nowIso(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function auditEntry(entry: Omit<AuditEntry, 'id'>): AuditEntry {
  return { id: `aud_${randomUUID().replace(/-/g, '').slice(0, 16)}`, ...entry };
}

// ---------------------------------------------------------------------------
// Список и карточка
// ---------------------------------------------------------------------------

export interface AdminListQuery {
  status?: EventStatus;
  disputed?: boolean;
  q?: string;
  source?: 'demo' | 'import';
  page?: number;
  page_size?: number;
}

export interface AdminListItem extends ApiEvent {
  etag: string;
}

function withEtag(event: AfishaEvent): AdminListItem {
  const wire = toApiEvent(event);
  return { ...wire, etag: etagOf(wire) };
}

export function listAdminEvents(query: AdminListQuery, now: Date = new Date()) {
  const q = query.q ? normalizeText(query.q) : '';
  const all = loadCatalog(now, { all: true }).events;
  const filtered = all
    .filter((event) => !query.status || event.status === query.status)
    .filter((event) => query.disputed === undefined || Boolean(event.review?.disputed) === query.disputed)
    .filter((event) => !query.source || (query.source === 'demo' ? event.synthetic : !event.synthetic))
    .filter((event) => !q || normalizeText(`${event.title} ${event.venue.name} ${event.venue.city_name.ru}`).includes(q))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.title.localeCompare(b.title, 'ru'));
  const pageSize = Math.min(Math.max(query.page_size ?? 25, 1), 100);
  const page = Math.max(query.page ?? 1, 1);
  const counts = {
    all: all.length,
    published: all.filter((event) => event.status === 'published').length,
    draft: all.filter((event) => event.status === 'draft').length,
    cancelled: all.filter((event) => event.status === 'cancelled').length,
    disputed: all.filter((event) => event.review?.disputed).length,
  };
  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize).map(withEtag),
    total: filtered.length,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(filtered.length / pageSize),
    counts,
  };
}

export function getAdminEvent(id: string, now: Date = new Date()): AdminListItem | null {
  const event = findEvent(id, now, { includeDrafts: true });
  return event ? withEtag(event) : null;
}

// ---------------------------------------------------------------------------
// Правка
// ---------------------------------------------------------------------------

export type EditResult =
  | { ok: true; event: AdminListItem; changes: FieldChange[] }
  | { ok: false; status: number; code: string; message: string; details?: ApiErrorDetail[] };

/** Текущее значение поля события в терминах правки, чтобы журнал писал «было → стало». */
function currentValue(event: AfishaEvent, field: keyof EditableFields): unknown {
  switch (field) {
    case 'address':
      return event.venue.address;
    case 'org_link':
      return event.ticket_url ?? null;
    default:
      return (event as unknown as Record<string, unknown>)[field] ?? null;
  }
}

/**
 * Правка события модератором. ifMatch: ETag, который видел модератор; если событие
 * успели изменить, ответ 412 и правка не применяется.
 */
export function editEvent(id: string, body: unknown, ifMatch: string | null, actor: string, now: Date = new Date()): EditResult {
  const event = findEvent(id, now, { includeDrafts: true });
  if (!event) return { ok: false, status: 404, code: 'not_found', message: 'Событие не найдено' };
  const current = withEtag(event);
  if (!ifMatch) {
    return {
      ok: false,
      status: 409,
      code: 'conflict',
      message: 'Нет заголовка If-Match: откройте карточку заново и повторите правку',
    };
  }
  if (ifMatch.trim() !== '*' && ifMatch.replace(/^W\//, '') !== current.etag.replace(/^W\//, '')) {
    return {
      ok: false,
      status: 412,
      code: 'precondition_failed',
      message: 'Событие уже изменили, пока вы его правили. Обновите карточку и внесите правку заново',
    };
  }
  const isRecord = !event.synthetic;
  const parsed = validateEdit(body, { datesEditable: isRecord });
  if (!parsed.ok) {
    return { ok: false, status: 400, code: 'validation_error', message: parsed.issues[0].message, details: parsed.issues };
  }
  const fields = parsed.value;
  const changes: FieldChange[] = (Object.keys(fields) as (keyof EditableFields)[])
    .map((field) => ({ field, from: currentValue(event, field), to: fields[field] ?? null }))
    .filter((change) => JSON.stringify(change.from) !== JSON.stringify(change.to));
  if (changes.length === 0) return { ok: true, event: current, changes };

  const at = nowIso(now);
  mutate((state) => {
    if (isRecord) {
      const record = state.records[event.id];
      state.records[event.id] = applyEditToRecord(record, fields, at);
    } else {
      const patch = state.patches[event.id] ?? { fields: {}, updated_at: at };
      state.patches[event.id] = { ...patch, fields: { ...patch.fields, ...fields }, updated_at: at };
    }
    const onlyStatus = changes.every((change) => change.field === 'status');
    state.audit.push(
      auditEntry({
        at,
        actor,
        action: onlyStatus ? 'status' : 'update',
        entity_type: 'event',
        entity_id: event.id,
        entity_title: fields.title ?? event.title,
        changes,
      }),
    );
  });
  const updated = getAdminEvent(event.id, now);
  return { ok: true, event: updated as AdminListItem, changes };
}

// ---------------------------------------------------------------------------
// Импорт
// ---------------------------------------------------------------------------

export function importContext(state: AdminState, actor: string, now: Date): ImportContext {
  const events = loadCatalog(now, { all: true }).events;
  return {
    now,
    actor,
    importId: `imp_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    venues: getVenues(),
    events: events.map((event) => ({
      id: event.id,
      kind: event.synthetic ? ('seed' as const) : ('record' as const),
      title: event.title,
      dedup_key: event.dedup_key,
      sources: event.sources,
    })),
    records: state.records,
  };
}

export function runImport(
  text: string,
  options: { format: 'csv' | 'json'; fileName: string | null },
  actor: string,
  now: Date = new Date(),
): { ok: true; report: ImportReport } | { ok: false; code: string; message: string } {
  const ctx = importContext(readState(), actor, now);
  const plan = planImport(text, options, ctx);
  if (!plan.ok) return plan;
  const at = nowIso(now);
  mutate((state) => {
    for (const op of plan.ops) {
      if (op.op === 'add') {
        state.records[op.record.id] = op.record;
        state.audit.push(
          auditEntry({
            at,
            actor,
            action: 'import_add',
            entity_type: 'event',
            entity_id: op.record.id,
            entity_title: op.record.title,
            changes: [],
            import_id: ctx.importId,
            note: `Строка ${op.row}${op.record.review ? '; спорная, в очереди модерации' : ''}`,
          }),
        );
      } else if (op.op === 'update') {
        state.records[op.id] = op.after;
        state.audit.push(
          auditEntry({
            at,
            actor,
            action: 'import_update',
            entity_type: 'event',
            entity_id: op.id,
            entity_title: op.after.title,
            changes: op.changes,
            import_id: ctx.importId,
            note: `Строка ${op.row}`,
          }),
        );
      } else {
        if (op.targetKind === 'record') {
          const record = state.records[op.targetId];
          if (record && !record.sources.some((item) => item.source_hash === op.source.source_hash)) {
            state.records[op.targetId] = { ...record, sources: [...record.sources, op.source], updated_at: at };
          }
        } else {
          const patch = state.patches[op.targetId] ?? { fields: {}, updated_at: at };
          const extra = patch.extra_sources ?? [];
          if (!extra.some((item) => item.source_hash === op.source.source_hash)) {
            state.patches[op.targetId] = { ...patch, extra_sources: [...extra, op.source], updated_at: at };
          }
        }
        state.audit.push(
          auditEntry({
            at,
            actor,
            action: 'import_merge',
            entity_type: 'event',
            entity_id: op.targetId,
            entity_title: op.targetTitle,
            changes: [{ field: 'sources', from: null, to: op.source.source_url }],
            import_id: ctx.importId,
            note: `Строка ${op.row}: то же событие из другого источника, дубль не создан`,
          }),
        );
      }
    }
    state.imports.push(plan.report);
    state.audit.push(
      auditEntry({
        at,
        actor,
        action: 'import',
        entity_type: 'import',
        entity_id: ctx.importId,
        entity_title: options.fileName ?? 'файл без имени',
        changes: [],
        import_id: ctx.importId,
        note: `Получено ${plan.report.received}: добавлено ${plan.report.added}, обновлено ${plan.report.updated}, источников добавлено ${plan.report.merged}, без изменений ${plan.report.unchanged}, отклонено ${plan.report.rejected.length}`,
      }),
    );
  });
  return { ok: true, report: plan.report };
}

export function listImports(): ImportReport[] {
  return [...readState().imports].reverse();
}

// ---------------------------------------------------------------------------
// Модерация
// ---------------------------------------------------------------------------

export interface ModerationItem {
  event: AdminListItem;
  reasons: string[];
  /** Возможные дубли: события с тем же нормализованным названием в том же городе. */
  duplicate_candidates: string[];
}

export function moderationQueue(
  query: { page?: number; page_size?: number } = {},
  now: Date = new Date(),
): { items: ModerationItem[]; page: number; page_size: number; total: number; total_pages: number } {
  const all = loadCatalog(now, { all: true }).events;
  const disputed = all
    .filter((event) => event.review?.disputed)
    .sort((a, b) => a.confidence - b.confidence || b.updated_at.localeCompare(a.updated_at));
  const pageSize = Math.min(Math.max(query.page_size ?? 50, 1), 100);
  const page = Math.max(query.page ?? 1, 1);
  const items = disputed.slice((page - 1) * pageSize, page * pageSize).map((event) => ({
    event: withEtag(event),
    reasons: [...(event.review?.reasons ?? [])],
    duplicate_candidates: all
      .filter(
        (other) =>
          other.id !== event.id &&
          other.venue.city === event.venue.city &&
          (other.normalized_title === event.normalized_title ||
            other.normalized_title.includes(event.normalized_title) ||
            event.normalized_title.includes(other.normalized_title)),
      )
      .map((other) => other.id),
  }));
  return { items, page, page_size: pageSize, total: disputed.length, total_pages: Math.ceil(disputed.length / pageSize) };
}

export type ModerationAction = 'publish' | 'keep_draft' | 'cancel' | 'merge';

const ACTION_STATUS: Record<ModerationAction, EventStatus> = {
  publish: 'published',
  keep_draft: 'draft',
  cancel: 'cancelled',
  // Дубль остаётся черновиком, а его источники переходят в основную карточку.
  merge: 'draft',
};

export function resolveDisputed(
  id: string,
  action: ModerationAction,
  comment: string | null,
  actor: string,
  now: Date = new Date(),
  mergeInto: string | null = null,
): EditResult {
  const event = findEvent(id, now, { includeDrafts: true });
  if (!event) return { ok: false, status: 404, code: 'not_found', message: 'Событие не найдено' };
  if (!event.review?.disputed) {
    return { ok: false, status: 409, code: 'conflict', message: 'Карточка уже не в очереди: её разобрал другой модератор' };
  }
  const target = action === 'merge' && mergeInto ? findEvent(mergeInto, now, { includeDrafts: true }) : null;
  if (action === 'merge' && (!target || target.id === event.id)) {
    return {
      ok: false,
      status: 400,
      code: 'validation_error',
      message: 'Укажите, в какую карточку свести дубль',
      details: [{ field: 'merge_into', message: 'Укажите, в какую карточку свести дубль' }],
    };
  }
  const at = nowIso(now);
  const status = ACTION_STATUS[action];
  const review = { disputed: false, reasons: event.review.reasons, ...(target ? { merged_into: target.id } : {}) };
  const changes: FieldChange[] = [
    { field: 'review.disputed', from: true, to: false },
    ...(status !== event.status ? [{ field: 'status', from: event.status, to: status }] : []),
    ...(target ? [{ field: 'merged_into', from: null, to: target.title }] : []),
  ];
  mutate((state) => {
    if (event.synthetic) {
      const patch = state.patches[event.id] ?? { fields: {}, updated_at: at };
      state.patches[event.id] = { ...patch, fields: { ...patch.fields, status }, review, updated_at: at };
    } else {
      const record = state.records[event.id];
      state.records[event.id] = { ...record, status, review, updated_at: at };
    }
    if (target) {
      const moved = event.sources.filter((source) => !target.sources.some((item) => item.source_hash === source.source_hash));
      if (target.synthetic) {
        const patch = state.patches[target.id] ?? { fields: {}, updated_at: at };
        state.patches[target.id] = { ...patch, extra_sources: [...(patch.extra_sources ?? []), ...moved], updated_at: at };
      } else if (state.records[target.id]) {
        state.records[target.id] = { ...state.records[target.id], sources: [...state.records[target.id].sources, ...moved], updated_at: at };
      }
    }
    state.audit.push(
      auditEntry({
        at,
        actor,
        action: 'moderation',
        entity_type: 'event',
        entity_id: event.id,
        entity_title: event.title,
        changes,
        note: `Решение: ${target ? `дубль, сведён в «${target.title}»` : STATUS_LABELS[status]}${comment ? `. ${comment.slice(0, 300)}` : ''}`,
      }),
    );
  });
  return { ok: true, event: getAdminEvent(event.id, now) as AdminListItem, changes };
}

// ---------------------------------------------------------------------------
// Журнал и сброс
// ---------------------------------------------------------------------------

export function listAudit(query: { entity_id?: string; page?: number; page_size?: number }) {
  const all = [...readState().audit].reverse().filter((entry) => !query.entity_id || entry.entity_id === query.entity_id);
  const pageSize = Math.min(Math.max(query.page_size ?? 50, 1), 200);
  const page = Math.max(query.page ?? 1, 1);
  return {
    items: all.slice((page - 1) * pageSize, page * pageSize),
    total: all.length,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(all.length / pageSize),
  };
}

/** Вернуть демо-данные к исходному виду. Журнал сохраняется, сброс в нём записан. */
export function resetDemo(actor: string, now: Date = new Date()): void {
  const at = nowIso(now);
  mutate((state) => {
    const counts = { patches: Object.keys(state.patches).length, records: Object.keys(state.records).length };
    state.patches = {};
    state.records = {};
    state.imports = [];
    state.audit.push(
      auditEntry({
        at,
        actor,
        action: 'reset',
        entity_type: 'system',
        entity_id: 'demo',
        changes: [],
        note: `Сброшено правок: ${counts.patches}, импортированных событий: ${counts.records}`,
      }),
    );
  });
}
