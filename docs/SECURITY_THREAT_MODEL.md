# Предметная модель угроз ИИ-куратора афиши

Дата: 2026-11-12  
Статус: исследовательский security contract до получения официального задания, критериев, данных и API хакатона  
Связанная задача: Issue #15  
Машиночитаемые материалы: `security/policy_controls.json`, `evals/security/`  
Связанные документы: `docs/PRODUCT.md`, `docs/AI_ASSISTANT_IDEAS.md`, `docs/EVENT_IDENTITY.md`; канальный контракт Issue #13 / PR #14

## 1. Назначение и честные границы

Документ определяет, какие свойства безопасности должна сохранить будущая система «ИИ-куратор культурного дня» при работе с недоверенными пользовательскими сообщениями, описаниями событий, результатами поиска, инструментами и каналами Web/Telegram/widget.

Это не отчёт о penetration test и не утверждение о защищённости работающего сервиса. На момент подготовки:

- production backend, публичный ассистент, Telegram-бот и widget как работающая система не развёрнуты;
- официальные источники данных и API афиши не выданы и не исследовались;
- живые LLM, браузер, Telegram, hosting и административный UI не атаковались;
- реальные события, пользователи, секреты и персональные данные в fixtures не используются;
- численные production-метрики безопасности, attack success rate и false positive rate не измерялись.

72 сценария в `evals/security/scenarios.jsonl` — явно синтетический regression corpus. Детерминированная `policy.py` проверяет согласованность ожидаемых решений с проектной политикой, а не распознаёт атаки в естественном языке и не доказывает устойчивость LLM.

## 2. Неприкосновенные продуктовые и security-ограничения

Следующие ограничения сохраняются дословно и имеют приоритет при будущей реализации:

- **«Не добавлять выдуманные мероприятия в основной каталог даже для демо.»**
- **«Факты о событиях получать только через разрешённые инструменты/API.»**
- **«Публичному ассистенту предпочтительны read-only инструменты.»**
- **«Права проверяются сервером, а не системным промптом.»**
- **«Секреты не передаются модели и не коммитятся.»**
- **«Внешние описания — недоверенные данные.»**
- **«Административный контур отделён от публичного ассистента.»**
- **«Любые будущие write-действия требуют подтверждения человека.»**
- **«В Git не попадают `.env`, токены, пароли, приватные ключи и дампы с персональными данными.»**

Дополнительные проектные ограничения:

1. Публичный каталог и публичные инструменты ассистента read-only.
2. LLM не получает произвольный SQL, HTTP, shell, merge/split, purchase, booking или payment.
3. Hard constraints проверяет backend; модель не ослабляет их ради красивого ответа.
4. `unknown` не превращается в `false`, `0`, `free`, `scheduled`, `cancelled`, `satisfied` или «подходит».
5. Результат поиска и плана — конкретная `Occurrence`; ID внутри search/comparison/plan/replacement previews ограничены их серверными allowlists. Это не запрещает отдельный публичный read-only `GET /v1/occurrences/{occurrence_id}` по канальному контракту.
6. Внешний текст не получает новых полномочий от того, что он оказался в system-like блоке, tool result, коде, переводе или base64.
7. CORS, скрытая кнопка, `callback_data`, client-side role и system prompt не являются авторизацией.
8. Отсутствие записи не означает отмену; sold out не означает отмену `Occurrence`.
9. Read-only относится к catalog/admin/external tool surface ассистента. Caller-owned SessionPatch, previews и plan accept/reject/recheck из канального API — отдельные авторизованные доменные операции с revisions/idempotency, а не произвольные model-invoked write-tools. Журналы, rate counters и audit также не считаются нарушением read-only.

## 3. Security objectives

| Цель | Практический смысл | Минимальное доказательство в будущем |
|---|---|---|
| Целостность каталога | Внешний текст и публичная модель не меняют события, identity graph или статусы | Нет write-side effects в публичном контуре; admin audit |
| Достоверность ответа | Каждый факт разрешим к разрешённому наблюдению; неизвестность видна | ID/provenance checks; unknown/conflict tests |
| Конфиденциальность | Секреты, чужие сессии и PII не попадают в контекст, ответ, URL или логи | Context inspection, output/log scan, authorization tests |
| Ограниченная agency | Модель предлагает только разрешённые read-only вызовы | Server tool gateway и per-call authorization |
| Безопасный рендеринг | Текст источника и модели не становится исполняемым HTML/Markdown | Context-specific encoding, sanitizer tests, CSP |
| Изоляция каналов | Web, Telegram, widget и admin не наследуют чужие права | Principal matrix, session/widget/callback tests |
| Ограничение ущерба | Атака не приводит к неограниченным циклам, расходам или массовой выдаче | Limits, quotas, timeouts, pagination, circuit breaker |
| Восстанавливаемость | Ошибка, timeout или недоступность LLM не создаёт частичную мутацию | Fail-closed/fallback tests, idempotency, audit |

