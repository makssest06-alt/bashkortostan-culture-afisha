import { createHash, randomUUID } from 'node:crypto';
import type { Context } from 'hono';

import type { ApiErrorBody, ApiErrorDetail } from './types.js';

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, If-Match, If-None-Match, X-Request-Id, X-Assistant-Demo',
  'Access-Control-Expose-Headers': 'ETag, X-Request-Id, Retry-After, Location',
  'Access-Control-Max-Age': '86400',
};

export const CACHE_NO_STORE = 'no-store';
export const CACHE_CARD = 'public, max-age=60, must-revalidate';
export const CACHE_DICTIONARY = 'public, max-age=300, must-revalidate';

export function resolveRequestId(incoming?: string | null): string {
  const trimmed = incoming?.trim();
  if (trimmed && /^[A-Za-z0-9._:-]{4,128}$/.test(trimmed)) {
    return trimmed;
  }
  return `req_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function computeEtag(payload: unknown): string {
  return `W/"${createHash('sha1').update(JSON.stringify(payload)).digest('base64url').slice(0, 27)}"`;
}

export function etagMatches(header: string | null | undefined, etag: string): boolean {
  if (!header) return false;
  const bare = (v: string) => v.trim().replace(/^W\//, '');
  const target = bare(etag);
  return header.split(',').some((part) => part.trim() === '*' || bare(part) === target);
}

export function jsonResponse(
  c: Context,
  body: unknown,
  options: { status?: number; cache?: string; headers?: Record<string, string> } = {},
): Response {
  const requestId = c.get('requestId') as string;
  const adminPath = new URL(c.req.url).pathname.startsWith('/api/v1/admin/');
  const headers: Record<string, string> = {
    ...(adminPath ? {} : CORS_HEADERS),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': options.cache ?? CACHE_NO_STORE,
    'X-Content-Type-Options': 'nosniff',
    'X-Request-Id': requestId,
    ...(options.headers ?? {}),
  };
  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers,
  });
}

export function jsonWithEtag(c: Context, body: unknown, cache: string): Response {
  const requestId = c.get('requestId') as string;
  const etag = computeEtag(body);
  const ifNoneMatch = c.req.header('if-none-match');
  if (etagMatches(ifNoneMatch, etag)) {
    return new Response(null, {
      status: 304,
      headers: {
        ...CORS_HEADERS,
        ETag: etag,
        'Cache-Control': cache,
        'X-Content-Type-Options': 'nosniff',
        'X-Request-Id': requestId,
      },
    });
  }
  return jsonResponse(c, body, { cache, headers: { ETag: etag } });
}

export function errorResponse(
  c: Context,
  status: number,
  code: string,
  message: string,
  details: ApiErrorDetail[] = [],
  headers: Record<string, string> = {},
): Response {
  const requestId = c.get('requestId') as string;
  const body: ApiErrorBody = {
    code,
    message,
    details,
    request_id: requestId,
  };
  return jsonResponse(c, body, { status, headers });
}
