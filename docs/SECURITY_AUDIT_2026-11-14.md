# Повторный security-аудит: бэкенд, сайт↔бэк, бот↔бэк

**Дата:** 14.11.2026  
**База:** `main`, коммит `74f71ce` и последующие security-правки  
**Метод:** пять параллельных read-only аудитов на `deepseek/deepseek-flash` (ядро бэкенда, ассистент/LLM, сайт↔бэк, бот↔бэк, БД/зависимости) + ручная проверка на живом стенде.

## Вердикт

- **Открытых P0 нет.** Все пять P0 из `docs/PR19_BACKEND_REVIEW.md` закрыты, включая обход подтверждения через `confirmation_token`.
- **P1 по доступу/данным не найдено.** Найдены и закрыты P1/P2 по бюджету LLM, PII, retention, body-limit, метрикам, CORS, host-header, лимитам и зависимостям.
- **Остались известные ограничения эксплуатации** (см. ниже): общий IP-backstop за шлюзом, self-asserted `user_ref`, superuser PostgreSQL/RLS, TLS/reverse proxy, SQL-оптимизация чтения каталога. Это не открытые дыры доступа к данным, а устойчивость/инфраструктура.

## Что исправлено в этом раунде

| Область | Исправление |
|---|---|
| Confirmation | `confirmation_token` удалён из query; атомарный claim `used_at`; `channel` сохраняется; `confirm` валидируется как boolean/enum; после выполнения payload/`user_ref` очищаются; TTL 5 минут синхронизирован с контрактом |
| Бюджет LLM | Стоимость учитывается при ошибках/исчерпании tool-раундов; резервирование стоимости до вызова снижает TOCTOU при параллельных запросах |
| PII | `plan` и `steps` рекурсивно маскируются; `user_ref` в трассах хранится хешем; `save_feedback` без `user_ref` не создаёт подтверждение; summary показывает превью текста |
| Prompt injection | `title/venue/address/tags/links` обёрнуты как untrusted; jailbreak в `history` блокируется до вызова LLM |
| Retention | Индексы `004`; удаление `imports`; `raw_records`/`agent_confirmations`/`subscriptions` по индексам; `last_used_at` обновляется при чтении |
| Лимиты | per-user + IP backstop для assistant/subscriptions/feedback; pre-parse flood-лимит; read-rate-limit публичных GET; list-лимит подписок; LRU-eviction и sweep |
| Body limit | Backend `bodyLimit` (16–32 КБ публично, 6 МБ импорт) до чтения; admin body limit после auth; web-прокси читает поток с потолком; mock-ветки ограничены |
| Метрики | `METRICS_TOKEN` в production (404 без него, 401 с неверным), min 32 символа, rate-limit до auth, route-шаблон без UUID |
| CORS/headers | Admin CORS убран (backend + web, включая OPTIONS/ошибки); security headers; HSTS production; XFO/CSP только admin, `/widget` не сломан |
| Админка/сайт | `ADMIN_OPEN` игнорируется в production; token ≥32; Secure cookie; Origin через `PUBLIC_WEB_URL`/Host без XFH; host fallback только dev; login lockout ограничен |
| Бот | Экранирование HTML в 409/подсказках; redact токена в URL/Bearer; group-chat запрет подписок; ICS UID escape; warning при default `USER_REF_SECRET`; `chmod 600 .env` |
| Зависимости | `zod@4.6.7`, `@hono/node-server@2.1.8`; runtime `npm audit` — **0** во всех сервисах |
| CI | Workflow backend/bot/web + `npm audit --omit=dev`; bootstrap-скрипт `.env` |

## Проверки

| Проверка | Результат |
|---|---|
| backend `typecheck` / `build` | чисто |
| backend тесты | **48/48** в 6 файлах |
| bot `npm run check` | **202/202** в 12 файлах, build |
| web `typecheck` / tests / lint / build | **65/65**, чисто |
| runtime `npm audit --omit=dev` | **0 / 0 / 0** |
| bot smoke против живого API | **13/13 PASS** |
| Live P0-цикл | fake token → `confirmation_required`; чужой user_ref → 404; повтор → 409; подписка создаётся только после confirm |
| Live body limits | 2 МБ subscriptions → 413; chunked → 413; 2 МБ admin без auth → 401 |
| Live лимиты | 11 разных user_ref с одного IP проходят; один пользователь упирается в свой лимит |
| Live CORS/headers | admin без ACAO; public с `*`; `/widget` без XFO; `/admin` DENY |
| Live metrics | production: 404 без токена, 401 неверный, 200 верный; в labels нет UUID |

## Остаточные риски

1. **Общий IP-backstop за шлюзом.** При `TRUST_PROXY=0` сайт/бот приходят одним IP. Per-user лимиты работают, но 100/200/500 запросов с одного IP всё ещё могут временно заблокировать всех. Полное решение — доверенная идентичность клиента (HMAC-заголовок от бота/сайта или Redis-лимитер), не входит в этот PR.
2. **Self-asserted `user_ref`.** API проверяет формат, но не энтропию; per-user лимит — подсказка, реальный ограничитель — IP-backstop. Web генерирует 128 бит, бот — HMAC.
3. **Pre-parse flood.** Точный per-user лимит применяется после JSON/zod; невалидные запросы ограничены только body-limit и грубым flood-лимитом.
4. **Confirm сгорает при ошибке действия.** Это осознанно: retry требует нового подтверждения, зато нет двойного выполнения.
5. **Нет общего wall-clock таймаута ассистента** (до 6 × `LLM_TIMEOUT_MS`). Нужен отдельный `ASSISTANT_TOTAL_TIMEOUT_MS`.
6. **`POST /subscriptions` не требует Authorization** по контракту; `user_ref` в теле — единственный credential. Так задумано для внешних клиентов, но требует доверия к каналу.
7. **PostgreSQL:** приложение работает от суперпользователя compose, RLS не включён; дефолтный пароль `afisha` меняется `scripts/bootstrap-env.sh`, но для публичного стенда нужна отдельная роль.
8. **TLS/reverse proxy** в compose отсутствует; admin-cookie `Secure` требует HTTPS.
9. **`X-Actor`** — подсказка, а не проверенная личность; при общем `ADMIN_TOKEN` аудит не является нерепудиацией.
10. **Dev-зависимости:** полный `npm audit` содержит advisory в vitest/tinypool (в runtime-образ не попадают); CI проверяет `--omit=dev`.
11. **Публичные read-эндпоинты** всё ещё загружают весь каталог в память; добавлен rate-limit, но SQL-пагинация/кеш — отдельная задача.
12. **Callback-токены бота** многоразовые в пределах TTL (P3); опасные действия идемпотентны на бэкенде.
13. **Host fallback:** в production без `PUBLIC_WEB_URL` canonical/OG не строятся из Host; в dev fallback остаётся для localhost.

## Где смотреть

- `backend/test/security.test.ts`, `backend/test/retention.test.ts`, `backend/test/assistant.test.ts`
- `bot/test/bot.test.ts`, `bot/test/calendar.test.ts`
- `web/src/lib/api/forward.test.ts`, `web/src/lib/api/rate-limit.test.ts`, `web/src/lib/admin/auth.test.ts`
- `docs/PR19_BACKEND_REVIEW.md` §5, §10