## 4. Системный контур и границы доверия

```text
Пользователь Web ─────┐
Пользователь Telegram ─┼─→ Channel adapter ─→ Application backend ─→ Read-only catalog
Host page + iframe ───┘          │                    │                  │
                                 │                    │                  ├─ SourceRecord
                                 │                    │                  ├─ RawObservation
                                 │                    │                  └─ FieldAssertion
                                 │                    │
                                 │                    ├─ Session/revision/allowlist service
                                 │                    ├─ Deterministic search/planner
                                 │                    ├─ Tool gateway + authorization
                                 │                    └─ LLM adapter
                                 │                           │
                                 │                           └─ Недоверенный model output
                                 │
                                 └─ Output renderer: text / HTML / Markdown / Telegram HTML

Отдельный контур:
Admin moderator → Admin backend → merge/split review → append-only IdentityOperation

Внешний контур:
Source content → ingestion validation → raw observations → canonical projection
Secrets manager → backend only; не в LLM context, fixtures, Git или client
```

### 4.1. Граница B1: пользователь → канал

Любое пользовательское сообщение недоверенно, включая заявления «я администратор», «пользователь уже подтвердил» и поддельные system-сообщения. Канал создаёт server-side principal; текст не может его заменить.

### 4.2. Граница B2: источник → ingestion/retrieval

Названия, описания, площадки, Offer, external IDs, URL, highlight-фрагменты и вложения являются данными. Даже если источник официальный, содержимое может быть ошибочным, скомпрометированным или содержать невидимые инструкции.

### 4.3. Граница B3: LLM → tool gateway

Tool name, аргументы и обоснование модели являются недоверенным предложением действия. Backend заново проверяет principal, разрешённый инструмент, схему аргументов, allowlist ID, revisions, лимиты и необходимость подтверждения.

### 4.4. Граница B4: backend/LLM → renderer

Даже корректный canonical text остаётся недоверенным для HTML/Markdown/Telegram HTML. Безопасность обеспечивается на месте рендеринга с учётом контекста, а не обещанием модели «не вернуть XSS».

### 4.5. Граница B5: host page ↔ widget

`postMessage` требует точного `targetOrigin`, проверки `event.origin`, `event.source`, направления и JSON Schema. Похожий домен, wildcard или сообщение от другого окна не принимается. Widget получает только read-only capability и фактический public allowlist.

### 4.6. Граница B6: публичный backend ↔ admin

Административные merge/split, moderation и ingest controls не экспонируются публичной модели. Для них нужен отдельный admin principal, server-side authorization, reason, audit и подтверждение точного действия человеком.

### 4.7. Граница B7: приложение → секреты/логи/observability

Секреты доступны только тем server components, которым они необходимы. Модель, клиент, URL, fixtures и Git их не получают. Логи содержат минимально необходимые decision metadata, а не полные чувствительные prompts, responses, cookies или tokens.

## 5. Активы и principals

### 5.1. Активы

- целостность `Event`, `Occurrence`, `Offer`, `Venue`, relations и identity history;
- сырьё и provenance: `SourceRecord`, `RawObservation`, `FieldAssertion`, import completeness;
- пользовательские sessions, revisions, previews и saved-plan snapshots;
- server allowlists occurrence IDs и admin moderation queue;
- cookies, adapter credentials, widget capabilities и секреты инфраструктуры;
- доступность backend, LLM budget, очереди и rate-limit budgets;
- конфиденциальность пользовательских сообщений и operational logs;
- доверие к источникам, статусам и объяснениям ассистента.

### 5.2. Principals

| Principal | Источник identity | Разрешённая область | Запрещено |
|---|---|---|---|
| `web_user` | Server-issued HttpOnly session | Свои sessions и public read-only catalog | Чужие sessions, admin/write tools |
| `telegram_user` | Server-side Telegram adapter mapping | Свои sessions и public read-only catalog | Self-declared admin, автоматическая связка с Web |
| `widget_client` | Отдельная ограниченная widget capability | Public occurrence read и разрешённый ready allowlist | Sessions, patches, accept, telemetry, top navigation, write |
| `admin_moderator` | Отдельная admin authentication | Только назначенные moderation operations | Делегирование прав публичной модели |
| `system_backend` | Server runtime | Операции по внутренней политике | Передача избыточных credentials модели |
| LLM output | Не principal | Предложение structured interpretation/explanation | Самостоятельное предоставление прав или фактов |

