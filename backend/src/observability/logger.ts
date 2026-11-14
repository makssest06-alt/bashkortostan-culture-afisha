const REDACT_KEYS = new Set(['name', 'contact', 'phone', 'email', 'authorization', 'token', 'api_key']);

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
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...sanitize(fields),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}
