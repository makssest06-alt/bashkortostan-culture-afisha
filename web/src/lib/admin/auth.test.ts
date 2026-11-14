import { afterEach, describe, expect, it, vi } from 'vitest';

import { EXAMPLE_ADMIN_TOKEN, adminMode, configuredAdminToken, tokenMatches } from './auth';

describe('токен модератора', () => {
  const saved = process.env.ADMIN_TOKEN;

  afterEach(() => {
    if (saved === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = saved;
  });

  it('заглушка из .env.example не открывает админку известным всем токеном', () => {
    process.env.ADMIN_TOKEN = EXAMPLE_ADMIN_TOKEN;
    expect(configuredAdminToken()).toBeUndefined();
    expect(adminMode()).not.toBe('token');
    expect(tokenMatches(EXAMPLE_ADMIN_TOKEN)).toBe(false);
  });

  it('настоящий токен работает', () => {
    process.env.ADMIN_TOKEN = '  a-real-long-token-123  ';
    expect(configuredAdminToken()).toBe('a-real-long-token-123');
    expect(adminMode()).toBe('token');
    expect(tokenMatches('a-real-long-token-123')).toBe(true);
    expect(tokenMatches('wrong-token-123')).toBe(false);
  });

  it('в production ADMIN_OPEN игнорируется, а короткий токен не открывает админку', () => {
    const savedOpen = process.env.ADMIN_OPEN;
    vi.stubEnv('NODE_ENV', 'production');
    process.env.ADMIN_OPEN = '1';
    process.env.ADMIN_TOKEN = 'short-token-123';
    expect(adminMode()).toBe('disabled');

    process.env.ADMIN_TOKEN = 'a'.repeat(32);
    expect(adminMode()).toBe('token');

    vi.unstubAllEnvs();
    if (savedOpen === undefined) delete process.env.ADMIN_OPEN;
    else process.env.ADMIN_OPEN = savedOpen;
  });
});