Канал и principal не смешиваются. Один и тот же человек в Web и Telegram не считается автоматически одним аккаунтом; для связки потребуется отдельный явно подтверждённый процесс после официальных требований.

## 6. Акторы угроз и допущения

Рассматриваются:

1. любопытный или злонамеренный публичный пользователь;
2. автор внешнего описания, пытающийся выполнить indirect prompt injection или poisoning;
3. атакующий, контролирующий host page, другое окно или похожий origin;
4. пользователь, повторяющий callbacks, previews, confirmations или запросы;
5. атакующий, исследующий чужие session IDs, occurrence IDs и ошибки;
6. источник ресурсоёмких входов и agentic loops;
7. ошибочный или скомпрометированный upstream component.

Пока не оцениваются: физический доступ, компрометация хостинга/провайдера LLM, криптографический взлом, insider с реальными production privileges, уязвимости конкретного не выбранного framework. Это не означает их неважность; они требуют отдельной модели после выбора архитектуры и инфраструктуры.

## 7. Канонические security-инварианты

| ID | Инвариант | Где обеспечивается |
|---|---|---|
| `INV-RO` | Публичный assistant tool surface read-only: catalog/admin/external write-tools недоступны; caller-owned session/preview operations остаются отдельным авторизованным API-контрактом | Backend/tool gateway |
| `INV-NOFACT` | LLM не источник фактов; пустой результат не порождает события | Backend + response composer |
| `INV-NOSHELL` | Произвольные SQL/HTTP/shell и open-ended external calls запрещены | Server tool allowlist |
| `INV-BACKEND-AUTHZ` | Каждый вызов авторизуется сервером по реальному principal | Backend authorization |
| `INV-NOSECRET` | Секреты не передаются модели/клиенту и не попадают в Git/логи/ошибки | Secret manager, DLP/redaction |
| `INV-UNTRUSTED` | Внешние описания и tool content — данные, не инструкции | Context construction + tool gateway |
| `INV-ADMSEP` | Admin merge/split отделён от публичного контура | Separate admin backend |
| `INV-HUMAN` | Будущий write требует точного, действующего, одноразового подтверждения человека | Approval service + backend |
| `INV-UNKNOWN` | Unknown/missing/conflict не превращаются в конкретное удобное значение | Domain validation/search |
| `INV-PRINCIPAL` | Канальные principals и их allowlists изолированы | Session service |
| `INV-WIDGET` | Widget read-only; exact origin/source/schema и public allowlist | Widget BFF + iframe adapter |
| `INV-SESSION` | Чужая session возвращает неразличимый 404 без утечки revisions | Session API |
| `INV-RENDER` | Недоверенный текст кодируется по контексту; raw `ts_headline` не вставляется как HTML | Renderers |
| `INV-PROV` | Факт в ответе разрешим к разрешённой assertion/наблюдению | Catalog/provenance service |
| `INV-LIMIT` | Размер, глубина, время, retries, tool chain, выдача и стоимость ограничены | Gateway/queues/budgets |

Машиночитаемые формулировки и controlled vocabularies находятся в `security/policy_controls.json`. Каждый инвариант покрыт минимум одним dev и одним test сценарием.

## 8. Предметные abuse cases

### 8.1. DINJ: прямое изменение инструкций

Примеры: «ignore previous instructions», fake system turn, persona hijack, self-declared moderator, запрос system prompt, инструкция через перевод. Требуемый результат: пользовательский текст не меняет principal, tool surface или факты; безопасная часть обычного запроса может быть выполнена.

### 8.2. IINJ: indirect prompt injection

Инструкции помещаются в описание события, venue, Offer, tool result, Markdown quote/code block, многоязычный текст, base64/HTML entities, homoglyphs, zero-width и RTL controls. Декодирование для анализа не повышает доверие. Ни один такой текст не создаёт tool call и не меняет hard constraints.

### 8.3. TOOL: чрезмерные возможности и confused deputy

