/**
 * Клиент API админки для страниц /admin. Ошибки приходят в едином формате
 * { code, message, details, request_id } и превращаются в AdminError с полями для формы.
 */

import type { ApiErrorDetail } from '@/lib/api/types';

export class AdminError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetail[];
  readonly requestId?: string;

  constructor(status: number, code: string, message: string, details: ApiErrorDetail[] = [], requestId?: string) {
    super(message);
    this.name = 'AdminError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** Ошибки по полям формы: { title: 'Не указано название' }. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.details.map((detail) => [detail.field, detail.message]));
  }
}

export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<{ data: T; etag: string | null }> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/admin${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(init.headers ?? {}) },
    });
  } catch {
    throw new AdminError(0, 'network_error', 'Нет связи с сервером. Проверьте интернет и повторите');
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error = (body ?? {}) as { code?: string; message?: string; details?: ApiErrorDetail[]; request_id?: string };
    throw new AdminError(
      response.status,
      error.code ?? 'http_error',
      error.message ?? 'Сервер ответил ошибкой. Повторите действие',
      error.details ?? [],
      error.request_id,
    );
  }
  return { data: body as T, etag: response.headers.get('etag') };
}

export function jsonBody(value: unknown, headers: Record<string, string> = {}): RequestInit {
  return { body: JSON.stringify(value), headers: { 'Content-Type': 'application/json', ...headers } };
}
