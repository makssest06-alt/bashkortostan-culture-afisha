import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig, normalizeBaseUrl } from '../src/config.js';

const TOKEN = '12345:AAHfake_token_for_tests_1234567890';

function validEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    TELEGRAM_BOT_TOKEN: TOKEN,
    API_BASE_URL: 'http://localhost:8000',
    ...extra,
  };
}

describe('normalizeBaseUrl', () => {
  it('убирает слэши и /api/v1', () => {
    expect(normalizeBaseUrl('http://localhost:8000/')).toBe('http://localhost:8000');
    expect(normalizeBaseUrl('http://localhost:8000/api/v1/')).toBe('http://localhost:8000');
  });
});

describe('loadConfig', () => {
  it('читает обязательные и необязательные значения', () => {
    const config = loadConfig(
      validEnv({
        API_TIMEOUT_MS: '5000',
        LOG_LEVEL: 'debug',
        PUBLIC_WEB_URL: 'http://localhost:3210/',
        SESSION_TTL_MINUTES: '30',
      }),
    );
    expect(config.apiBaseUrl).toBe('http://localhost:8000');
    expect(config.apiTimeoutMs).toBe(5000);
    expect(config.logLevel).toBe('debug');
    expect(config.publicWebUrl).toBe('http://localhost:3210');
    expect(config.sessionTtlMs).toBe(30 * 60_000);
  });

  it('подставляет значения по умолчанию', () => {
    const config = loadConfig(validEnv());
    expect(config.apiTimeoutMs).toBe(10_000);
    expect(config.logLevel).toBe('info');
    expect(config.publicWebUrl).toBeNull();
  });

  it('не печатает токен в тексте ошибки', () => {
    const invalidToken = '12345:short';
    try {
      loadConfig(validEnv({ TELEGRAM_BOT_TOKEN: invalidToken }));
      throw new Error('ожидали ConfigError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(invalidToken);
      expect(message).toContain('TELEGRAM_BOT_TOKEN');
    }
  });

  it('требует токен', () => {
    expect(() => loadConfig({ API_BASE_URL: 'http://localhost:8000' })).toThrow(ConfigError);
  });

  it('отклоняет относительный API_BASE_URL', () => {
    expect(() => loadConfig(validEnv({ API_BASE_URL: '/api' }))).toThrow(ConfigError);
  });
});