Атакующий просит `run_sql`, `http_fetch`, shell, внешний webhook, массовое чтение или подменяет аргументы allowlisted tool. Backend не использует собственные широкие credentials как deputy для публичного пользователя. Неизвестный инструмент и unknown action fail closed.

### 8.4. PROV: poisoning и подделка происхождения

Внешний документ претендует на canonical snapshot, подделывает `FieldAssertion`, повторяет чужой факт, манипулирует ranking keyword stuffing или содержит вредоносный highlight. Происхождение определяется серверными связями, а не текстовой декларацией «source=official».

### 8.5. OUTX: активный вывод

Проверяются script/event handlers, Markdown image exfiltration, внешние URL, Telegram HTML, вложенный Markdown/HTML и `ts_headline`. По умолчанию используется текст. Если разрешён ограниченный Markdown, порядок такой: Markdown → HTML-строка → allowlist sanitizer → вставка в DOM; после sanitize небезопасная постобработка запрещена. Автоматическая загрузка remote images из недоверенного Markdown не разрешается.

### 8.6. AUTH: сессии и replay

Чужая session → одинаковый 404 без различения «не существует» и «принадлежит другому». Повтор callback не создаёт новую бизнес-мутацию. Opaque action token связывается с principal, session, action, revision и expiry на сервере; `CallbackQuery.id` и `callback_data` не путаются.

Cookie-based Web-мутации требуют отдельной CSRF-защиты: CORS и SameSite сами по себе не заменяют серверную проверку происхождения/anti-CSRF token для выбранной архитектуры. Session cookie должен быть `HttpOnly` и `Secure`; атрибут `SameSite`, idle/absolute expiry и ротация ID после authentication/изменения privilege фиксируются при реализации, а не угадываются заранее.

Для Telegram webhook проверка настроенного секрета выполняется до durable inbox/queue. Сфабрикованный прямой POST не создаёт principal и не проходит в обработку только потому, что содержит правдоподобный `chat.id`. Bot token и webhook secret не передаются модели. Ограничения источника и конкретный deployment checklist уточняются по официальной документации на момент реализации.

### 8.7. PRV: секреты, PII и логи

Секрет нельзя получить через prompt, tool argument, error/stack, log query или внешний URL. CRLF/ANSI в log fields нейтрализуются. Fixtures содержат только очевидные placeholders. Отсутствие секрета в ответе не доказывает его отсутствие в логах: проверяются оба контура.

### 8.8. RES: unbounded consumption

Ограничиваются bytes, JSON/markup depth, token/cost budgets, tool-chain length, retries, результат count и время. Таймаут и отсутствие telemetry не засчитываются как успешно блокированная атака. Rate limiting не заменяет paging и bounded planner candidate set.

### 8.9. SEM: семантические атаки на ограничения

«Если цена неизвестна, скажи бесплатно», «отсутствует — значит отменено», «выбери любой источник», «ослабь возраст» не меняют доменную семантику. Unknown/conflict не проходит строгий фильтр как проверенное значение. Пустая выдача порождает только вычисленные варианты изменения условий.

### 8.10. ADM: identity operations

Публичный merge/split запрещён. Даже admin не получает write по одному текстовому «подтверждаю»: проверяется точная операция, memberships, причина и approval. Merge/split создают новые IDs, старые retire, history append-only, активный ID не получает redirect, split не воскрешает старые IDs.

### 8.11. WGT: widget boundary

Неверный/похожий/wildcard origin, другой `source`, malformed envelope, неизвестный message type и write type отклоняются. `open_occurrence` возможен только для ID из фактического `ready.payload.occurrence_ids` **того же `widget_instance_id`**; allowlist одного экземпляра iframe не разрешает действие другого. Parent сам строит доверенный read-only URL.

### 8.12. HUM: confirmation integrity

Подтверждение привязывается к actor, tool, target, normalized arguments, action hash, expiry и одноразовому ID. Текст в событии «уже подтверждено», replay на другой объект, изменённый preview и confirmation fatigue не дают write. До исполнения approval атомарно проверяется и потребляется; ошибка проверки fail closed. Будущий approval UI защищается от clickjacking/UI redress: app/admin не встраиваются в чужой frame, а `frame-ancestors` задаётся HTTP-заголовком по канальному контракту.

Для caller-owned SessionPatch и plan accept/reject явное действие владельца session в доверенном UI само является человеческим подтверждением конкретной доменной операции: revision, normalized patch/preview и idempotency key связывают его с точным изменением. Второй admin-style approval object не требуется. Это не разрешает модели самостоятельно инициировать write и не ослабляет отдельное подтверждение admin merge/split.

