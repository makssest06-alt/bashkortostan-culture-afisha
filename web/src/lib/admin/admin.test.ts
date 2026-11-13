import { beforeEach, describe, expect, it } from 'vitest';

import { findEvent, loadCatalog } from '../api/db';
import { searchEvents } from '../api/search';
import { parseCsv } from './import';
import { editEvent, getAdminEvent, listAudit, moderationQueue, resolveDisputed, runImport } from './service';
import { readState, resetForTests } from './store';

const NOW = new Date('2026-11-12T09:00:00Z');
const HEADER = 'title,category,date_start,city,venue,price_min,age_limit,source_url,description';

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

const JAZZ_ROW =
  'Джазовый вечер в библиотеке,концерт,2026-11-20 19:00,Уфа,Национальный музей Республики Башкортостан,400,12,https://example.ru/jazz,Вечер джаза в лектории';

describe('импорт CSV и JSON (п. 6.1)', () => {
  beforeEach(() => resetForTests());

  it('CSV с кавычками, запятыми и переводом строки внутри поля разбирается', () => {
    const rows = parseCsv('title,description\n"Концерт, большой","Строка 1\nстрока 2"\n');
    expect(rows).toEqual([
      ['title', 'description'],
      ['Концерт, большой', 'Строка 1\nстрока 2'],
    ]);
  });

  it('новая строка добавляется, повторный импорт того же файла ничего не меняет', () => {
    const file = csv(JAZZ_ROW);
    const first = runImport(file, { format: 'csv', fileName: 'afisha.csv' }, 'тест', NOW);
    expect(first.ok && first.report).toMatchObject({ received: 1, added: 1, updated: 0, unchanged: 0, rejected: [] });
    const countAfterFirst = Object.keys(readState().records).length;

    const second = runImport(file, { format: 'csv', fileName: 'afisha.csv' }, 'тест', NOW);
    expect(second.ok && second.report).toMatchObject({ received: 1, added: 0, updated: 0, unchanged: 1 });
    expect(Object.keys(readState().records).length).toBe(countAfterFirst);
  });

  it('изменённая строка того же события обновляет запись, а не создаёт дубль', () => {
    runImport(csv(JAZZ_ROW), { format: 'csv', fileName: null }, 'тест', NOW);
    const changed = JAZZ_ROW.replace(',400,', ',550,');
    const result = runImport(csv(changed), { format: 'csv', fileName: null }, 'тест', NOW);
    expect(result.ok && result.report).toMatchObject({ added: 0, updated: 1 });
    const records = Object.values(readState().records);
    expect(records).toHaveLength(1);
    expect(records[0].price_min).toBe(550);
    const audit = listAudit({ entity_id: records[0].id }).items;
    expect(audit[0].changes).toContainEqual({ field: 'price_min', from: 400, to: 550 });
  });

  it('то же событие из другого источника сводится в существующую карточку', () => {
    const seed = loadCatalog(NOW).events.find((event) => event.title === 'Поздний джаз');
    expect(seed).toBeDefined();
    const row = [
      seed!.title,
      'концерт',
      seed!.date_start!.slice(0, 16).replace('T', ' '),
      seed!.venue.city_name.ru,
      `"${seed!.venue.name}"`,
      '700',
      '18',
      'https://other-source.example/jazz',
      'Описание с другого сайта',
    ].join(',');
    const result = runImport(csv(row), { format: 'csv', fileName: null }, 'тест', NOW);
    expect(result.ok && result.report).toMatchObject({ added: 0, merged: 1 });
    const after = findEvent(seed!.id, NOW)!;
    expect(after.sources.length).toBe(seed!.sources.length + 1);
    expect(after.sources.map((source) => source.source_url)).toContain('https://other-source.example/jazz');
    // Цена карточки не перезаписана чужим источником.
    expect(after.price_min).toBe(seed!.price_min);

    const again = runImport(csv(row), { format: 'csv', fileName: null }, 'тест', NOW);
    expect(again.ok && again.report).toMatchObject({ merged: 0, unchanged: 1 });
    expect(findEvent(seed!.id, NOW)!.sources.length).toBe(seed!.sources.length + 1);
  });

  it('ошибочные строки отклоняются с понятной причиной', () => {
    const file = csv(
      'Концерт в Москве,концерт,2026-11-20 19:00,Москва,Зал,400,12,https://example.ru/a,Описание',
      'Прошедший концерт,концерт,2026-11-01 19:00,Уфа,Зал,400,12,https://example.ru/b,Описание',
      'Без источника,концерт,2026-11-20 19:00,Уфа,Зал,400,12,,Описание',
      'Странный возраст,концерт,2026-11-20 19:00,Уфа,Зал,400,10,https://example.ru/c,Описание',
      'Непонятная дата,концерт,завтра вечером,Уфа,Зал,400,12,https://example.ru/d,Описание',
      'Непонятная категория,цирк,2026-11-20 19:00,Уфа,Зал,400,12,https://example.ru/e,Описание',
      'Непонятная категория,цирк,2026-11-20 19:00,Уфа,Зал,400,12,https://example.ru/e,Описание',
    );
    const result = runImport(file, { format: 'csv', fileName: null }, 'тест', NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reasons = result.report.rejected.map((item) => `${item.row}: ${item.reason}`);
    expect(result.report.added).toBe(0);
    expect(result.report.rejected).toHaveLength(7);
    expect(reasons[0]).toMatch(/^2: Город «Москва» не найден/);
    expect(reasons[1]).toMatch(/уже прошло/);
    expect(reasons[2]).toMatch(/Нет ссылки на источник/);
    expect(reasons[3]).toMatch(/Возрастное ограничение «10»/);
    expect(reasons[4]).toMatch(/непонятном формате/);
    expect(reasons[5]).toMatch(/Категория «цирк» не из списка/);
    expect(reasons[6]).toMatch(/^8: Повтор строки 7/);
  });

  it('спорная строка попадает в очередь модерации черновиком и не видна в выдаче', () => {
    const row = 'Варганный вечер,другое,2026-11-21 18:00,Уфа,Новая площадка без справочника,0,6,https://example.ru/kurai,';
    const result = runImport(csv(row), { format: 'csv', fileName: null }, 'тест', NOW);
    expect(result.ok && result.report.disputed).toHaveLength(1);
    const id = result.ok ? result.report.disputed[0].id : '';
    expect(getAdminEvent(id, NOW)?.status).toBe('draft');
    expect(moderationQueue({}, NOW).items.map((item) => item.event.id)).toContain(id);
    expect(searchEvents({ page_size: 50, q: 'варганный' }, NOW).total).toBe(0);
    expect(findEvent(id, NOW)).toBeNull();

    const resolved = resolveDisputed(id, 'publish', 'Проверили по телефону', 'модератор', NOW);
    expect(resolved.ok).toBe(true);
    expect(searchEvents({ page_size: 50, q: 'варганный' }, NOW).total).toBe(1);
    expect(moderationQueue({}, NOW).items.map((item) => item.event.id)).not.toContain(id);
  });

  it('JSON-импорт принимает массив событий', () => {
    const json = JSON.stringify([
      {
        title: 'Концерт хора',
        category: 'concert',
        date_start: '2026-11-22T17:00:00+05:00',
        city: 'ufa',
        venue: 'Башкирская государственная филармония им. Х. Ахметова',
        is_free: true,
        age_limit: 0,
        source_url: 'https://example.ru/choir',
        description: 'Хоровой концерт',
        tags: ['хор'],
      },
    ]);
    const result = runImport(json, { format: 'json', fileName: 'events.json' }, 'тест', NOW);
    expect(result.ok && result.report).toMatchObject({ added: 1, rejected: [] });
    const record = Object.values(readState().records)[0];
    expect(record).toMatchObject({ is_free: true, price_min: 0, price_max: 0, venue_id: 'ven_ufa_philharmonic' });
    expect(record.tags).toEqual(['хор', 'бесплатно']);
  });
});

describe('правка и статусы', () => {
  beforeEach(() => resetForTests());

  it('правка с устаревшим ETag отклоняется, свежая применяется и пишется в журнал', () => {
    const seed = loadCatalog(NOW).events[0];
    const stale = editEvent(seed.id, { title: 'Новое название' }, 'W/"устарел"', 'Анна', NOW);
    expect(stale).toMatchObject({ ok: false, status: 412 });

    const etag = getAdminEvent(seed.id, NOW)!.etag;
    const fresh = editEvent(seed.id, { title: 'Новое название' }, etag, 'Анна', NOW);
    expect(fresh.ok).toBe(true);
    expect(findEvent(seed.id, NOW)!.title).toBe('Новое название');
    const entry = listAudit({ entity_id: seed.id }).items[0];
    expect(entry).toMatchObject({ actor: 'Анна', action: 'update' });
    expect(entry.changes).toContainEqual({ field: 'title', from: seed.title, to: 'Новое название' });
  });

  it('отменённое событие пропадает из выдачи, но открывается по прямой ссылке', () => {
    const seed = loadCatalog(NOW).events.find((event) => event.title === 'Поздний джаз')!;
    expect(searchEvents({ page_size: 50, q: 'поздний джаз' }, NOW).total).toBe(1);
    const result = editEvent(seed.id, { status: 'cancelled' }, getAdminEvent(seed.id, NOW)!.etag, 'модератор', NOW);
    expect(result.ok).toBe(true);
    expect(searchEvents({ page_size: 50, q: 'поздний джаз' }, NOW).total).toBe(0);
    expect(findEvent(seed.id, NOW)?.status).toBe('cancelled');
    expect(listAudit({ entity_id: seed.id }).items[0].action).toBe('status');
  });

  it('у демо-события даты не правятся, неизвестные поля отклоняются', () => {
    const seed = loadCatalog(NOW).events[0];
    const result = editEvent(seed.id, { date_start: '2026-12-01 19:00', secret: 1 }, getAdminEvent(seed.id, NOW)!.etag, 'модератор', NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details?.map((item) => item.field).sort()).toEqual(['date_start', 'secret']);
  });

  it('правка без If-Match отклоняется с 409', () => {
    const seed = loadCatalog(NOW).events[0];
    expect(editEvent(seed.id, { title: 'Без заголовка' }, null, 'модератор', NOW)).toMatchObject({ ok: false, status: 409 });
  });

  it('дубль из очереди сводится в основную карточку: источники переходят, дубль не публикуется', () => {
    const queue = moderationQueue({}, NOW).items;
    const duplicate = queue.find((item) => item.event.title === 'Вечер авторской песни')!;
    const target = loadCatalog(NOW).events.find((event) => event.title === 'Поздний джаз')!;
    const result = resolveDisputed(duplicate.event.id, 'merge', null, 'модератор', NOW, target.id);
    expect(result.ok).toBe(true);
    const merged = findEvent(target.id, NOW)!;
    expect(merged.sources.length).toBe(target.sources.length + duplicate.event.sources.length);
    expect(getAdminEvent(duplicate.event.id, NOW)).toMatchObject({ status: 'draft', review: { disputed: false, merged_into: target.id } });
    expect(resolveDisputed(duplicate.event.id, 'publish', null, 'модератор', NOW)).toMatchObject({ ok: false, status: 409 });
  });
});
