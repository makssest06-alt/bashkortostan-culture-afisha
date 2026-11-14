const REDACT_KEYS = new Set(['name', 'contact', 'phone', 'email', 'authorization', 'token', 'api_key']);

const TOKEN_RE = /\d{5,15}:[A-Za-z0-9_-]{20,}/g;
const BEARER_RE = /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g;

/** Прячет токены/контакты даже в свободном тексте ошибки. */
export function redactSecrets(text: string): string {
  return text
    .replace(TOKEN_RE, '[redacted-token]')
    .replace(BEARER_RE, '$1[redacted]')
    .replace(EMAIL_RE, '[email]')
    .replace(PHONE_RE, '[phone]');
}

function sanitize(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (REDACT_KEYS.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

export function logEvent(level: 'info' | 'warn' | 'error', message: string, fields: Record<string, unknown> = {}): void {
  if (process.env.LOG_SILENT === '1') return;
  const line = redactSecrets(JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...sanitize(fields),
  }));
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}