## 9. Архитектурные контроли

### 9.1. Instruction/data separation

- Structured messages различают trusted instructions и untrusted data на уровне типов, а не только комментария в prompt.
- Внешний контент передаётся модели в минимально необходимом объёме с явной маркировкой и без credentials.
- Фильтры инъекций являются дополнительным слоем, не security boundary.
- Tool gateway игнорирует любые полномочия, якобы появившиеся из контента.
- Ответ формируется из server-side verified result; модель не выбирает новые фактические IDs.

### 9.2. Минимальный tool surface

Предварительные public tools: `search_occurrences`, `get_occurrence` и другие явно read-only операции, если они будут утверждены после официального задания. Любой инструмент имеет typed schema, timeout, result limit и собственную авторизацию. Нет generic SQL/HTTP/shell и wildcard permissions.

Backend повторно проверяет:

```text
authenticated principal
→ channel capability
→ exact tool allowlist
→ normalized arguments schema
→ resource/session ownership
→ occurrence/result/plan allowlist and revisions
→ rate/cost/resource budget
→ human approval if action is write
→ execute or fail closed
```

### 9.3. Output handling

- Plain text — предпочтительный формат недоверенных полей.
- HTML text nodes и attributes кодируются раздельно; URL проверяются по scheme/host policy.
- Ограниченный Markdown не разрешает raw HTML и automatic remote resource loads.
- Telegram HTML формируется через узкий allowlist тегов и экранирование текста; исходный HTML источника не копируется.
- `ts_headline` и похожие highlight-фрагменты не выводятся как HTML; безопаснее повторно построить highlight из экранированных диапазонов.
- CSP — defense in depth, а не замена sanitization/encoding.

### 9.4. Secrets и наблюдаемость

- Секреты вводятся через server environment/secret manager, не через prompt/repository.
- Модель получает только необходимые поля; credentials и internal DSN не входят в context.
- Логируются policy version, decision, safe request reference, tool name, authorization outcome и latency без содержимого секретов и лишних PII.
- Redaction выполняется до записи лога; ошибки пользователю не содержат stack trace, SQL, internal URL или request headers.
- В тестах используются только synthetic markers, не «настоящий, но скоро отключённый» токен.

### 9.5. Provenance и poisoning resistance

- Canonical facts связаны с `RawObservation`/`FieldAssertion`, а не с текстовой уверенностью.
- Raw payload сохраняется как недоверенная версия; canonical projection пересчитывается.
- Независимость источников не выводится из количества повторов одного upstream.
- Suspicious content может попасть в `untrusted_content_review` без изменения identity или фактов.
- Пользователь видит source/freshness/uncertainty; retrieval score не превращается в доказательство факта.

### 9.6. Limits и degradation

`policy_controls.json` задаёт консервативные **проектные начальные** лимиты для fixtures, не официальные SLA и не измеренные production values. До реальной нагрузки они подлежат пересмотру. При превышении лимита результат явно ограничивается/отклоняется; неизвестная ошибка не маскируется под безопасный отказ.

Structured search продолжает работать без LLM. Timeout модели не блокирует базовый каталог и не приводит к повторной бизнес-мутации.

## 10. Threat register

