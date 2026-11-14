import { describe, expect, it } from 'vitest';

import { configuredSiteOrigin } from './site-origin';

describe('configuredSiteOrigin', () => {
  it('берёт настроенный http(s) origin и отбрасывает путь/креды', () => {
    expect(configuredSiteOrigin('https://afisha.example/events')?.origin).toBe(
      'https://afisha.example',
    );
    expect(configuredSiteOrigin('http://localhost:3210')?.origin).toBe('http://localhost:3210');
  });

  it('не принимает javascript/data и пустое значение', () => {
    expect(configuredSiteOrigin('javascript:alert(1)')).toBeNull();
    expect(configuredSiteOrigin('data:text/html,evil')).toBeNull();
    expect(configuredSiteOrigin('')).toBeNull();
    expect(configuredSiteOrigin(undefined)).toBeNull();
    expect(configuredSiteOrigin('not a url')).toBeNull();
  });
});
