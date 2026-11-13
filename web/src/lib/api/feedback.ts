/**
 * Обратная связь и заявки организаторов (п. 3, п. 6.3: форма с защитой от спама, п. 10: минимум
 * персональных данных). Проверка полей, ловушка для ботов и хранение заявок для модератора.
 *
 * Защита от спама в три слоя:
 *   1. ловушка (honeypot): скрытое поле website, человек его не видит и не заполняет;
 *   2. ограничение частоты по адресу (обработчик маршрута, lib/api/rate-limit.ts);
 *   3. проверка полей: длина, формат контакта, существующее событие.
 * Имя и контакт хранятся только для ответа и удаляются через FEEDBACK_RETENTION_DAYS дней.
 * В журнал сервера они не пишутся.
 */

import { randomUUID } from 'node:crypto';

import { mutate } from '../admin/store';
import type { Application, ApplicationKind } from '../admin/types';
import { findEvent } from './db';
import type { ApiErrorDetail } from './types';

export const FEEDBACK_RETENTION_DAYS = 90;
export const FEEDBACK_KINDS: readonly ApplicationKind[] = ['organizer_application', 'correction', 'question'];

export const KIND_LABEL: Record<ApplicationKind, string> = {
  organizer_application: 'заявка организатора',
  correction: 'уточнение к карточке',
  question: 'вопрос',
};

export interface FeedbackInput {
  kind: ApplicationKind;
  event_id: string | null;
  name: string;
  contact: string;
  organization: string | null;
  text: string;
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max + 1) : '';
}

/** Заполнена ли ловушка: боты заполняют все поля подряд. */
export function isHoneypotFilled(body: unknown): boolean {
  const website = (body as { website?: unknown } | null)?.website;
  return typeof website === 'string' && website.trim() !== '';
}

export function validateFeedback(body: unknown): { ok: true; value: FeedbackInput } | { ok: false; issues: ApiErrorDetail[] } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, issues: [{ field: 'body', message: 'Форма пришла пустой. Обновите страницу и отправьте ещё раз' }] };
  }
  const input = body as Record<string, unknown>;
  const issues: ApiErrorDetail[] = [];

  const kind = FEEDBACK_KINDS.includes(input.kind as ApplicationKind) ? (input.kind as ApplicationKind) : null;
  if (!kind) issues.push({ field: 'kind', message: 'Выберите, что вы отправляете: заявку, уточнение или вопрос' });

  const name = clean(input.name, 80);
  if (name.length < 2) issues.push({ field: 'name', message: 'Напишите, как к вам обращаться' });
  else if (name.length > 80) issues.push({ field: 'name', message: 'Имя длиннее 80 знаков' });

  const contact = clean(input.contact, 120);
  const digits = contact.replace(/\D/g, '');
  if (!contact) issues.push({ field: 'contact', message: 'Оставьте телефон или e-mail, чтобы мы могли ответить' });
  else if (!EMAIL.test(contact) && !(digits.length >= 10 && digits.length <= 15 && /^[\d\s()+-]+$/.test(contact))) {
    issues.push({ field: 'contact', message: 'Проверьте контакт: нужен e-mail вида name@mail.ru или телефон из 10–11 цифр' });
  }

  const organization = clean(input.organization, 120);
  if (organization.length > 120) issues.push({ field: 'organization', message: 'Название организации длиннее 120 знаков' });

  const text = clean(input.text, 2000);
  if (text.length < 10) issues.push({ field: 'text', message: 'Опишите обращение подробнее: хотя бы одно предложение' });
  else if (text.length > 2000) issues.push({ field: 'text', message: 'Текст длиннее 2000 знаков. Сократите его' });

  let eventId: string | null = null;
  if (input.event_id !== undefined && input.event_id !== null && input.event_id !== '') {
    const event = typeof input.event_id === 'string' && /^[a-z0-9_-]{1,64}$/.test(input.event_id) ? findEvent(input.event_id) : null;
    if (!event) issues.push({ field: 'event_id', message: 'Событие не найдено. Обновите страницу события' });
    else eventId = event.id;
  }

  if (issues.length || !kind) return { ok: false, issues };
  return { ok: true, value: { kind, event_id: eventId, name, contact, organization: organization || null, text } };
}

/** Сохраняет обращение для модератора и удаляет заявки старше срока хранения. */
export function storeFeedback(input: FeedbackInput, now: Date = new Date()): Application {
  const application: Application = {
    id: `fb_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    kind: input.kind,
    event_id: input.event_id,
    event_title: input.event_id ? (findEvent(input.event_id, now)?.title ?? null) : null,
    name: input.name,
    contact: input.contact,
    organization: input.organization,
    text: input.text,
    status: 'new',
  };
  const cutoff = now.getTime() - FEEDBACK_RETENTION_DAYS * 86_400_000;
  mutate((state) => {
    state.applications = state.applications.filter((item) => Date.parse(item.at) >= cutoff);
    state.applications.push(application);
    // В журнал попадает только вид обращения и событие, без имени и контакта.
    state.audit.push({
      id: `aud_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      at: application.at,
      actor: 'форма на сайте',
      action: 'application',
      entity_type: 'application',
      entity_id: application.id,
      entity_title: application.event_title ? `${KIND_LABEL[application.kind]}: ${application.event_title}` : KIND_LABEL[application.kind],
      changes: [],
    });
  });
  return application;
}
