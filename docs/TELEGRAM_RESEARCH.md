# Telegram Bot API: первичная сверка для адаптера куратора

Дата: 2026-11-12  
Статус: исследование официальной документации, не живой интеграционный тест  
Связанные материалы: Issue #13, `docs/CHANNELS_API.md`, `evals/channels/`

## 1. Границы

Проверялись только свойства Telegram Bot API и Mini Apps, необходимые для проектирования адаптера. Источники данных/API афиши Башкортостана не исследовались. Реальный бот, webhook, polling, клиенты Telegram и Mini App не запускались.

Основной источник: [Telegram Bot API](https://core.telegram.org/bots/api). Для Mini Apps: [Telegram Mini Apps](https://core.telegram.org/bots/webapps). Прямой доступ к сайту из рабочего окружения был нестабилен, поэтому перед реализацией необходимо повторно открыть соответствующие разделы и сверить актуальную редакцию. Номер версии Bot API здесь намеренно не фиксируется как неизменный факт проекта.

Все сроки хранения собственных записей, TTL действий, очереди и retry нашего backend являются проектными решениями, а не обещаниями Telegram.

## 2. Два разных acknowledgement

В адаптере нельзя смешивать:

1. **Acknowledgement доставки update** — HTTP 200 на webhook либо продвижение `offset` в `getUpdates`.
2. **Acknowledgement callback кнопки** — вызов `answerCallbackQuery` для конкретного `CallbackQuery.id`.

Первое подтверждает приём update транспортом, второе снимает состояние ожидания callback в клиенте. Ни одно само по себе не означает успешный accept плана.

### 2.1. CallbackQuery требует ответа

Источники:

- [`CallbackQuery`](https://core.telegram.org/bots/api#callbackquery);
- [`answerCallbackQuery`](https://core.telegram.org/bots/api#answercallbackquery).

Официальная документация указывает, что после нажатия callback-кнопки клиент показывает progress до вызова `answerCallbackQuery`, и вызывать метод необходимо даже тогда, когда текстовое уведомление не нужно.

Проектные решения:

- вызвать `answerCallbackQuery` после минимальной валидации, не ожидая поиск, построение плана или внешний recheck;
- если текст не нужен, вызвать метод без `text`;
- acknowledgement не считать подтверждением бизнес-операции;
- не придумывать дедлайн «N секунд»: в проверенном разделе такого нормативного числа нет.

Поля `answerCallbackQuery`, важные адаптеру:

- `callback_query_id` относится к конкретному callback;
- `text` имеет документированный предел 0–200 символов;
- `show_alert` меняет способ показа уведомления, но не возвращает выбор «Да/Нет»;
- `cache_time` по умолчанию 0; для изменчивой афиши не полагаемся на клиентский cache ответа callback.

Локальный validator должен ограничивать длину текста до вызова API. `show_alert=true` нельзя использовать вместо отдельного confirmation flow.

### 2.2. `CallbackQuery.id` и `callback_data` не одно и то же

Источники:

- [`CallbackQuery`](https://core.telegram.org/bots/api#callbackquery);
- [`InlineKeyboardButton`](https://core.telegram.org/bots/api#inlinekeyboardbutton).

`CallbackQuery.id` идентифицирует запрос и может использоваться в delivery-dedupe журнале. `callback_data` — данные кнопки, документированный размер 1–64 **байта**, а не 64 Unicode-символа.

Проектный формат:

```text
callback_data = "v1:" + opaque_short_action_token
```

В callback_data не помещаются:

- сериализованный план или все occurrence IDs;
- access token, bot token или секрет webhook;
- произвольный URL;
- доверенный `user_id` как доказательство права;
- инструкции для LLM.

Серверная action record содержит principal/session, action, необходимые revisions, allowlist, expiry и consumption/idempotency state. Наличие токена не отменяет серверную авторизацию.

Перед отправкой клавиатуры проверяется UTF-8 byte length. Неизвестный, чужой, просроченный или уже поглощённый токен получает acknowledgement и безопасный отказ без мутации.

## 3. Старые сообщения и callback

Источники:

- [`CallbackQuery.message`](https://core.telegram.org/bots/api#callbackquery);
- [`MaybeInaccessibleMessage`](https://core.telegram.org/bots/api#maybeinaccessiblemessage);
- [`InaccessibleMessage`](https://core.telegram.org/bots/api#inaccessiblemessage).

Сообщение, породившее callback, может быть недоступно боту. Для `InaccessibleMessage.date` документировано значение 0. Документация также предупреждает, что исходное сообщение может уже не содержать кнопку с такими данными.

Следствия:

- нельзя восстанавливать права и актуальное состояние только из текста/клавиатуры сообщения;
- callback разрешается против серверной action record и текущих revisions;
- старая клавиатура получает acknowledgement, объяснение и свежую клавиатуру;
- stale callback не меняет session/result/plan;
- если исходное сообщение недоступно, актуальное состояние отправляется новым сообщением.

`InaccessibleMessage.date=0` — признак типа сообщения, а не время события и не основание для автоматического accept.

## 4. Обновления: webhook и getUpdates

### 4.1. Взаимоисключаемые способы получения

Источники:

- [Getting updates](https://core.telegram.org/bots/api#getting-updates);
- [`getUpdates`](https://core.telegram.org/bots/api#getupdates);
- [`setWebhook`](https://core.telegram.org/bots/api#setwebhook);
- [`deleteWebhook`](https://core.telegram.org/bots/api#deletewebhook).

Документация описывает `getUpdates` и webhook как взаимоисключающие способы. `getUpdates` не работает при установленном outgoing webhook. Входящие updates хранятся на сервере Telegram ограниченное время; в документации указано не более 24 часов.

Проектное решение: основной развёрнутый адаптер использует один выбранный режим. Локальная разработка не должна незаметно перехватывать updates production-бота; предпочтителен отдельный тестовый бот. Переключение режима — явная операция deployment, не побочный эффект запуска теста.

### 4.2. Durable inbox до acknowledgement

Для webhook Telegram отправляет HTTPS POST с JSON Update и повторяет unsuccessful request в течение не конкретизированного «reasonable amount of attempts». Источник: [`setWebhook`](https://core.telegram.org/bots/api#setwebhook).

Обязательный порядок нашего адаптера:

```text
проверка webhook secret
→ синтаксическая валидация envelope
→ атомарная durable запись update / dedupe marker
→ постановка внутренней задачи
→ HTTP 200
→ асинхронная бизнес-обработка
```

HTTP 200 до durable commit запрещён: падение в этом окне может потерять update. Число повторов Telegram и backoff не выдумываются.

Telegram позволяет ответить на webhook 2XX с JSON-вызовом Bot API, но документация предупреждает, что результат такого вызова нельзя узнать. Для критичных сообщений и acknowledgement callback адаптер вызывает Bot API отдельно и обрабатывает результат.

### 4.3. Offset в polling

Источник: [`getUpdates`](https://core.telegram.org/bots/api#getupdates).

Update считается подтверждённым, когда `getUpdates` вызван с `offset` выше его `update_id`; предыдущие updates забываются. Поэтому polling worker продвигает offset только после durable сохранения/обработки по выбранной транзакционной модели. Тест падения до commit должен показать, что offset не продвинулся.

## 5. Duplicate и ordering

Источник: [`Update`](https://core.telegram.org/bots/api#update).

Документация говорит, что `update_id` позволяет игнорировать повторные updates и восстанавливать правильную последовательность. После отсутствия новых updates не менее недели следующий идентификатор может быть выбран случайно вместо последовательного.

Проектные выводы:

- exactly-once delivery не предполагается;
- повторная доставка должна давать не более одной бизнес-мутации;
- delivery-dedupe по `update_id`/`CallbackQuery.id` дополняет, но не заменяет domain idempotency;
- номер update не заменяет `session_revision`, `result_revision`, `plan_revision` и `preview_revision`;
- поздний update не откатывает более новое состояние;
- после длительного перерыва нельзя строить защиту только на монотонности `update_id`.

Пример контрактного испытания: обработать update 102, затем повтор/более старый 101 и проверить отсутствие отката. Это тест нашего адаптера, а не утверждение, что Telegram всегда доставляет именно в таком порядке.

## 6. Webhook secret

Источник: [`setWebhook.secret_token`](https://core.telegram.org/bots/api#setwebhook).

Telegram может отправлять заданный секрет в заголовке `X-Telegram-Bot-Api-Secret-Token` каждого webhook request.

Проектные требования:

- установить случайный секрет через secret manager;
- проверять заголовок до бизнес-обработки тела;
- использовать constant-time сравнение;
- не логировать секрет и не помещать его в Git/URL/LLM context;
- не считать секретный URL единственной защитой;
- после секрета всё равно выполнять schema/size checks и domain authorization.

Этот секрет подтверждает webhook configuration, но не заменяет проверку владельца session и revisions для конкретного действия.

## 7. Редактирование сообщений

Источники:

- [`editMessageText`](https://core.telegram.org/bots/api#editmessagetext);
- [`editMessageReplyMarkup`](https://core.telegram.org/bots/api#editmessagereplymarkup);
- [`ResponseParameters`](https://core.telegram.org/bots/api#responseparameters).

Перед вызовом адаптер строит canonical render:

- текст и клавиатура не изменились → edit не вызывается;
- изменилась только клавиатура → `editMessageReplyMarkup`;
- изменился текст → соответствующий edit;
- сообщение недоступно/edit завершился ошибкой → новое сообщение с актуальной revision.

Строка `message is not modified` может обрабатываться defensively как эксплуатационный no-op, но в проверенных разделах не зафиксирована как стабильный машиночитаемый контракт. Основная защита — локальный diff, а не сопоставление человекочитаемой ошибки. Другая ошибка 400 не должна маскироваться как no-op.

При `429 + retry_after` задача откладывается не меньше чем на указанное сервером время. Нельзя создавать retry-шторм или повторную бизнес-мутацию.

## 8. Inline keyboard

Источники:

- [`InlineKeyboardMarkup`](https://core.telegram.org/bots/api#inlinekeyboardmarkup);
- [`InlineKeyboardButton`](https://core.telegram.org/bots/api#inlinekeyboardbutton).

Клавиатура относится к сообщению. У кнопки должен использоваться ровно один из документированных optional fields; для наших действий — `callback_data` с opaque token. Для read-only Mini App существует отдельное поле `web_app`, но Mini App не обязателен для MVP.

Адаптер ограничивает число действий компактным summary и предоставляет текстовые эквиваленты. Конкретная раскладка проверяется в живых клиентах; контрактные JSONL не доказывают внешний вид или accessibility.

## 9. Mini Apps — только отложенная опция

Если после официального задания Mini App будет выбран, применяются отдельные правила.

Источники:

- [Initializing Mini Apps](https://core.telegram.org/bots/webapps#initializing-mini-apps);
- [`WebAppInitData`](https://core.telegram.org/bots/webapps#webappinitdata);
- [Validating data received via the Mini App](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).

Официальная документация требует валидировать `initData` на backend и прямо помечает `initDataUnsafe` как недоверенные данные.

Поэтому:

- identity нельзя получать из client-supplied `user_id` или `initDataUnsafe`;
- backend принимает исходную `Telegram.WebApp.initData` и выполняет документированную HMAC-проверку;
- bot token остаётся server-side;
- `auth_date` проверяется против проектного TTL; конкретный TTL не приписывается Telegram;
- изменение любого поля должно ломать проверку;
- `sendData` не выбирается основным транспортом каталога: документация ограничивает способы запуска, а вызов закрывает Mini App;
- обычные HTTPS read requests к backend используются только после серверной проверки initData;
- MainButton/BackButton, если появятся, не заменяют авторизацию, revisions и idempotency.

Mini App не связывает автоматически незнакомые Web/Telegram-аккаунты. До отдельного решения каждая поверхность сохраняет собственную сессию.

## 10. Rate limits без выдуманных констант

Источники:

- [Telegram Bots FAQ — limits](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this);
- [`ResponseParameters.retry_after`](https://core.telegram.org/bots/api#responseparameters).

FAQ содержит ориентиры для отправки сообщений в чат, массовых уведомлений и групп. Их нельзя автоматически переносить на `answerCallbackQuery`, edit или наш внутренний API. В проверенных разделах нет основания задавать отдельные числовые callback/edit лимиты.

Проектный адаптер:

- имеет очередь и per-chat/bulk throttling;
- читает `retry_after` из ответа;
- не повторяет раньше указанного времени;
- сохраняет idempotency бизнес-операции при повторной отправке;
- измеряет фактические ошибки на живом smoke/soak test до выбора собственных констант.

## 11. Матрица будущих integration tests

| Проверка | Ожидание | Связанные сценарии |
|---|---|---|
| Медленный поиск после callback | Ранний `answerCallbackQuery`, затем revision-bound результат | TGR, DLV |
| Повтор одного webhook update | Одна бизнес-операция | DLV, API |
| HTTP 200 до durable commit | Запрещено кодом/архитектурным тестом | DLV, SEC |
| Старый callback после SessionPatch | Ack + stale message + новая клавиатура, no mutation | TGR |
| Callback с чужим token | Безопасный отказ, нет чужих ID/revisions | TGR, SEC |
| Недоступное исходное сообщение | Новое актуальное сообщение | DLV |
| Повторный render без diff | Нет лишнего edit | DLV |
| 429 с `retry_after` | Отложенный retry без второй мутации | DLV, API |
| Два accept одного preview | Одна новая plan revision | CHG, API |
| Reject replacement | Старая revision и `attention` сохранены | CHG, TGR |
| Подмена Mini App user/hash, если Mini App выбран | Отказ сервера | SEC |
| Structured fallback без LLM | Поиск работает, условия сохранены | SEC |

Живые версии этих тестов ещё не выполнялись. Текущие сценарии — переносимая спецификация ожиданий.

## 12. Итоговый транспортный контур

```text
Webhook
→ проверить X-Telegram-Bot-Api-Secret-Token
→ durable inbox + dedupe
→ HTTP 200
→ worker
→ answerCallbackQuery (если это callback)
→ server-side action token + ownership + revisions + allowlist
→ read action или явно подтверждённая атомарная session mutation
→ canonical render diff
→ edit, а при stale/inaccessible/edit failure — новое сообщение
```

Этот порядок уменьшает потерю updates, повторные мутации и зависшие кнопки, но не является заявлением об уже измеренной надёжности системы.
