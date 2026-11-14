# Telegram-бот («Афиша культуры Башкортостана»)

Тонкий клиент Telegram Bot API (`bot/`) поверх REST API бэкенда (`backend/`):
- **Уровень 1**: меню с фильтрами (город, категория, период, «бесплатные»), пагинация, карточки с HTML-экранированием (`escapeHtml`), управление подписками, команды `/start`, `/help`, `/events`, `/subscriptions`, `/unsubscribe`, `/cancel`.
- **Уровень 3**: свободные запросы на естественном языке через `POST /api/v1/assistant/query` с `channel: "telegram"`, историей диалога (`history`), SHA-256 `user_ref` (`tg_<24hex>`), быстрыми подсказками (`quick_replies`), одноразовыми кнопками подтверждения (`POST /api/v1/assistant/confirm`) для создания/удаления подписок и автоматическим резервным поиском по каталогу при `503`/таймауте ИИ-сервиса.

## Быстрый старт

```bash
cd bot
npm install
BOT_TOKEN=<ваш_токен_от_BotFather> API_BASE_URL=http://127.0.0.1:8000 npm run dev
```

Если `BOT_TOKEN` не задан, сервис поднимается в режиме `standby` (`GET /health` возвращает `200 OK`) и не падает в `docker compose up`.

## Скрипты

| Команда | Описание |
|---|---|
| `npm run dev` | Запуск в watch-режиме (`tsx watch src/index.ts`) |
| `npm run build` | Сборка в `dist/` |
| `npm start` | Запуск `node dist/index.js` |
| `npm run typecheck` | Проверка типов `tsc --noEmit` |
| `npm test` | Тесты (`vitest run`) |

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `BOT_TOKEN` | пусто | Токен Telegram-бота (без него — `standby`) |
| `BOT_MODE` | `auto` | `auto` \| `polling` \| `webhook` \| `standby` |
| `WEBHOOK_URL` | пусто | Публичный HTTPS URL вебхука (при `auto` включает webhook-режим) |
| `WEBHOOK_SECRET` | пусто | Секрет заголовка `X-Telegram-Bot-Api-Secret-Token` (`401` при несовпадении) |
| `BOT_PORT` | `8081` | HTTP-порт для `/health` и `POST /webhook` |
| `API_BASE_URL` | `http://localhost:8000` | Базовый URL backend API |
| `PUBLIC_WEB_URL` | `http://localhost:3210` | Базовый URL веб-приложения для ссылок на карточки |
| `POLL_TIMEOUT_SEC` | `25` | Long polling таймаут `getUpdates` (сек) |
| `API_TIMEOUT_MS` | `6000` | Таймаут HTTP-запросов каталога/подписок (мс) |
| `ASSISTANT_TIMEOUT_MS` | `12000` | Таймаут запроса к `/api/v1/assistant/query` (мс) |
