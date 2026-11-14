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
        LOG_HASH_SECRET: '0123456789abcdef',
        USER_REF_SECRET: 'fedcba9876543210',
        USER_REF_MODE: 'legacy',
        API_RETRY_ATTEMPTS: '3',
        ASSISTANT_ENABLED: '1',
        ASSISTANT_CONFIRMATIONS: 'true',
      }),
    );
    expect(config.apiBaseUrl).toBe('http://localhost:8000');
    expect(config.apiTimeoutMs).toBe(5000);
    expect(config.logLevel).toBe('debug');
    expect(config.publicWebUrl).toBe('http://localhost:3210');
    expect(config.sessionTtlMs).toBe(30 * 60_000);
    expect(config.rateLimitPerMinute).toBe(20);
    expect(config.callbackTtlMs).toBe(720 * 60_000);
    expect(config.brandImagePath).toContain('token-height.png');
    expect(config.logHashSecret).toBe('0123456789abcdef');
    expect(config.userRefSecret).toBe('fedcba9876543210');
    expect(config.userRefMode).toBe('legacy');
    expect(config.apiRetryAttempts).toBe(3);
    expect(config.assistantEnabled).toBe(true);
    expect(config.assistantConfirmations).toBe(true);
  });

  it('подставляет значения по умолчанию', () => {
    const config = loadConfig(validEnv());
    expect(config.apiTimeoutMs).toBe(10_000);
    expect(config.logLevel).toBe('info');
    expect(config.publicWebUrl).toBeNull();
    expect(config.rateLimitPerMinute).toBe(20);
    expect(config.apiRetryAttempts).toBe(2);
    expect(config.userRefMode).toBe('hmac');
    expect(config.userRefSecret).toBeNull();
    expect(config.assistantEnabled).toBe(false);
    expect(config.assistantConfirmations).toBe(false);
  });

  it('позволяет выключить жетон и лимит', () => {
    const config = loadConfig(
      validEnv({ BRAND_IMAGE_PATH: 'off', RATE_LIMIT_PER_MINUTE: '0' }),
    );
    expect(config.brandImagePath).toBeNull();
    expect(config.rateLimitPerMinute).toBe(0);
  });

  it('требует достаточно длинный ключ для логов', () => {
    expect(() => loadConfig(validEnv({ LOG_HASH_SECRET: 'short' }))).toThrow(ConfigError);
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
