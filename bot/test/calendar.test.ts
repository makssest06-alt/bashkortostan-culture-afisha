import { describe, expect, it } from 'vitest';

import {
  buildEventIcs,
  calendarCaption,
  calendarFileName,
  escapeIcsText,
  foldIcsLine,
  toIcsUtc,
} from '../src/calendar.js';
import { makeEvent, makeOccurrence } from './fixtures.js';

const NOW = new Date('2026-11-13T12:00:00Z');

function lines(ics: string): string[] {
  return ics.split('\r\n').filter(Boolean);
}

describe('календарь .ics', () => {
  it('переводит местное время в UTC', () => {
    const ics = buildEventIcs(makeEvent(), makeOccurrence(), { now: NOW });
    expect(lines(ics)).toContain('DTSTART:20261120T140000Z');
    // 90 минут от начала.
    expect(lines(ics)).toContain('DTEND:20261120T153000Z');
    expect(toIcsUtc(new Date('2026-11-20T14:00:00Z'))).toBe('20261120T140000Z');
  });

  it('делает событие на весь день с исключающей датой конца', () => {
    const ics = buildEventIcs(
      makeEvent(),
      makeOccurrence({
        time_precision: 'date',
        date_start: '2026-11-20T00:00:00+05:00',
        date_end: null,
      }),
      { now: NOW },
    );
    expect(lines(ics)).toContain('DTSTART;VALUE=DATE:20261120');
    expect(lines(ics)).toContain('DTEND;VALUE=DATE:20261121');
  });

  it('экранирует текст по RFC 5545', () => {
    expect(escapeIcsText('a,b;c\\d\n e')).toBe('a\\,b\\;c\\\\d\\n e');
    const ics = buildEventIcs(
      makeEvent({ title: 'Концерт, вечер; музыка' }),
      makeOccurrence(),
      { now: NOW },
    );
    expect(lines(ics)).toContain('SUMMARY:Концерт\\, вечер\\; музыка');
  });

  it('экранирует UID от CRLF-инъекции', () => {
    const ics = buildEventIcs(
      makeEvent({ id: 'a\r\nSTATUS:CANCELLED' }),
      makeOccurrence({ id: 'b\r\nSTATUS:CANCELLED' }),
      { now: NOW },
    );
    expect(lines(ics)).not.toContain('STATUS:CANCELLED');
    expect(ics).toContain('UID:a\\nSTATUS:CANCELLED-b\\nSTATUS:CANCELLED@');
  });

  it('складывает длинные строки по 75 октетов, не разрывая UTF-8', () => {
    const folded = foldIcsLine(`SUMMARY:${'я'.repeat(100)}`);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75);
    }
    expect(parts.slice(1).every((part) => part.startsWith(' '))).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toContain('я'.repeat(100));
  });

  it('помечает отменённый сеанс', () => {
    const ics = buildEventIcs(
      makeEvent(),
      makeOccurrence({ status: 'cancelled' }),
      { now: NOW },
    );
    expect(lines(ics)).toContain('STATUS:CANCELLED');
    expect(calendarCaption(makeEvent(), makeOccurrence({ status: 'cancelled' }))).toContain('(отменён)');
  });

  it('не подставляет битую ссылку и даёт безопасное имя файла', () => {
    const ics = buildEventIcs(
      makeEvent({ source_url: 'http://localhost:3210/events/1', org_link: null }),
      makeOccurrence(),
      { now: NOW },
    );
    expect(lines(ics).some((line) => line.startsWith('URL:'))).toBe(false);
    expect(calendarFileName(makeEvent())).toMatch(/^afisha-[A-Za-z0-9_-]+\.ics$/);
  });
});
