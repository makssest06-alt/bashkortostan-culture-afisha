# Telegram, встраиваемый виджет и публичный API

> **Вне скоупа хакатона (2026-11-13): сессии ассистента, оси ревизий, allowlist'ы, Problem Details, `Idempotency-Key`, `postMessage`-протокол виджета.** ТЗ требует REST API по п. 6.3 и агента с инструментами п. 7.2. Действующий контракт: [`contracts/api.openapi.yaml`](../contracts/api.openapi.yaml), [`contracts/agent_tools.json`](../contracts/agent_tools.json). Разделы про безопасность Telegram-адаптера и виджета остаются полезными как исследование. Подробнее — [`docs/DECISIONS.md`](DECISIONS.md).

Дата: 2026-11-12  
Статус: исследовательский и контрактный черновик до получения официального задания, критериев и API хакатона  
Связанная задача: Issue #13  
Связанное исследование: `docs/TELEGRAM_RESEARCH.md`  
Машиночитаемые материалы: `contracts/public_api.openapi.json`, `contracts/widget_protocol.schema.json`, `evals/channels/`

## 1. Цель и честные границы

Документ определяет, как Web, Telegram и сторонний сайт могут работать с одним backend «ИИ-куратора культурного дня», не создавая три разных каталога и три несовместимые state machine.

Результат этапа:

- границы публичного read-only API и приватных пользовательских сессий;
- общий revision/allowlist-контракт для поиска, сравнения, плана и замены;
- Telegram-адаптер с acknowledgement, защитой от устаревших кнопок и восстановлением сообщений;
- read-only iframe-виджет со строгой проверкой origin, source и сообщений;
- OpenAPI 3.1, JSON Schema и 60 переносимых контрактных сценариев.

Это **не утверждение о реализованном сервисе**. Не выполнялись:

- запуск реального бота или отправка обновлений через Telegram;
- развёртывание API, виджета, host-страницы или инфраструктуры;
- браузерные, accessibility, usability, нагрузочные или penetration-тесты;
- измерение latency, доставляемости, порядка update или production-доступности;
- исследование конкретных источников данных/API афиши Башкортостана;
- добавление мероприятий в основной каталог.

Все ID и состояния в fixtures синтетические. Они не представляют реальные события, площадки, цены или источники. Ссылка `https://api.example.invalid` в OpenAPI, если используется, является зарезервированным placeholder, а не адресом развёртывания.

До официального задания не выбираются обязательность Mini App, механизм авторизации конечного пользователя, сроки хранения сессий, лимиты запросов и требования к хостингу.

## 2. Исходные решения, которые нельзя ослаблять

Контракт продолжает `docs/PLAN.md`, `docs/EVENT_IDENTITY.md` и UX-материалы Issue #9 / PR #10. На момент подготовки PR #10 может быть ещё не объединён; поэтому зависимость надо проверять по фактическому состоянию веток, а не считать UX файл доступным в `main`.

1. Результат поиска, сравнения и планирования — конкретная `Occurrence`, а не только `Event`.
2. Время, статус и доступность относятся к конкретной `Occurrence`; цена и sold out — к `Offer`/доступности этой `Occurrence`.
3. `unknown` не означает `false`, `0`, `free`, `scheduled`, «0+» или «подходит».
4. Hard constraints проверяет backend. Soft preferences влияют только на ranking и не ослабляются молча.
5. LLM интерпретирует запрос и объясняет уже вычисленный результат, но не является источником фактов.
6. Structured search работает без LLM.
7. Сравниваются 2–3 `Occurrence`.
8. Каждый принятый `SessionPatch` увеличивает `session_revision`; непринятый patch и replay уже применённого идемпотентного запроса — нет.
9. Search, comparison/plan и replacement previews имеют собственные revisions и собственные allowlists.
10. Сохранённый план — immutable snapshot. Изменение каталога создаёт причину для `attention`, но не переписывает snapshot.
11. Reject/«оставить как есть» сохраняет исходную `plan_revision` и `attention`; возврат в `saved` возможен только после accept валидной новой revision.
12. Web- и Telegram-аккаунты незнакомых пользователей автоматически не связываются.
13. Публичный ассистент получает read-only инструменты; административные merge/split и внешние purchase/booking/payment в этот контур не входят.
14. Права проверяются сервером. Промпт, CORS, скрытая кнопка и подпись клиента не заменяют авторизацию.

## 3. Источники и уровень доказательности

