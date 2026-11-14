import { afterEach, describe, expect, it } from 'vitest';

import { clientIp } from './rate-limit';

const previous = process.env.TRUST_PROXY_CLIENT_IP;

afterEach(() => {
  if (previous === undefined) delete process.env.TRUST_PROXY_CLIENT_IP;
  else process.env.TRUST_PROXY_CLIENT_IP = previous;
});

describe('clientIp сайта', () => {
  it('без доверенного прокси не доверяет X-Forwarded-For', () => {
    delete process.env.TRUST_PROXY_CLIENT_IP;
    const request = new Request('http://site.local/api/v1/admin/session', {
      headers: { 'X-Forwarded-For': '198.51.100.7', 'X-Real-IP': '198.51.100.8' },
    });
    expect(clientIp(request)).toBe('local');
  });

  it('за доверенным прокси берёт правый адрес цепочки', () => {
    process.env.TRUST_PROXY_CLIENT_IP = '1';
    const request = new Request('http://site.local/api/v1/admin/session', {
      headers: { 'X-Forwarded-For': '1.2.3.4, 203.0.113.7' },
    });
    expect(clientIp(request)).toBe('203.0.113.7');
  });

  it('за доверенным прокси использует X-Real-IP, если цепочки нет', () => {
    process.env.TRUST_PROXY_CLIENT_IP = '1';
    const request = new Request('http://site.local/api/v1/admin/session', {
      headers: { 'X-Real-IP': '203.0.113.9' },
    });
    expect(clientIp(request)).toBe('203.0.113.9');
  });
});
