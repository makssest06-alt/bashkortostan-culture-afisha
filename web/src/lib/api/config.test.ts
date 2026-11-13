import { describe, expect, it } from 'vitest';

import { normalizeApiBaseUrl } from './config';

describe('normalizeApiBaseUrl', () => {
  it('пустое значение означает моки', () => {
    expect(normalizeApiBaseUrl(undefined)).toBe('');
    expect(normalizeApiBaseUrl('')).toBe('');
    expect(normalizeApiBaseUrl('   ')).toBe('');
  });

  it('срезает слэш и префикс /api/v1 на конце', () => {
    expect(normalizeApiBaseUrl('http://localhost:8000')).toBe('http://localhost:8000');
    expect(normalizeApiBaseUrl('http://localhost:8000/')).toBe('http://localhost:8000');
    expect(normalizeApiBaseUrl('https://api.example/api/v1')).toBe('https://api.example');
    expect(normalizeApiBaseUrl('https://api.example/api/v1/')).toBe('https://api.example');
    expect(normalizeApiBaseUrl(' https://example.ru/afisha/api/v1 ')).toBe('https://example.ru/afisha');
  });

  it('сохраняет путь, если бэк живёт не в корне', () => {
    expect(normalizeApiBaseUrl('https://example.ru/backend')).toBe('https://example.ru/backend');
  });

  it('не превращает опечатку в моки, а падает с понятной ошибкой', () => {
    expect(() => normalizeApiBaseUrl('localhost:8000')).toThrow(/http:\/\/ или https:\/\//);
    expect(() => normalizeApiBaseUrl('api.example')).toThrow(/не похож на адрес/);
    expect(() => normalizeApiBaseUrl('ftp://api.example')).toThrow(/http:\/\/ или https:\/\//);
    expect(() => normalizeApiBaseUrl('https://api.example/?x=1')).toThrow(/параметров/);
    expect(() => normalizeApiBaseUrl('https://user:pass@api.example')).toThrow(/логина и пароля/);
  });
});