### 3.1. Как читать ссылки

- **Наблюдение** прямо следует из спецификации или официальной документации.
- **Проектное решение** выбрано для этого продукта и не выдаётся за требование стандарта.
- **Открытая проверка** требует реализации, живого канала или официального задания.

### 3.2. API, ошибки и браузерная безопасность

| ID | Первичный источник | Что использовано |
|---|---|---|
| A1 | [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html), [актуальная версия](https://spec.openapis.org/oas/latest.html) | Машиночитаемое описание HTTP API; наш файл фиксирует версию `3.1.0`, а не претендует на автоматическую совместимость со всеми будущими версиями |
| A2 | [OpenAPI 3.1 JSON Schema dialect](https://spec.openapis.org/oas/3.1/dialect/2024-11-10), [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/json-schema-core) | Схемы запросов/ответов и отдельная схема widget envelope |
| A3 | [RFC 9457 — Problem Details](https://www.rfc-editor.org/rfc/rfc9457.html) | `application/problem+json`, согласованный `status`, безопасные диагностические поля |
| A4 | [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html) | Значения методов и статусов; 409 как конфликт с текущим состоянием ресурса; 412 как неуспешное условие conditional headers |
| A5 | [RFC 6585](https://www.rfc-editor.org/rfc/rfc6585.html) | 429 и 428 определены здесь, а не в RFC 9110; для 429 допустим `Retry-After` |
| W1 | [MDN `Window.postMessage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage) | Точный `targetOrigin`; проверка `origin`, желательно `source`, и валидация данных принимающей стороной |
| W2 | [MDN iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe) | Атрибуты iframe/sandbox; опасное сочетание `allow-scripts` и `allow-same-origin` для same-origin embed не считается изоляцией |
| W3 | [MDN CSP `frame-ancestors`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors), [W3C CSP3](https://www.w3.org/TR/CSP3/#directive-frame-ancestors) | Разрешённые родители задаются HTTP-заголовком; директива не наследуется от `default-src` |
| W4 | [Fetch/CORS](https://fetch.spec.whatwg.org/#http-access-control-allow-origin) | Exact origin allowlist; `Access-Control-Allow-Origin: *` не сочетается с credentialed requests |
| W5 | [OWASP REST Security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html), [HTML5 Security](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html), [Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html), [Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) | Серверная авторизация, безопасная обработка сообщений, запрет секретов в URL/клиенте и чувствительных данных в логах |

Важные терминологические решения:

- ошибка 422 называется **Unprocessable Content**;
- revision mismatch в теле запроса получает 409, а не 412;
- `If-Match` + 412 не смешивается с выбранной body-based моделью;
- `Idempotency-Key` — проектная конвенция API, а не заявленный здесь RFC-стандарт;
- CORS — механизм браузерного доступа к ответу, а не авторизация;
- `frame-ancestors` нельзя надёжно заменить `<meta>` или `default-src`.

### 3.3. Telegram

Первичная справка: [Telegram Bot API](https://core.telegram.org/bots/api), разделы `Update`, `CallbackQuery`, `answerCallbackQuery`, `InlineKeyboardMarkup` и Updating messages. Дополнительный справочный материал по клиентской обработке: [python-telegram-bot documentation](https://docs.python-telegram-bot.org/). Mini Apps рассматриваются только по [официальной документации Telegram](https://core.telegram.org/bots/webapps) и не включаются в обязательный MVP.

Из контракта Bot API и предыдущего UX-исследования следуют только осторожные выводы:

- callback содержит служебные идентификаторы и должен получать acknowledgement через соответствующий Bot API-метод;
- callback может относиться к сообщению, которое больше не отражает актуальное состояние сессии;
- редактирование сообщения — отдельная операция, которая может завершиться ошибкой;
- значение `callback_data` приходит от клиента и поэтому не является доказательством права на действие;
- клиент Telegram контролирует рендеринг и доступность клиентских средств, которые нельзя приписать нашему Web UI.

**Не заявляются** без отдельного живого теста: гарантированный порядок обработки updates, exactly-once delivery, конкретный timeout кнопки, универсальное поведение всех клиентов или успешность edit в любом возрасте сообщения. Наш адаптер проектируется так, чтобы корректно деградировать и **не полагаться** на эти свойства. Отдельная сверка acknowledgement, 64-байтового `callback_data`, durable inbox, duplicate delivery и recovery находится в `docs/TELEGRAM_RESEARCH.md`. Численные лимиты не становятся неизменными константами доменной модели и повторно сверяются с первичной документацией в момент реализации.

## 4. Архитектура: один контур решений, разные представления

```text
Web UI ───────────────┐
Telegram adapter ─────┼─→ Application API → Session/Preview service
Widget BFF ───────────┘          │             ├─ deterministic constraints/planner
                                 │             ├─ revision + allowlist registry
                                 │             └─ idempotency registry
                                 ├─ read-only catalog query → canonical Occurrence/Offer
                                 └─ optional LLM interpreter → draft SessionPatch only

Admin/ingestion/identity operations ── отдельный контур, недоступный этим clients
```

### 4.1. Обязанности backend

Backend, а не канал:

- валидирует `SessionPatch`, даты, неизвестные значения и критичные ограничения;
- вычисляет поисковую выдачу и aggregate counts;
- проверяет hard constraints и выполнимость плана;
- создаёт preview с серверным snapshot разрешённых `occurrence_ids`;
- проверяет session/result/plan/preview revisions;
- проверяет точный порядок ID и slot mapping при accept;
- связывает Telegram token и widget action с серверным allowlist;
- применяет идемпотентность и не раскрывает чужие ресурсы;
- возвращает факты с provenance/freshness в доступной канонической модели.

### 4.2. Обязанности адаптера

Адаптер может форматировать карточки, кнопки и тексты, но не вправе:

- добавлять ID, которых нет в выданном backend allowlist;
- считать unknown удовлетворённым;
- превращать sold out в отмену `Occurrence`;
- самостоятельно менять план или session revision;
- обещать покупку, бронирование, оплату или автоматическую связку аккаунтов;
- подставлять произвольный URL из callback/postMessage;
- показывать stack trace, токены или внутренние запросы пользователю/модели.

## 5. Единый жизненный цикл revisions и allowlists

### 5.1. Три независимых оси

| Ось | Назначение | Что не делает |
|---|---|---|
| `session_revision` | Версия принятых пользователем условий и session state | Не заменяет revision конкретного preview |
| `result_revision` | Версия последней разрешённой поисковой выдачи | Не разрешает кандидатов из plan/replacement preview |
| `plan_revision` | Версия immutable saved plan | Не снимает `attention` сама по себе |

Каждый preview дополнительно имеет `preview_id`, `preview_revision`, основание (`session_revision`, `result_revision` или `base_plan_revision`), срок действия и собственный ordered allowlist/slot mapping.

### 5.2. SessionPatch

```text
patch + expected_session_revision = N
  ├─ principal/session недоступны → безопасная ошибка, revision не меняется
  ├─ expected revision не совпадает → 409, revision и состояние не меняются
  ├─ patch не проходит схему/домен → 422, revision не меняется
  ├─ replay того же idempotent request → прежний ответ, новой мутации нет
  └─ patch принят → session_revision = N + 1
```

Даже повторное подтверждение того же значения новым запросом считается принятым patch и увеличивает revision. Пустой patch не создаёт видимой работы и отклоняется схемой/доменной проверкой. Replay определяется по idempotency record, а не по совпадению текста запроса.

После изменения условий прежняя выдача становится `stale`:

- её детали можно открыть справочно с явной пометкой;
- comparison/plan из неё запрещены до нового search preview;
- поздний ответ, вычисленный для старой session revision, не заменяет новую выдачу;
- stale response не перезаписывает `result_revision` и текущий result allowlist.

### 5.3. Отдельные allowlists

| Preview | Разрешённые ID | Основание | Допустимое последующее действие |
|---|---|---|---|
| Search | `result_occurrence_ids` | `session_revision`, query fingerprint | details, comparison/plan request только при current |
| Comparison | 2–3 ID из текущего search allowlist | `session_revision`, `result_revision` | просмотр сравнения |
| Plan | ordered plan candidates и slot mapping; кандидаты только из текущего search allowlist | `session_revision` + `result_revision`; собственный candidate snapshot фиксирует, но не расширяет текущую выдачу | accept именно этого plan preview |
| Replacement | полный итоговый ordered список + изменённые slots | `base_plan_revision`, текущие constraints, recheck snapshot | accept именно этого replacement preview |

Нельзя передать ID из replacement preview в `plan-accepts` для другого preview или подменить порядок пунктов. Set-equality недостаточна: сравниваются тип preview, revision, все ожидаемые revisions, полный snapshot, порядок occurrence IDs и slot mapping.

### 5.4. Saved plan и recheck

```text
accept initial plan → saved(plan_revision = P), immutable snapshot P
recheck обнаружил проблему → attention(plan_revision = P) + reasons
replacement preview → attention(plan_revision = P), нового плана ещё нет
accept replacement → saved(plan_revision = P + 1), P остаётся читаемой
reject / «оставить как есть» → attention(plan_revision = P), reasons остаются
```

Recheck не переписывает старый snapshot и не подменяет отменённую `Occurrence` молча. Неизменённые пункты сохраняются в preview. Accept создаёт новую revision; reject не является accept и не создаёт иллюзию актуальности.

`plan_state=none` требует `plan_revision=null`. `attention` требует существующую сохранённую revision и непустой machine-readable список причин.

Тот же accept с тем же `(principal, Idempotency-Key)` возвращает сохранённый успех. Повторный accept того же preview с **новым** ключом отклоняется `409 preview_consumed` и не создаёт вторую plan revision. Для явно нового намерения нужен новый preview.

### 5.5. Durable snapshot и projection канала

Логический UX snapshot и HTTP `SessionSnapshot` не следует понимать как обязательство хранить каждый transient UI flag. Durable server state включает constraints/assumptions, revisions, result allowlist, saved plan и attention reasons. `data_state` вычисляется backend из revision binding и полноты данных и возвращается каналу.

`mode` (`search/compare/plan`) и transient `status` (`loading`, `clarifying`, `error`, `fallback` и др.) — projection адаптера над durable snapshot и текущими запросами; они не получают самостоятельного права мутировать каталог или план. `draft` — UI projection активного, ещё не принятого plan preview, а не durable saved-plan state. Durable enum плана в API: `none | saved | attention`. В UX fixtures `draft` допустим как состояние представления, но не означает сохранённую revision.

## 6. HTTP API

Нормативная машиночитаемая версия — `contracts/public_api.openapi.json`. Таблица ниже объясняет намерение; при расхождении её нужно исправить совместно со схемой и сценариями в одном PR.

### 6.1. Минимальный surface

| Метод и путь | Назначение | Ключевые проверки |
|---|---|---|
| `POST /v1/sessions` | Создать независимую сессию канала | channel, начальные constraints; `session_revision=0`, `result_revision=null`; никакого auto-link |
| `GET /v1/sessions/{session_id}` | Получить собственный snapshot | principal; чужая session → 404 без утечки |
| `POST /v1/sessions/{session_id}/patches` | Применить частичную правку | expected session revision, schema, hard/soft semantics |
| `POST /v1/sessions/{session_id}/search-previews` | Вычислить выдачу | session revision + query fingerprint; structured fallback |
| `GET /v1/occurrences/{occurrence_id}` | Публичные/read-only детали | canonical occurrence, unknown/provenance; не доказывает право plan action |
| `POST /v1/sessions/{session_id}/comparison-previews` | Сравнить 2–3 occurrence | current result allowlist, 2–3 IDs, revisions |
| `POST /v1/sessions/{session_id}/plan-previews` | Построить draft plan | current constraints/result allowlist, deterministic planner |
| `POST /v1/sessions/{session_id}/replacement-previews` | Предложить замену для saved plan | base plan revision, attention reasons, собственный allowlist |
| `POST /v1/sessions/{session_id}/plan-accepts` | Принять initial plan или replacement | тип preview, все revisions, ordered IDs/slots, expiry |
| `POST /v1/sessions/{session_id}/plan-rejections` | Отклонить replacement | сохранить исходную revision и `attention` |
| `POST /v1/sessions/{session_id}/plan-rechecks` | Перепроверить сохранённый план | read-only к каталогу; может добавить attention reasons, не мутирует snapshot |

Не добавляются:

- универсальный `/chat`, возвращающий факты от LLM;
- произвольные SQL/HTTP/shell endpoints;
- account auto-match;
- admin merge/split/moderation;
- purchase, booking, payment и неподтверждённые внешние write-действия;
- widget endpoints для accept/patch/reject.

### 6.2. Идемпотентность

Каждый POST в этом контракте требует заголовок `Idempotency-Key`.

Уникальность записи определяется парой:

```text
(principal, Idempotency-Key)
```

Внутри этой namespace запись связывается с method, canonical path и request payload fingerprint. Ключ чужого principal обрабатывается независимо: сам факт его существования не раскрывается и чужой ответ недоступен.

Правила:

1. Повтор того же запроса тем же principal с тем же ключом возвращает сохранённый успешный результат без второй мутации.
2. Тот же ключ того же principal с другим method/path/payload получает `409 idempotency_conflict`.
3. Ключ не отменяет авторизацию и revision checks при первом выполнении.
4. Сетевой retry клиента использует тот же ключ; новое намерение пользователя получает новый ключ.
5. Replayable terminal record создаётся для успешно зафиксированной операции. Отказы без мутации (включая 409/422) не кешируются как успешный terminal результат и не блокируют исправленный запрос; если исход попытки неизвестен, состояние разрешается по operation journal без второй мутации.
6. Срок хранения idempotency records и механизм очистки — deployment decision. Он должен быть измерен и описан до production, но здесь не выдумывается.
7. Сохранённый ответ не должен раскрывать секреты, внутренний stack trace или чужие revisions.

Даже после истечения idempotency record stale preview/expected revisions не позволяют применить старое действие повторно.

### 6.3. Problem Details

Ошибка возвращается как `application/problem+json`. Тело содержит стабильный машиночитаемый `code`, человекочитаемое безопасное сообщение и opaque `request_ref` для корреляции. `status` в теле совпадает с HTTP status.

| HTTP | Примеры проектных code | Гарантия |
|---|---|---|
| 400 | `malformed_request` | Синтаксическая ошибка без мутации |
| 401 | `authentication_required` | Нет раскрытия существования ресурса сверх необходимого |
| 403 | `forbidden` | Права проверены сервером; детали не раскрывают чужие данные |
| 404 | `session_not_found`, `occurrence_not_found` | Чужая/несуществующая session не раскрывает revisions |
| 409 | `revision_conflict`, `allowlist_conflict`, `preview_expired`, `preview_consumed`, `idempotency_conflict` | Нет state diff; текущая клиентская revision не считается принятой |
| 422 | `unprocessable_content` | Синтаксически читаемый запрос нарушает доменные правила |
| 429 | `rate_limited` | `Retry-After`; клиент не создаёт бурю повторов |
| 503 | `dependency_unavailable` | Сохранить введённые условия; если возможно, предложить structured fallback |
| 500 | `internal_error` | Только безопасное сообщение и `request_ref`, без stack dump |

Не всякий отказ действия — 422. Например, конфликт текущей revision относится к состоянию ресурса и потому оформляется как 409. Окончательные enum и response examples находятся в OpenAPI.

### 6.4. Доступ и изоляция principal

Предусмотрены три схемы, но окончательный выбор зависит от реализации:

- `SessionCookie` — HttpOnly, Secure, подходящий SameSite для Web; Web host выдаёт bootstrap/session cookie ещё при первоначальном ответе страницы, чтобы у `POST /v1/sessions` уже был стабильный principal для idempotency; CSRF-защита для cookie-based mutations обязательна;
- `ChannelAdapterBearer` — только server-to-server Telegram adapter → backend, никогда не публикуется в боте/браузере;
- `WidgetCapability` — строго read-only, host/origin и action scope ограничены сервером; не передаётся в URL или postMessage.

Для браузерного виджета предпочтителен same-origin widget BFF: capability устанавливается widget origin как HttpOnly Secure cookie с явно проверенными SameSite/CORS настройками, а JavaScript и parent не получают секрет. Поддержка third-party cookies и политика браузеров должны быть проверены на реальном прототипе. Если такая модель недоступна, виджет ограничивается публичным read-only каталогом, а не получает обходной токен в сообщении.

Создание session не является анонимным неограниченным endpoint: Web использует предвыданный bootstrap cookie, Telegram — adapter bearer и сопоставленную личную chat identity. Web-principal не может сам объявить себя Telegram-аккаунтом. Все session endpoints сверяют principal с владельцем session. Для непривилегированного запроса чужая session неотличима от несуществующей там, где это позволяет поток. Логи содержат opaque correlation IDs, но не access tokens, содержимое чувствительных cookies или полные персональные payloads.

## 7. Telegram-адаптер

### 7.1. Основной поток

```text
message/command
  → authenticate Telegram adapter → map external chat identity к отдельной session
  → draft SessionPatch (LLM необязателен)
  → backend validates/applies → SessionSnapshot
  → search preview → compact summary + server-issued action tokens

callback_query
  → сразу acknowledgement (без ожидания поиска/плана)
  → resolve token server-side
  → проверить chat/session/message/action/revisions/expiry/allowlist
  → выполнить read action или запросить/подтвердить разрешённую session mutation
  → edit при успехе; при edit failure отправить новое сообщение
```

Acknowledgement не означает, что действие принято. Toast/ответ подтверждает получение callback; итог операции показывается отдельным актуальным сообщением.

MVP поддерживает только личные чаты: внешняя Telegram identity привязывается к отдельной сессии этого чата. Групповой update не получает доступ к личной session и не создаёт shared plan автоматически; адаптер безопасно объясняет, что группы пока не поддерживаются. Если группы появятся в требованиях, нужна отдельная явная модель shared session, видимости и прав участников.

### 7.2. Opaque action token

`callback_data` содержит только короткий opaque token. Серверная запись включает:

- session и channel identity;
- action type;
- message/keyboard generation;
- session/result/plan/preview revision, необходимые для действия;
- собственный allowlist occurrence IDs;
- expiry и, для мутаций, одноразовость/idempotency binding.

Token не содержит сериализованный план, произвольный URL, токен доступа, LLM instructions или доверенный occurrence ID. Неизвестный, чужой, просроченный или уже поглощённый token не вызывает мутацию.

Даже корректный token не заменяет повторную серверную авторизацию и revision check. Для accept сохраняется явное пользовательское намерение и idempotency record.

### 7.3. Stale, повторы и ошибки edit

| Ситуация | Обязательное поведение |
|---|---|
| Условия изменились после появления клавиатуры | acknowledge; «кнопка устарела»; свежая клавиатура; старое действие не применяется |
| Повтор callback при сетевом retry | acknowledge; идемпотентный результат, без второго accept/patch |
| Чужой/подделанный token | безопасный отказ; никаких чужих ID/revisions |
| Сообщение удалено или edit недоступен | отправить новое сообщение с актуальным состоянием |
| Поиск занимает время | acknowledgement не ждёт зависимость; loading и последующий результат связаны revision |
| Поздний результат поиска | не заменяет более новую выдачу и не меняет текущую клавиатуру |
| LLM недоступна | команда/structured поля продолжают работать; условия сохранены |

Не предполагается, что порядок сетевых вызовов совпадает с порядком нажатий. Состояние определяется revisions на сервере, а не номером сообщения в клиенте.

### 7.4. Текстовые эквиваленты и границы MVP

Каждое действие клавиатуры имеет текстовый эквивалент: обновить, изменить условие, открыть вариант, сравнить 2–3 номера текущей выдачи, построить план, принять/отклонить конкретный preview, перепроверить. Номер в команде разрешается только внутри актуального server allowlist.

Нет кнопок «Купить» и «Забронировать». Нет обещания фоновых уведомлений до отдельной реализации и проверки. Mini App остаётся отложенной опцией: её отсутствие не ломает бот и не является ошибкой MVP.

## 8. Встраиваемый read-only виджет

### 8.1. Изоляция

Виджет размещается на отдельном origin от основного приложения и админки. Host embed получает только минимальный iframe sandbox; same-origin комбинация `allow-scripts + allow-same-origin` не используется как мнимая изоляция.

HTTP-заголовок widget ответа:

```text
Content-Security-Policy: frame-ancestors {exact_allowlist_of_host_origins}
```

API и админка, которые не должны встраиваться:

```text
Content-Security-Policy: frame-ancestors 'none'
X-Frame-Options: DENY
```

`X-Frame-Options` здесь defence-in-depth для совместимости, а `frame-ancestors` — основной современный механизм. Ни один заголовок не авторизует действие.

### 8.2. Граница MVP виджета

MVP-виджет — серверно сформированная read-only подборка публичных `Occurrence`: widget BFF получает не секретную embed-конфигурацию с уже выбранными public occurrence IDs, проверяет их и читает только публичный каталог. Он не вызывает session patch/accept/reject и не создаёт пользовательский план. Интерактивный поиск и фильтры внутри iframe не входят в текущий минимальный контракт; если они понадобятся, для них добавляется отдельный public GET search contract, а не скрытая session mutation через `postMessage`.

«Ранее выданная widget-выдача» — список occurrence IDs, который widget BFF фактически отрендерил в конкретный экземпляр iframe. Сообщение `ready` передаёт этот публичный список parent в `payload.occurrence_ids`. Только после проверок origin/source/schema parent сохраняет его как allowlist для последующего `open_occurrence` того же `widget_instance_id`. Parent не придумывает список и не расширяет его по клиентскому сообщению; целевая read-only страница повторно проверяет существование и публичный статус ID.

### 8.3. Handshake и envelope

```text
parent                         iframe (другой origin)
  │ load iframe                   │
  │ ← ready(protocol, v1, occurrence_ids) │  фактическая публичная выдача BFF
  │ init(theme, locale) →         │  без token/session/admin credentials
  │ ← request_resize(height)      │
  │ ← open_occurrence(id)         │  только ID из ready того же instance
  │ parent строит доверенный URL  │
```

Envelope нормативно описан `contracts/widget_protocol.schema.json`:

```json
{
  "protocol": "afisha-curator-widget",
  "version": 1,
  "type": "open_occurrence",
  "message_id": "opaque-message-id",
  "widget_instance_id": "opaque-instance-id",
  "payload": {"occurrence_id": "opaque-occurrence-id"}
}
```

Это структурный пример протокола, а не реальное событие.

### 8.4. Проверки обеих сторон

При отправке parent использует точный `targetOrigin`, никогда `*`.

При получении каждая сторона:

1. проверяет `event.origin` точным сравнением со списком разрешённых origins;
2. проверяет `event.source` против ожидаемого `contentWindow`/parent;
3. проверяет protocol, version, type и полный JSON Schema envelope;
4. отклоняет дополнительные поля, неизвестный тип/версию и неверный payload без мутации;
5. для `open_occurrence` проверяет ID против ранее выданной widget-выдачи;
6. обрабатывает содержимое только как данные, без `eval`, HTML injection и выполнения кода.

Запрещены substring/`indexOf` и нестрогий `endsWith` для origin. Origin вида `trusted.example.attacker.invalid` не должен совпасть с `trusted.example`.

### 8.5. Действия и сообщения

Разрешены только:

- parent → widget: `init`, `ping`;
- widget → parent: `ready`, `request_resize`, `open_occurrence`, обезличенный `error`.

Не разрешены `acceptPlan`, patch, purchase, booking, merge/split, telemetry, произвольный URL, top navigation, session/admin tokens или личные данные. Parent сам строит доверенный URL по разрешённому ID. Если внешняя навигация не входит в требования, открывается отдельная read-only страница основного Web, а не `window.top.location` по строке из сообщения.

`request_resize` содержит только ограниченную схемой высоту в CSS px. Parent ограничивает её разумными layout bounds и не позволяет сообщению выполнять код или менять навигацию. Это проектное ограничение, а не заявленный браузерный стандарт.

## 9. CORS, публичный каталог и кеширование

- Публичный `GET /v1/occurrences/{id}` может не требовать пользовательской session, но остаётся read-only и проходит общие доменные проверки.
- Публичность occurrence не включает его автоматически в result/plan/replacement allowlist.
- Для credentialed session/widget requests используется exact origin allowlist; wildcard с credentials запрещён.
- Разрешённые methods/headers указываются минимально; `Idempotency-Key` и revision headers, если появятся, добавляются явно.
- Ответы с пользовательским session state не кешируются как публичный каталог. Cache-Control и vary выбираются при реализации, чтобы не смешивать principal/host origin.
- 429 сопровождается `Retry-After`; клиентский backoff не превращается в повторную мутацию благодаря idempotency.
- CORS не мешает server-to-server запросу и не защищает endpoint: токен, scope, ownership и revisions всё равно проверяет backend.

## 10. Контрактные сценарии и воспроизводимость

`evals/channels/scenarios.jsonl` содержит 60 сценариев, по шесть в каждой категории:

| Prefix | Категория | Главный риск |
|---|---|---|
| INT | intake_revisions | Потеря неупомянутых условий, неправильный +1 revision |
| SRC | search_allowlists | Использование чужого/stale ID как текущего результата |
| PLN | planning | Невыполнимый план, >3 occurrence, смешение allowlists |
| CHG | plan_changes | Silent replacement, повторный accept, молчаливый возврат в `saved` после reject |
| TGR | telegram_callbacks | Молчащая кнопка, доверие callback, stale mutation |
| DLV | telegram_delivery | Гонки updates и неуспешный edit |
| WDG | widget_protocol | Wildcard/lookalike origin, arbitrary URL, write-verb |
| API | api_semantics | Неверный Problem Details, retry, revision/error semantics |
| XCH | cross_channel_identity | Магическая склейка аккаунтов, разные backend-правила |
| SEC | security_fallback | Prompt injection, секреты, отключение structured fallback |

Проверки из корня репозитория:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 evals/channels/validate.py --require-jsonschema --self-test
PYTHONDONTWRITEBYTECODE=1 python3 -S evals/channels/validate.py --self-test
```

Первая команда включает валидацию JSON Schema установленным пакетом; вторая доказывает stdlib-only fallback без импорта site-packages. Собственный validator проверяет структуру и проектные инварианты, но не называется официальным OpenAPI validator.

Negative self-tests намеренно повреждают копии fixtures и требуют отказа validator. Зелёный clean control без self-tests недостаточен: тест должен показать и способность обнаруживать ошибки.

### Что доказывает зелёный прогон

- файлы читаются, IDs уникальны, состав категорий полон;
- контролируемые инварианты не противоречат формату сценариев;
- callback/reject/stale/widget/error случаи имеют обязательные маркеры;
- OpenAPI и widget schema содержат ожидаемый minimal surface и запреты;
- validator распознаёт набор контролируемых повреждений.

### Что не доказывает

- что backend написан и соответствует контракту;
- что Telegram доставил updates в конкретном порядке;
- что реальный iframe безопасен во всех браузерах;
- что UI удобен или доступен;
- что API выдерживает нагрузку;
- что проведён security audit или тест на prompt injection реальной модели;
- что достигнуты какие-либо production-метрики.

## 11. Безопасность и секреты

Обязательные ограничения проекта сохраняются дословно:

- **«Не добавлять выдуманные мероприятия в основной каталог даже для демо.»**
- **«Факты о событиях получать только через разрешённые инструменты/API.»**
- **«Публичному ассистенту предпочтительны read-only инструменты.»**
- **«Права проверяются сервером, а не системным промптом.»**
- **«Секреты не передаются модели и не коммитятся.»**
- **«Внешние описания — недоверенные данные.»**
- **«Административный контур отделён от публичного ассистента.»**
- **«Любые будущие write-действия требуют подтверждения человека.»**
- **«В Git не попадают `.env`, токены, пароли, приватные ключи и дампы с персональными данными.»**

Дополнительно для каналов:

- Bot token и adapter bearer доступны только server-side secret store;
- секреты не передаются в URL, callback_data, postMessage, HTML, client bundle или LLM context;
- внешние title/description не вставляются как HTML и не становятся инструкциями;
- Telegram adapter и widget BFF не имеют прав административного контура;
- session/plan mutations ограничены конкретными операциями, не произвольным tool invocation;
- ошибки и логи не раскрывают stack trace, secrets и чужие state revisions;
- никакая защита не описывается как абсолютная защита от prompt injection.

## 12. Последовательность реализации после официального задания

1. Сверить обязательные каналы, доступные поля каталога, auth и критерии оценки.
2. Зафиксировать canonical Occurrence/Offer serialization и unknown/provenance semantics.
3. Реализовать session store с транзакционными expected revisions и idempotency registry.
4. Реализовать structured search и search preview; затем comparison и deterministic planner.
5. Добавить immutable saved plan, recheck reasons, replacement preview, accept/reject.
6. Подключить Web к тем же endpoints, не создавая побочную бизнес-логику.
7. Подключить Telegram adapter с fake transport contract tests, затем отдельно провести живой smoke test.
8. Подключить widget BFF и host demo на отдельных origins; выполнить браузерные origin/CSP/CORS tests.
9. Прогнать все 60 сценариев против реального transport/application adapter, не меняя ожидания под реализацию.
10. Только после замеров принимать решения о лимитах, кеше, фоновых уведомлениях, Mini App и production-хостинге.

## 13. Открытые вопросы, которые нельзя закрыть выдумкой

- Какие каналы обязательны по заданию и нужен ли Mini App?
- Какая модель аутентификации конечного пользователя допустима?
- Есть ли официальный способ связывания аккаунтов и действительно ли он нужен?
- Какие occurrence/offer/provenance/freshness поля предоставляет выданный API?
- Какие реальные лимиты и политика хранения данных потребуются?
- Поддерживает ли инфраструктура отдельные origins, HttpOnly cookie для widget BFF и нужные CSP?
- Какой объём фоновых recheck/уведомлений разрешён и полезен?
- Какие сроки preview, callback tokens и idempotency records подтверждены живыми нагрузочными тестами?

До ответов эти параметры остаются конфигурацией/гипотезой, а не обещанием пользователю.