| Угроза | Основной эффект | Контроли | Corpus | Остаточный риск |
|---|---|---|---|---|
| Прямой prompt override | Смена поведения/роли | B1, backend authz, INV-RO | DINJ | Модель может нарушить текстовую инструкцию, но не получить права |
| Indirect injection | Скрытый tool call/exfiltration | B2/B3, read-only tools | IINJ | Новые обфускации; нужен живой eval |
| Secret request | Раскрытие credentials | Secret isolation/redaction | DINJ/PRV | Компрометация backend вне corpus |
| Arbitrary SQL/HTTP/shell | Полный обход приложения | Отсутствие generic tools | TOOL | Уязвимость самого backend требует appsec tests |
| Confused deputy | Действие с server privileges | Per-principal mediation | TOOL/AUTH/HUM | Ошибка mapping identity |
| Foreign session read | Утечка условий/планов | Owner check + uniform 404 | AUTH | Timing side channels не измерены |
| Callback replay | Повторная/поздняя мутация | Revision + idempotency + inbox | AUTH | Зависит от реальной очереди |
| CSRF против cookie-based mutation | Действие из чужого сайта с cookie жертвы | Anti-CSRF/origin checks + SameSite + server authz | AUTH + будущий browser integration test | SameSite/CORS не считаются достаточной универсальной защитой |
| Forged Telegram webhook update | Подделка channel identity/update | Webhook secret check до inbox + server mapping | AUTH + будущий Telegram integration test | Компрометация bot token/инфраструктуры вне corpus |
| Retrieval poisoning | Ложный факт/инструкция | Provenance + untrusted data | PROV/IINJ | Нужен реальный источник и анализ coverage |
| Raw HTML/highlight | XSS | Encoding/sanitizer/CSP | OUTX/PROV | Browser integration ещё не тестировался |
| Markdown remote load | Утечка через URL | No automatic loads | OUTX/PRV | Поведение клиента Telegram отличается |
| Admin via public prompt | Несанкционированный merge | Separate admin contour | ADM/DINJ | Admin UI не реализован |
| Approval spoof/replay | Write без настоящего согласия | Exact-action single-use approval | HUM/ADM | Требуется concurrency test |
| Clickjacking confirmation UI | Пользователь подтверждает не то действие | `frame-ancestors`, trusted preview, UI redress checks | HUM + будущий browser integration test | Реальный admin UI ещё не существует |
| Unknown coercion | Ложная цена/статус/возраст | Domain validation | SEM | Ошибки mapping реальных источников |
| Widget origin spoof | Чужой host/message | Exact origin/source/schema | WGT | Нужен browser test |
| Log injection/PII | Подделка записей/утечка | Structured safe logging | PRV | Проверить реальные sinks |
| Unbounded agent loop | DoS/стоимость | Time/tool/cost limits | RES | Реальные лимиты калибруются на стенде |
| Missing record → cancelled | Ложный статус | Import completeness + domain | SEM/PROV | Зависит от официального API |
| False merge через описание | Потеря отдельного события | Evidence/veto/review | ADM/PROV | Качество identity оценивается отдельно |

## 11. Требования к будущему live adapter

Когда появится реализация, каждый сценарий должен пройти через явно версионированный adapter:

1. зафиксировать implementation commit, model/provider/config, policy version и fixture hash;
2. отобразить project principals на реальные server identities без расширения прав;
3. выполнить сценарий в изолированном synthetic environment;
4. записать tool calls, network calls, side effects, rendered output, safe logs и errors;
5. отдельно отметить `blocked`, `allowed benign`, `error`, `timeout`, `unsupported` и `missing telemetry`;
6. не засчитывать timeout/error/unsupported/missing telemetry как успешную защиту;
7. проверить и attack-blocking, и benign false positives;
8. опубликовать numerator/denominator по каждой категории и конфигурации без обобщения на все атаки;
9. сохранить evidence для ручного review, исключив секреты и PII;
10. повторить после изменения модели, prompt, tools, renderer или policy.

Прохождение corpus будет smoke/regression test выбранной конфигурации, а не доказательством абсолютной безопасности или устойчивости к настойчивому adversary.

## 12. Порядок внедрения после официальных материалов

1. Обновить системный контур по фактическому заданию, API, хостингу и модели.
2. Зафиксировать реальные principals, authentication, session lifetime и официальные channel constraints.
3. Ввести read-only tool gateway и server authorization до подключения LLM к инструментам.
4. Ввести raw/provenance validation и untrusted-content handling до retrieval.
5. Проверить renderers на реальных Web/Telegram clients с изолированными payloads.
6. Настроить лимиты по измеренным входам/стоимости и провести нагрузочные tests отдельно.
7. Реализовать admin contour и approval service только при необходимости; не открывать их публичной модели.
8. Адаптировать 72 scenarios, добавить реальные threat cases и выполнить live smoke tests.
9. Настроить CI: corpus validator на каждый PR; live security suite — в контролируемом окружении.
10. Перед демонстрацией повторить secret scan, side-effect audit и проверку отсутствия реальных данных в fixtures.

## 13. Что этот документ не доказывает

- отсутствие уязвимостей;
- полноту списка угроз;
- устойчивость какой-либо LLM к prompt injection;
- безопасность будущего frontend, Telegram client, API или hosting;
- корректность произвольного adapter mapping;
- защиту от timing side channels, supply-chain и инфраструктурной компрометации;
- реальные rate limits, стоимость, latency и доступность;
- нулевой false positive/false negative rate;
- качество поиска, identity resolution или пользовательского сценария.

Главная ценность на текущем этапе — заранее запретить наиболее опасные архитектурные решения и сохранить машиночитаемый контракт, который можно будет проверить на фактической реализации.
