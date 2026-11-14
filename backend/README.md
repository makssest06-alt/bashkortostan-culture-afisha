# Backend API и ИИ-агент («Афиша культуры Башкортостана»)

REST API (Hono + Node.js 22), PostgreSQL 16 (внешний `DATABASE_URL` или встроенный `@electric-sql/pglite` для локального/тестового запуска без Docker) и ИИ-агент 3-го уровня по контракту [`contracts/api.openapi.yaml`](../contracts/api.openapi.yaml).

## Быстрый старт

```bash
cd backend
npm install
npm run dev
```

Сервер поднимется на `http://127.0.0.1:8000` (по умолчанию встроены миграции и демо-каталог из 24+ событий с актуальными относительными датами).

## Скрипты и CLI

| Команда | Описание |
|---|---|
| `npm run dev` | Запуск в watch-режиме (`tsx watch src/index.ts`) |
| `npm run build` | Компиляция TypeScript в `dist/` |
| `npm start` | Запуск скомпилированного сервера (`node dist/index.js`) |
| `npm run migrate` | Применить SQL-миграции (`src/cli.ts migrate`) |
| `npm run seed` | Идемпотентно загрузить справочники и демо-события |
| `npm run import:file -- <path>` | Импорт CSV/JSON-файла каталога через CLI |
| `npm run typecheck` | Проверка типов `tsc --noEmit` |
| `npm test` | Юнит- и интеграционные тесты (`vitest run`) |

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `PORT` | `8000` | Порт HTTP-сервера |
| `DATABASE_URL` | пусто | Строка PostgreSQL 16; если пуста — используется PGlite (`PGLITE_DATA_DIR=./data/pglite`) |
| `ADMIN_TOKEN` | пусто | Bearer/header-токен модератора; заглушка из `.env.example` автоматически отклоняется. В production обязателен, ≥ 32 символов |
| `ADMIN_OPEN` | пусто | `1` открывает админку без токена — только для локального демо. В production бэкенд с `ADMIN_OPEN=1` не стартует |
| `PUBLIC_WEB_URL` | `http://localhost:3210` | Публичный URL сайта (ссылки на события и источники) |
| `ASSISTANT_DISABLED` | пусто | `1` отключает ассистента (`503` + `Retry-After: 60`) |
| `LLM_API_KEY` | пусто | Ключ OpenAI-compatible LLM; без него активен локальный контур `rules-v2` |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | Базовый URL LLM API |
| `LLM_MODEL` | `gpt-4o-mini` | Имя модели |
| `LLM_TIMEOUT_MS` | `12000` | Таймаут запроса к LLM (мс) |
| `LLM_COST_IN_RUB_PER_1K` / `LLM_COST_OUT_RUB_PER_1K` | `0.015` / `0.06` | Расчёт стоимости токенов модели в ₽ |
| `ASSISTANT_RATE_LIMIT_10M` | `20` | Лимит `/assistant/query` за 10 минут на IP и на `user_ref` |
| `ASSISTANT_DAILY_LIMIT` | `200` | Суточный лимит `/assistant/query` на IP и на `user_ref` |
| `ASSISTANT_CONFIRM_LIMIT_10M` | `20` | Лимит `/assistant/confirm` за 10 минут на IP и на `user_ref` |
| `ASSISTANT_MAX_TOKENS` | `800` | Максимум токенов ответа LLM (`max_tokens`) |
| `ASSISTANT_DAILY_BUDGET_RUB` | `100` | Дневной бюджет LLM; при исчерпании — `rules-budget-v2` без вызова модели |
| `FEEDBACK_RETENTION_DAYS` | `90` | Срок хранения записей обратной связи (дней) |
| `METRICS_RATE_LIMIT` | `120` | Лимит обращений к `/metrics` (req/min) |
| `TRUST_PROXY` | `0` | `0` — брать адрес из сокета; `1` — один доверенный прокси; N — N прокси (адрес с конца `X-Forwarded-For`) |

## Основные группы эндпоинтов

- **Здоровье и метрики**: `GET /api/v1/health`, `GET /api/v1/metrics`, `GET /metrics`
- **Каталог и справочники**: `GET /api/v1/cities`, `GET /api/v1/venues`, `GET /api/v1/categories`, `GET /api/v1/dictionaries`, `GET /api/v1/facets`, `GET /api/v1/events`, `GET /api/v1/events/:id`, `GET /api/v1/events/:id/similar`, `GET /api/v1/venues/:id/schedule`
- **Подписки и обратная связь**: `POST /api/v1/subscriptions`, `GET /api/v1/subscriptions`, `DELETE /api/v1/subscriptions/:id`, `POST /api/v1/feedback`
- **ИИ-агент**: `POST /api/v1/assistant/query` (инструментальный цикл `search_events`, `get_event`, `get_similar_events`, `get_venue_schedule`, `list_dictionaries`, `create_subscription_draft`, `delete_subscription_draft`, история диалога, zero-hallucination проверка `grounding_ids`, fallback при сбое LLM), `POST /api/v1/assistant/confirm` (одноразовое подтверждение мутаций)
- **Админка (`/api/v1/admin/*`)**: события (`GET/PATCH`), импорт CSV/JSON (`GET/POST /imports`), модерация (`GET /moderation`, `POST /moderation/:id/resolve`), аудит (`GET /audit`), заявки организаторов (`GET/PATCH /applications`), сброс демо (`POST /reset`), трассы агента (`GET /traces`, `GET /traces/:id`)
