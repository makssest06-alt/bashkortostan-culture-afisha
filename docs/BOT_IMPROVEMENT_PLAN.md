# План развития Telegram-бота

**Статус:** этапы 0–6 влиты в `main` (merge `b020c95`, 14.11.2026); бот подключён к живому API и запущен; подтверждения разблокированы (P0-4 исправлен), осталась доставка подписок
**База:** `main` = `b020c95` (PR #19 merged как `28e1925` + бот из `feat/telegram-bot` = `e555911`)  
**Текущая проверка:** 202 теста в 12 файлах, `typecheck` и `build` проходят; smoke против живого бэкенда (PGlite, `127.0.0.1:8010`) — 13/13 PASS
**Главное правило:** бот остаётся отдельным адаптером к REST API v1. Своей БД, своего поискового движка и своей бизнес-логики каталога у него нет.

---

## 1. Цель

Сделать бота не «ещё одним поиском по API», а полноценным Telegram-интерфейсом афиши:

- карточка события как на сайте, но с telegram-сценариями: все сеансы, календарь, карта, шаринг;
- фильтры, которые уже поддерживает API, но которых нет в боте: возраст, сортировка, диапазон дат, язык;
- честная пустая выдача с серверными вариантами ослабления и счётчиками;
- быстрый переход из подписки к подходящим событиям;
- глубокие ссылки «сайт → бот»;
- адаптер ИИ-ассистента за флагом, с мягким откатом на текущий поиск;
- надёжность и безопасность без изменения бэкенда.

**Не цель:** заменить бэкенд, сделать уведомления в обход бэкенда, написать второй NLU-движок или копию сайта.

---

## 2. Границы

### Входит в план

- Только `bot/`, `docs/` и `.github/workflows/`.
- Использование существующих и законтрактованных методов API.
- Мягкая деградация, если метода ещё нет в `main` или на стенде.
- Тесты, smoke, README, `TZ_COMPLIANCE`.
- Feature flags для рискованных сценариев.

### Не входит

- Изменения в `backend/`, `contracts/`, `web/`.
- Своя БД, очередь, cron, файловое хранилище подписок.
- Уведомления по подпискам: в бэкенде нет воркера доставки. Делать polling в боте нельзя: рестарт теряет состояние, несколько инстансов дают дубли, нет способа перечислить всех пользователей.
- Полноценный ИИ-агент с LLM внутри бота. Бот только вызывает `POST /assistant/query` и рисует ответ.
- Админка, модерация, импорт, оплата билетов.
- Inline-режим, групповые чаты, голосовые сообщения, favorite-события — после базового плана.

---

## 3. Что уже есть

| Блок | Состояние |
|---|---|
| Меню, `/start`, `/help`, `/about`, `/cancel` | Готово |
| Поиск текстом, пагинация | Готово |
| Фильтры: дата-пресеты, день, период, цена, возраст, язык, сортировка, город, категория | Готово |
| Карточка события 2.0: все сеансы, тарифы, `.ics`, карта, шаринг | Готово |
| Deep link `/start event_<uuid>` | Готово |
| Похожие события, расписание площадки | Готово, с fallback на 404 |
| Счётчики `hidden_unknown_price/age`, `facets`, `relaxations` | Готово |
| Подписки: создание, список, удаление, переход к событиям | Готово |
| Справочники из API + fallback | Готово |
| HMAC `user_ref`, callback-токены, rate limit, логи без PII | Готово |
| Retry GET | Готово |
| Ассистент: query/clarify/chips/confirm | Адаптер готов, по умолчанию выключен; confirm разблокирован после P0-4 |
| Тесты | 199 в 12 файлах |
| CI | Готово, `.github/workflows/bot.yml` |

---

## 4. Что API умеет и как бот это использует

| Возможность API | Состояние в боте |
|---|---|
| `occurrences` — все сеансы | Экран «Все сеансы», выбор сеанса, карточка выбранного |
| `offers` — тарифы | Экран «Тарифы» |
| `facets` — счётчики | Цифры в фильтрах города, категории, цены и возраста |
| `relaxations` — варианты ослабления | Серверные кнопки с количеством и применением одним нажатием |
| `venue_id` | «Расписание площадки» через `GET /venues/{id}/schedule` |
| `sort` | Дата, цена, популярность |
| `age` | Фильтр возраста посетителя |
| `date_from/date_to` | Диапазон дат, до 31 дня |
| `language` | Фильтр языка |
| `lat/lon` | Ссылка «На карте» |
| `venue schedule` | Расписание площадки, с fallback |
| `assistant/query` | Адаптер за флагом, с fallback на поиск |
| `assistant/confirm` | Реализован; токены привязаны к `user_ref` (P0-4), включается флагом |

---

## 5. Целевые пользовательские сценарии

1. Пользователь открывает событие, видит «Все сеансы (5)», выбирает удобную дату, добавляет её в календарь.
2. Пользователь нажимает «На карте» и открывает площадку в Яндекс.Картах.
3. Пользователь делится событием в другом чате; получатель открывает карточку прямо в боте по deep link.
4. Родитель фильтрует события по возрасту ребёнка и видит, сколько событий скрыто из-за неизвестного возраста.
5. Пользователь сортирует выдачу по популярности или цене.
6. Пользователь ищет события на период «20–25 ноября».
7. При пустой выдаче бот предлагает не абстрактные кнопки, а варианты с количеством: «Без ограничения цены — 3 события».
8. Пользователь открывает «Мои подписки» и сразу запускает поиск по подписке.
9. Пользователь пишет свободную фразу; если бэкенд с ассистентом доступен — получает уточнения и подбор, если нет — обычный поиск.

---

## 6. Архитектурные решения

1. **Никаких изменений бэкенда.** Если метода нет — 404/400/503 обрабатываются понятным сообщением, кнопка не ломает диалог.
2. **Feature flags для рискованного:**
   - `ASSISTANT_ENABLED=0` — по умолчанию выключен;
   - `ASSISTANT_CONFIRMATIONS=0` — подтверждения выключены по умолчанию; после закрытия P0-4 их можно включить;
   - `USER_REF_MODE=hmac|legacy` — возможность откатить смену `user_ref`.
3. **Pure functions для форматирования.** Календарь, сеансы, тарифы, релаксации — отдельные функции, которые легко тестировать без Telegram.
4. **Callback-токены остаются непрозрачными.** Новые действия (`sessions`, `offers`, `calendar`, `relax`, `assistant`) не кладут id/параметры в `callback_data`.
5. **Состояние диалога — только в памяти.** Новые поля живут в `SessionStore`, TTL сохраняется.
6. **Внешние URL — только через `telegramSafeHttpUrl`.** Карта, шаринг, сайт, билеты.
7. **Время — `Asia/Yekaterinburg`.** Календарь переводит в UTC корректно, не зависит от TZ сервера.
8. **Логи — без текста запроса и PII.** Для ассистента логируем `engine`, `action`, `trace_id`, `latency`, `fallback`, но не сообщение.

---

## 7. Этапы

### Этап 0. Базовая фиксация и CI

**Зачем:** перед большими изменениями нужен зелёный baseline и автоматическая проверка.

Задачи:

- [x] Зафиксировать текущее состояние: 132 теста на момент старта (сейчас 199), `typecheck`, `build`, smoke 9/9.
- [x] Добавить `.github/workflows/bot.yml`: Node 22, `npm ci`, `npm run typecheck`, `npm test`, `npm run build`.
- [x] Добавить в `bot/package.json` script `check` = `typecheck && test && build` (удобно локально и в CI).
- [x] Обновить `bot/README.md`: как запускать проверки, что считается зелёным.
- [x] Проверить, что CI не требует секретов и не ходит в живой API.

**Готово, когда:** workflow проходит на push/PR, локально `npm run check` зелёный.

---

### Этап 1. Расширение API-слоя и состояния

**Зачем:** все дальнейшие фичи должны опираться на типизированные поля, а не на `unknown`.

#### 1.1. Типы ответов

`bot/src/api/types.ts`:

- [x] `FacetEntrySchema`: `{ id, name, count }`.
- [x] `FacetsSchema`: `cities`, `categories`, `age_limits`, `price {free, paid, unknown}`, `total`.
- [x] `RelaxationSchema`: `code`, `codes`, `label` (строка или `{ru, ba}`), `patch`, `query`, `count`.
- [x] `EventListResponseSchema`: заменить `facets: z.unknown()` на `FacetsSchema.optional()`, `relaxations` — на `z.array(RelaxationSchema).default([])`.
- [x] `VenueSchema`, `VenueScheduleSchema` для `GET /venues/{id}/schedule`.
- [x] `Assistant*` схемы — на этапе 6, отдельным файлом, чтобы не смешивать с v1.

#### 1.2. Параметры поиска

`bot/src/api/client.ts`:

- [x] `SearchEventsParams`: добавить `age`, `date_from`, `date_to`, `language`, `venue_id`.
- [x] В `searchEvents` собирать эти параметры; `date` и `date_from/date_to` не отправлять одновременно.
- [x] `SimilarEventsParams`: добавить `date_from/date_to`.
- [x] `getVenueSchedule(venueId, { date_from, date_to })`.
- [x] Тесты: каждый параметр попадает в URL; `null` не отправляется; диапазон не смешивается с `date`.

#### 1.3. Состояние поиска

`bot/src/session.ts`:

- [x] `SearchState`: `age: number | null`, `dateFrom: string | null`, `dateTo: string | null`, `language: string | null`, `sort: 'date' | 'price' | 'popularity'`, `facets: Facets | null`, `relaxations: Relaxation[]`.
- [x] `createSearchState` — значения по умолчанию, обратная совместимость.
- [x] `SessionData.assistant` — на этапе 6.

#### 1.4. Callback-типы

`bot/src/callbacks.ts`:

- [x] `event` получает `occurrenceId?: string | null`.
- [x] Новые типы: `sessions`, `offers`, `calendar`, `relax`, `venue`.
- [x] `filter`: `ageMenu`, `setAge`, `sortMenu`, `setSort`, `languageMenu`, `setLanguage`, `rangeMenu`, `rangeStart`, `rangeEnd`.
- [x] `subscriptions`: `show`.
- [x] Тесты на сериализацию/резолв не нужны — callback store уже тестируется; добавить сценарии в bot-тестах.

**Готово, когда:** типы собираются, старые тесты не сломаны, новые тесты на параметры и схемы зелёные.

---

### Этап 2. Карточка 2.0

**Зачем:** сейчас карточка показывает только один сеанс и не использует половину данных события.

#### 2.1. Все сеансы

- [x] `format.ts`: `pickOccurrence(event, occurrenceId?)`, `formatSessionsList(event, now)`, `formatEventCard(..., { occurrenceId })`.
- [x] В карточке показывать: «Сеанс 2 из 5» и ближайший выбранный сеанс.
- [x] `keyboards.ts`: кнопка `📅 Все сеансы (N)` при `occurrences.length > 1`.
- [x] `bot.ts`: `showSessions(ctx, eventId, page?)`, `sessionsKeyboard`.
- [x] Кнопка сеанса: `20 ноя, 19:00 · есть билеты`; callback `{ type: 'event', id, occurrenceId }`.
- [x] Прошедшие, отменённые, sold_out сеансы помечать и не предлагать как основной, но показывать.
- [x] Если у события нет сеансов — не показывать кнопку.
- [x] Тесты: 0/1/много сеансов, отменённый, sold_out, выбор сеанса, возврат к карточке.

#### 2.2. Тарифы

- [x] `format.ts`: `formatOffers(event)` — название, цена, `adult/child/reduced`, «бесплатно», «цена не указана».
- [x] `keyboards.ts`: кнопка `🎟 Тарифы` при `offers.length > 0`.
- [x] `bot.ts`: `showOffers(ctx, eventId)` + `backToEventKeyboard`.
- [x] Если тарифов нет — кнопку не показывать.
- [x] Тесты: взрослый/детский/льготный, null-цена, пустой список.

#### 2.3. Календарь `.ics`

- [x] Новый `bot/src/calendar.ts`:
  - `buildEventIcs(event, occurrence, options?)`;
  - `calendarFileName(event)`;
  - экранирование `, ; \n \\`;
  - CRLF, folding строк по 75 октетов;
  - `UID`, `DTSTAMP`, `DTSTART`, `DTEND`, `SUMMARY`, `DESCRIPTION`, `LOCATION`, `URL`, `STATUS`;
  - `time_precision = date` → all-day (`VALUE=DATE`);
  - `date_end` отсутствует → +2 часа или +1 день для all-day;
  - время переводится в UTC из `Asia/Yekaterinburg`.
- [x] `bot.ts`: callback `calendar`; `ctx.replyWithDocument(new InputFile(Buffer.from(ics), filename), { caption })`.
- [x] Кнопка `📅 В календарь` в карточке и в списке сеансов.
- [x] Если событие отменено/сеанс в прошлом — предупредить, но файл не отправлять.
- [x] Тесты: обычный сеанс, all-day, отменённый, отсутствие даты, экранирование, UTC+5, folding.

#### 2.4. Карта, шаринг, deep link

- [x] `format.ts`: `eventMapUrl(event)` — Яндекс.Карты по `lat/lon`, только для конечных чисел; `eventDeepLink(botUsername, eventId)`; `eventShareUrl(...)`.
- [x] `keyboards.ts`: `🗺 На карте` (URL), `📤 Поделиться` (URL `t.me/share/url`).
- [x] `bot.ts`: `/start event_<uuid>` — распарсить payload, проверить UUID, открыть карточку. Остальные payload — обычный старт.
- [x] В карточке «Поделиться» использует `PUBLIC_WEB_URL` или deep link бота; если нет ни того, ни другого — кнопку скрыть.
- [x] Ссылка для сайта: `https://t.me/<bot>?start=event_<uuid>` (бот уже принимает; веб можно добавить отдельно).
- [x] Тесты: payload, неверный UUID, отсутствие lat/lon, отсутствие PUBLIC_WEB_URL, share URL.

**Готово, когда:** карточка показывает все сеансы/тарифы, календарь открывается в Google/Apple Calendar, карта и шаринг работают, deep link открывает событие.

---

### Этап 3. Поиск и фильтры 2.0

#### 3.1. Возраст

- [x] `search-options.ts`: `AGE_OPTIONS = [0, 3, 6, 12, 16, 18]`, подписи «Для ребёнка 3 года» и т.п.
- [x] `SearchState.age`.
- [x] `filtersKeyboard`: кнопка `👶 Возраст` → экран выбора; «Любой возраст».
- [x] `/age 6`, `/age any`.
- [x] `formatFilterLine`: `👶 Возраст: 6 лет`.
- [x] API: `age=6`; помнить, что это возраст посетителя, проходят события с `age_limit <= age`.
- [x] Тесты: параметр, сброс, строка фильтров, пустая выдача с `hidden_unknown_age`.

#### 3.2. Сортировка

- [x] `SORT_OPTIONS`: `date`, `price`, `popularity`.
- [x] `SearchState.sort`, default `date`.
- [x] `filtersKeyboard`: `🔀 Сортировка` → экран; выбранная отмечается.
- [x] `/sort date|price|popularity`.
- [x] `loadAndSendPage` передаёт `state.sort`, а не жёсткий `'date'`.
- [x] `formatFilterLine` показывает сортировку только если она не `date`.
- [x] Тесты: каждый вариант, дефолт, строка фильтров.

#### 3.3. Язык

- [x] `LANGUAGE_OPTIONS`: `ru`, `ba` (при наличии `tt` — добавить позже).
- [x] `SearchState.language`.
- [x] `filtersKeyboard`: `🌐 Язык` → «Любой / Русский / Башкирский».
- [x] `/language ru|ba|any`.
- [x] API: `language=ru`.
- [x] Тесты: параметр, сброс, строка фильтров.

#### 3.4. Диапазон дат

- [x] `search-options.ts`: `parseIsoRange('2026-11-20..2026-11-25')`, максимум 31 день.
- [x] `SearchState.dateFrom/dateTo`; при установке диапазона `date = null`, и наоборот.
- [x] `/date 2026-11-20..2026-11-25`.
- [x] UI: `📆 Период` → выбор начала (10 дней), затем конца (до 14 дней от начала); «Сбросить период».
- [x] `formatFilterLine`: `📅 20–25 ноября`.
- [x] API: `date_from`, `date_to`.
- [x] Тесты: валидный/невалидный диапазон, конец раньше начала, >31 дня, сброс, строка фильтров.

#### 3.5. Счётчики `facets`

- [x] Сохранять `response.facets` в `SearchState`.
- [x] `citiesKeyboard`/`categoriesKeyboard` принимают `facets` и показывают `Уфа · 12`, если счётчик есть.
- [x] Для цены и возраста использовать `facets.price`/`age_limits`, если доступны.
- [x] Если facets нет (старый бэкенд) — показывать прежние подписи без цифр.
- [x] Тесты: с facets, без facets, счётчик 0.

#### 3.6. Серверные `relaxations`

- [x] `formatNoResults` принимает `relaxations` и показывает «Ничего не нашлось, но можно…».
- [x] `noResultsKeyboard` строит кнопки из `relaxations`: `Без ограничения цены · 3`; callback `{ type: 'relax', params, label }`.
- [x] `bot.ts`: обработчик `relax` — преобразует `relaxation.query` в `SearchState` и запускает поиск.
- [x] Если `relaxations` пусты — текущие кнопки снятия фильтров как fallback.
- [x] Поддержать `label` строкой и объектом `{ru, ba}`.
- [x] Тесты: пустая выдача с relaxations, выбор варианта, fallback, русская/башкирская подпись.

**Готово, когда:** в фильтрах есть возраст/сортировка/язык/период, счётчики видны, пустая выдача использует серверные варианты; старые фильтры работают.

---

### Этап 4. Подписки и безопасность

#### 4.1. Подписка → события

- [x] `subscriptionsKeyboard`: на каждую подписку две кнопки в одной строке:
  - `▶️ <категория> · <город>` — показать события;
  - `❌` — удалить.
- [x] Callback `{ type: 'subscriptions', action: 'show', id }`; `bot.ts` находит подписку в списке и вызывает `startSearch({ city, category, date: period })`.
- [x] Если подписка не найдена — сообщение и обновлённый список.
- [x] Тесты: показ событий по подписке, удаление, несуществующая подписка.

#### 4.2. HMAC `user_ref`

- [x] `user-ref.ts`: `telegramUserRef` → `telegram_<base64url(HMAC-SHA256(secret, 'user:' + id)).slice(0, 32)>`.
- [x] Секрет: `USER_REF_SECRET` → `LOG_HASH_SECRET` → `TELEGRAM_BOT_TOKEN`.
- [x] `USER_REF_MODE=hmac|legacy`, default `hmac`; legacy — для отката.
- [x] Валидация длины 16–128, только `[A-Za-z0-9_-]`.
- [x] Документировать: старые подписки с `telegram_00000123` перестанут находиться; это pre-release изменение. Если есть живые подписки — нужен отдельный migration plan на бэкенде.
- [x] Тесты: стабильность, разные id, разные секреты, legacy-режим, невалидный id.
- [x] Понимать: это не закрывает P0-5 полностью; `DELETE` по UUID без `user_ref` всё ещё возможен на бэкенде.

**Готово, когда:** подписки можно открывать одним нажатием, `user_ref` не перебирается по числовому id, режим отката работает.

---

### Этап 5. Надёжность и наблюдаемость

- [x] `api/client.ts`: retry для GET при network/timeout/5xx, 2 попытки, задержка 200/600 мс, `Retry-After` для 429 (дольше 5 с — без повтора), без retry для POST/DELETE и 4xx.
- [x] `API_RETRY_ATTEMPTS=2` в конфиге; тесты: 500→200, timeout→200, 400 без retry, POST без retry.
- [x] ETag-кеш карточек событий (P2): в `api/client.ts` `getEvent` хранит `{etag, data, expiresAt}` (TTL 60 с, лимит 200 записей). В пределах TTL карточка отдаётся без сети; после TTL — ревалидация `If-None-Match`, `304` отдаёт кеш и продлевает TTL, `200` обновляет данные и ETag. Проверено против живого бэкенда: `ETag: W/"…"` и повторный запрос → `304`.
- [x] `smoke.ts`: добавить проверки новых методов; `venue schedule` и `assistant` — `SKIP` при 404/503.
- [x] Логи: `event_sessions_opened`, `offers_opened`, `calendar_sent`, `map_opened` (без URL с координатами? координаты не PII, но не логировать), `relax_applied`, `subscription_search`.
- [x] Метрики: счётчики в логах, без внешней системы.
- [x] Проверить rate limit на новые callback-и.

**Готово, когда:** smoke зелёный на main-бэкенде и на PR #19, retry не дублирует mutation-запросы, в логах нет PII.

---

### Этап 6. Ассистент и расписание площадки

**Важно:** это дополнительные сценарии. По умолчанию они выключены или мягко деградируют.

#### 6.1. Расписание площадки

- [x] `api/types.ts`: `VenueScheduleSchema`.
- [x] `api/client.ts`: `getVenueSchedule`.
- [x] `format.ts`: `formatVenueSchedule(schedule, directories, now)`.
- [x] `keyboards.ts`: `🏛 Афиша площадки` при `venue_id`; `venueScheduleKeyboard`.
- [x] `bot.ts`: callback `venue`; период — от даты события (или сегодня) на 14 дней, максимум 31; при 404/400 — «Расписание площадки пока недоступно».
- [x] Тесты: успех, пустое расписание, 404, группировка по датам.

#### 6.2. Ассистент: query

- [x] `ASSISTANT_ENABLED=0` по умолчанию.
- [x] `bot/src/api/assistant.ts` или методы в клиенте:
  - `queryAssistant({ message, channel: 'telegram', user_ref, previous, patch, answering, limit })`;
  - `confirmAssistant(confirmationId, decision)`.
- [x] Zod-схемы ответа: `action`, `message`, `constraints`, `chips`, `assumptions`, `clarify`, `results`, `total`, `hidden_unknown_*`, `relaxations`, `unsupported_actions`, `confirmation`, `events_query`, `reference_date`, `timezone`, `engine`, `trace_id`.
- [x] `bot.ts` в `handleText`: если ассистент включён и нет черновика подписки — вызвать ассистент; иначе текущий поиск.
- [x] Fallback: 404/503/timeout/contract → `startSearch({ q: text })` + лог `assistant_fallback`; 429 → сообщение «подождите», без fallback.
- [x] Рендер `action: search`: сообщение, допущения, результаты, кнопки событий; `hidden_unknown_*` и `relaxations` — как в поиске.
- [x] Рендер `action: clarify`: сообщение + `quick_replies` кнопками.
- [x] Рендер `action: out_of_scope`: сообщение + «Обычный поиск» / меню.
- [x] `action: confirmation_required`: summary + «Подтвердить» / «Отменить», только если `ASSISTANT_CONFIRMATIONS=1`.
- [x] Состояние: `SessionData.assistant = { previous, clarifyCode, lastMessage }`, TTL сессии.
- [x] Логи: `engine`, `action`, `trace_id`, `latency_ms`, `fallback`, без текста сообщения.
- [x] Тесты: search, clarify, out_of_scope, confirmation, fallback 404/503/timeout, 429, отсутствие PII.

#### 6.3. Ассистент: chips и patch

- [x] Callback `{ type: 'assistant', action: 'chip', key, value, unset }`.
- [x] ~~Отправлять `patch: { set: { [key]: value }, unset }` + `previous`.~~ Закрыто как «не требуется»: бэкенд отдаёт чипы только для **снятых** условий (`removable: true` + `unset`), значения в чипах — человеческие подписи («Уфа»), а не идентификаторы, а `patch.set` ждёт объект `{ hard: {…}, soft: {…} }`. Добавление условий в боте идёт текстом и быстрыми ответами; `patch.set` поддержан в клиенте (`AssistantPatch`) на будущее, кнопочного сценария под него нет.
- [x] Обновлять `previous` из ответа.
- [x] Кнопки chips под результатом; «Сбросить условие» для removable.
- [x] Тесты: chip set, chip unset, несколько chips, ошибка API.

#### 6.4. Ассистент: confirm

- [x] Callback `{ type: 'assistant', action: 'confirm', id, decision }`.
- [x] `POST /assistant/confirm` с `confirmation_id` и `decision`.
- [x] По умолчанию выключено. P0-4 исправлен: токен ≥ 128 бит, хранится хешем, привязан к `user_ref`; для включения — `ASSISTANT_CONFIRMATIONS=1`.
- [x] Тесты: approve, reject, 404/410, выключенный флаг.

**Готово, когда:** с PR #19 и `ASSISTANT_ENABLED=1` работают search/clarify/chips; с main-бэкендом — обычный поиск без ошибок; confirm включается после фикса P0-4 (сделан в бэкенде 14.11.2026).

---

### Этап 7. Документация и выпуск

- [x] `bot/README.md`: новые сценарии, env-переменные, API-методы, ограничения, что делать при 404.
- [x] `README.md`: обновить описание бота.
- [x] `docs/TZ_COMPLIANCE.md`: 6.2-2/3/4, 6.4 — ассистент (если включаем), честные статусы.
- [x] `docs/PR19_BACKEND_REVIEW.md`: обновить число тестов/smoke, если меняется.
- [x] `bot/.env.example`: `ASSISTANT_ENABLED`, `ASSISTANT_CONFIRMATIONS`, `API_RETRY_ATTEMPTS`, `USER_REF_SECRET`, `USER_REF_MODE`.
- [ ] `npm run check`, `npm run smoke` на main и PR #19.
- [ ] Ручной прогон в Telegram по чек-листу.
- [ ] Коммит и пуш — только после отдельного согласования.

---

## 8. Детальный бэклог

| ID | Задача | Основные файлы | Зависит от |
|---|---|---|---|
| B-01 | CI для бота | `.github/workflows/bot.yml`, `bot/package.json` | — |
| B-02 | Типы facets/relaxations/venue/assistant | `bot/src/api/types.ts` | — |
| B-03 | Новые параметры поиска | `bot/src/api/client.ts` | B-02 |
| B-04 | Новые поля `SearchState` | `bot/src/session.ts` | B-02 |
| B-05 | Новые callback-типы | `bot/src/callbacks.ts` | B-04 |
| B-06 | Все сеансы события | `format.ts`, `keyboards.ts`, `bot.ts`, `callbacks.ts` | B-04, B-05 |
| B-07 | Тарифы | `format.ts`, `keyboards.ts`, `bot.ts` | B-06 |
| B-08 | `.ics`-календарь | `calendar.ts`, `bot.ts`, `keyboards.ts` | B-06 |
| B-09 | Карта и шаринг | `format.ts`, `keyboards.ts` | — |
| B-10 | Deep link `/start event_...` | `bot.ts`, `format.ts` | B-09 |
| B-11 | Фильтр возраста | `search-options.ts`, `session.ts`, `keyboards.ts`, `bot.ts` | B-04, B-05 |
| B-12 | Сортировка | `search-options.ts`, `session.ts`, `keyboards.ts`, `bot.ts` | B-04, B-05 |
| B-13 | Фильтр языка | `search-options.ts`, `session.ts`, `keyboards.ts`, `bot.ts` | B-04, B-05 |
| B-14 | Диапазон дат | `search-options.ts`, `session.ts`, `keyboards.ts`, `bot.ts` | B-04, B-05 |
| B-15 | Счётчики facets | `keyboards.ts`, `bot.ts`, `session.ts` | B-02, B-04 |
| B-16 | Релаксации | `format.ts`, `keyboards.ts`, `bot.ts`, `callbacks.ts` | B-02, B-04 |
| B-17 | Подписка → события | `keyboards.ts`, `bot.ts`, `callbacks.ts` | — |
| B-18 | HMAC `user_ref` | `user-ref.ts`, `config.ts`, `.env.example`, `bot.ts` | — |
| B-19 | Retry GET | `api/client.ts`, `config.ts` | — |
| B-20 | ETag-кеш (P2) | `api/client.ts` | B-19 |
| B-21 | Расписание площадки | `api/types.ts`, `api/client.ts`, `format.ts`, `keyboards.ts`, `bot.ts` | B-02 |
| B-22 | Ассистент: query + fallback | `api/assistant.ts`, `bot.ts`, `config.ts`, `session.ts` | PR #19 |
| B-23 | Ассистент: clarify/chips | `assistant.ts`, `keyboards.ts`, `bot.ts`, `callbacks.ts` | B-22 |
| B-24 | Ассистент: confirm | `assistant.ts`, `bot.ts`, `config.ts` | B-22, P0-4 |
| B-25 | Smoke и документация | `smoke.ts`, `README.md`, `docs/TZ_COMPLIANCE.md` | все |

---

## 9. Тест-план

### Unit

- `calendar.test.ts`: ICS, escaping, folding, UTC, all-day, cancelled.
- `format.test.ts`: сеансы, тарифы, фильтры, relaxed labels, facets, map/share.
- `keyboards.test.ts`: новые экраны, лимиты кнопок, пагинация.
- `search-options.test.ts`: age/sort/language/range parsing.
- `user-ref.test.ts`: HMAC, legacy, стабильность.
- `api.test.ts`: новые параметры, venue schedule, assistant schemas, retry.
- `config.test.ts`: новые env-переменные.

### Bot-сценарии

- карточка → все сеансы → выбор сеанса → календарь;
- карточка → тарифы → назад;
- карточка → карта/шаринг (кнопки URL);
- `/start event_<uuid>` → карточка; `/start event_bad` → меню;
- фильтр возраста/сортировки/языка/периода;
- пустая выдача → relaxations → выбор;
- подписка → показать события;
- ассистент: search/clarify/chip/out_of_scope/confirm;
- ассистент: 404/503/timeout → обычный поиск;
- ошибки API не ломают диалог;
- HTML-экранирование новых полей;
- логи без PII.

### Smoke

- health, справочники, поиск, карточка, similar;
- новые поля карточки: occurrences/offers, если есть;
- venue schedule — `SKIP` на 404;
- assistant — `SKIP` на 404/503;
- подписки create/list/delete.

### Ручной Telegram-чек-лист

- [ ] `/start`, меню, `/help`.
- [ ] deep link из сайта/шаринга.
- [ ] событие с несколькими сеансами.
- [ ] `.ics` открывается в Google Calendar и Apple Calendar.
- [ ] «На карте» открывает площадку.
- [ ] «Поделиться» открывает выбор чата.
- [ ] фильтр по возрасту и сортировка.
- [ ] пустая выдача с relaxations.
- [ ] подписка → показать события.
- [ ] ассистент с флагом on и off.
- [ ] ошибка API/404 не ломает сценарий.

---

## 10. Критерии приёмки по этапам

| Этап | Критерий |
|---|---|
| 0 | CI зелёный, `npm run check` зелёный |
| 1 | новые типы/параметры/состояние, старые тесты зелёные (сейчас 199) |
| 2 | все сеансы, тарифы, ICS, карта, шаринг, deep link; тесты |
| 3 | возраст, сортировка, язык, период, facets, relaxations; тесты |
| 4 | подписка → события; HMAC user_ref; тесты |
| 5 | retry, smoke, логи; тесты |
| 6 | venue schedule; assistant search/clarify/chips; fallback; тесты |
| 7 | README/TZ обновлены, smoke на main и PR #19, ручной чек-лист |

**Общий критерий:** `typecheck`, `test`, `build`, smoke — зелёные; ни одного нового падения на 404/503; в логах нет токена, сырого Telegram id, `user_ref` и текста запроса.

---

## 11. Риски и mitigation

| Риск | Что делаем |
|---|---|
| Бэкенд PR #19 не влит, контракт assistant меняется | Адаптер за флагом, loose-схемы, fallback на поиск, не включать по умолчанию |
| `similar`/`venue schedule` 404 в main | Кнопка есть, обработчик показывает понятное сообщение; smoke `SKIP` |
| Перегруженная клавиатура карточки | Подменю, 2 кнопки в ряд, скрывать недоступные кнопки |
| `.ics` неверно открывается | UTC-конвертация, тесты, ручная проверка Google/Apple |
| HMAC user_ref ломает старые подписки | `USER_REF_MODE=legacy` для отката, документировать pre-release |
| P0-4 confirmation-токены | Исправлено в бэкенде 14.11.2026; флаг включается осознанно |
| Слишком много scope | Этапы, флаги, P2-задачи (ETag, полный range picker) можно отложить |
| Rate limit/длинные сообщения | `splitMessage`, лимитер, тесты на длинные тексты |

---

## 12. Порядок и оценка

Оценка условная, без бэкенда и без ревью:

| Этап | Оценка |
|---|---|
| 0. CI и baseline | 0,5 дня |
| 1. API/state | 1 день |
| 2. Карточка 2.0 | 2 дня |
| 3. Поиск/фильтры 2.0 | 2 дня |
| 4. Подписки/security | 1 день |
| 5. Надёжность | 1 день |
| 6. Ассистент/venue | 2–3 дня |
| 7. Docs/релиз | 1 день |
| **Итого** | **~10–11 дней** |

Порядок важен: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7. Внутри этапов 2 и 3 задачи можно делать параллельно, но карточка и фильтры меняют одни и те же файлы, поэтому безопаснее последовательно.

---

## 13. Открытые решения

1. **HMAC user_ref:** решено — hmac по умолчанию, `USER_REF_MODE=legacy` как откат.
2. **Диапазон дат:** решено — команда `/date 20..25` и двухшаговый выбор начала/конца периода.
3. **Ассистент:** решено — код готов, `ASSISTANT_ENABLED=0`; включать после мержа PR #19 и smoke.
4. **Подтверждения ассистента:** P0-4 исправлен, можно включать `ASSISTANT_CONFIRMATIONS=1`; по умолчанию 0.
5. **Уведомления:** оставляем бэкенду. Рекомендация — не делать polling в боте.
6. **ETag-кеш:** P2, не блокирует релиз; в текущем объёме не реализован.

---

## 14. Definition of Done

- [ ] Все задачи выбранного этапа реализованы.
- [x] `npm run typecheck`, `npm test`, `npm run build` зелёные.
- [ ] Smoke на main-бэкенде и PR #19 зелёный (с `SKIP` для отсутствующих методов).
- [x] Новые тесты покрывают успех, пустоту, 404/400/503, таймаут, HTML-escaping.
- [x] В логах нет токена, сырого Telegram id, `user_ref` и текста запроса.
- [x] README и `TZ_COMPLIANCE` обновлены.
- [x] Feature flags по умолчанию безопасные.
- [ ] Ручной Telegram-чек-лист пройден.
- [ ] Коммит и пуш — только после отдельного согласования.
