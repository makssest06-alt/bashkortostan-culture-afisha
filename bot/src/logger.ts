import type { LogLevel } from './config.js';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const TELEGRAM_TOKEN_RE = /\d{5,15}:[A-Za-z0-9_-]{20,}/g;
const BEARER_RE = /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;

export type LogFields = Record<string, unknown>;

export interface LogSink {
  log: (line: string) => void;
  error: (line: string) => void;
}

export interface Logger {
  debug: (message: string, fields?: LogFields) => void;
  info: (message: string, fields?: LogFields) => void;
  warn: (message: string, fields?: LogFields) => void;
  error: (message: string, fields?: LogFields) => void;
}

/** Прячет токен, даже если он случайно попал в текст ошибки или URL. */
export function redactSecrets(text: string): string {
  return text
    .replace(TELEGRAM_TOKEN_RE, '[redacted-token]')
    .replace(BEARER_RE, '$1[redacted]');
}

function normalizeFields(fields?: LogFields): LogFields | undefined {
  if (!fields) return undefined;
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value instanceof Error) {
      out[key] = { name: value.name, message: redactSecrets(value.message) };
    } else if (typeof value === 'string') {
      out[key] = redactSecrets(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function createLogger(level: LogLevel, sink: LogSink = console): Logger {
  const threshold = LEVEL_ORDER[level];

  function write(entryLevel: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_ORDER[entryLevel] < threshold) return;
    const line = redactSecrets(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: entryLevel,
        msg: message,
        ...normalizeFields(fields),
      }),
    );
    if (entryLevel === 'error') sink.error(line);
    else sink.log(line);
  }

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}
