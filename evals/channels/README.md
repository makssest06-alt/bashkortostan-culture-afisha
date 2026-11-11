# Contract evals: Web, Telegram, widget и публичный API

Статус: синтетические машиночитаемые fixtures для Issue #13. Это не production dataset и не живой integration test.

Связанные материалы:

- `docs/CHANNELS_API.md` — архитектура и HTTP/Telegram/widget-контракты;
- `docs/TELEGRAM_RESEARCH.md` — первичная сверка Telegram Bot API;
- `contracts/public_api.openapi.json` — OpenAPI 3.1.0;
- `contracts/widget_protocol.schema.json` — JSON Schema Draft 2020-12;
- `evals/channels/scenarios.jsonl` — 60 сценариев;
- `evals/channels/scenarios.schema.json` — схема набора;
- `evals/channels/validate.py` — stdlib-first validator и self-tests.

## 1. Что проверяется

Набор фиксирует поведение, которое позже можно перенести в application/transport tests:

- принятый `SessionPatch` увеличивает `session_revision` ровно один раз;
- поздние ответы и stale callback не откатывают более новое состояние;
- search, comparison/plan и replacement previews имеют разные allowlists;
- сохранённый план неизменяем, reject сохраняет `attention`;
- accept проверяет preview/base revisions, expiry, полный порядок IDs и slot mapping;
- Telegram callback получает acknowledgement, доставка дедуплицируется, edit failure восстанавливается новым сообщением;
- widget ограничен public read-only данными и проверяет origin/source/schema;
- ошибки API используют Problem Details, idempotency и безопасное сокрытие чужих ресурсов;
- LLM не нужен для structured search, внешние описания не исполняются как инструкции.

Во всех JSONL `given.backend = "synthetic_contract"`. IDs вида `occ_fixture_001` и плейсхолдеры не обозначают реальные мероприятия, площадки, источники, цены или пользователей.

## 2. Воспроизведение

Из корня репозитория:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 evals/channels/validate.py --require-jsonschema --self-test
PYTHONDONTWRITEBYTECODE=1 python3 -S evals/channels/validate.py --self-test
```

Первая команда требует установленный `jsonschema`, проверяет JSON Schema и все inline OpenAPI examples. Вторая запускается с `python3 -S`: site-packages не импортируются, поэтому проверяется stdlib fallback.

Validator также можно вызвать из `evals/channels/`: корень определяется от фактического пути к файлу, а не от текущей директории.

Коды выхода:

- `0` — чистый набор и запрошенные self-tests пройдены;
- `1` — контрактные/схемные ошибки или failed self-test;
- `2` — неверное использование, отсутствует файл или обязательный пакет.

Фактический результат на момент подготовки:

```text
OK: 60 scenarios; 10 categories × 6; 55 controlled invariants; 11 API operations; widget protocol v1
OK: JSON Schema and 112 inline OpenAPI examples validated
SELF-TEST OK: 46/46 checks passed (44 corruptions + malformed JSONL + clean control)
```

Stdlib-режим также завершился с `SELF-TEST OK: 46/46`; вместо строки о JSON Schema он сообщает, что внешняя schema/example validation пропущена. При этом структурные ограничения текущего fixture-формата и проектные семантические проверки выполняются и в stdlib-режиме. Полный режим остаётся обязательным для независимой проверки JSON Schema и всех inline OpenAPI examples.

Собственный validator **не является официальным OpenAPI validator**. Он проверяет ожидаемый project surface, локальные схемы, examples и доменные инварианты. Перед реализацией дополнительно нужны contract tests против реального приложения.

Дополнительно спецификация прошла независимый `openapi-spec-validator 0.9.0`. Эта версия не распознаёт официальный URI `https://spec.openapis.org/oas/3.1/dialect/2024-11-10`, поэтому только в памяти проверочного процесса поле `jsonSchemaDialect` было удалено; в артефакте оно сохранено. Сам OpenAPI-файл этим ограничением не «исправлялся». После этого независимый structural validation завершился успешно для всех 11 operations.

## 3. Формат scenario

Каждая строка — самостоятельный JSON object без комментариев и trailing commas.

```json
{
  "id": "INT-001",
  "category": "intake_revisions",
  "surface": "all",
  "given": {
    "session_revision": 4,
    "result_revision": 2,
    "plan_revision": null,
    "plan_state": "none",
    "data_state": "current",
    "backend": "synthetic_contract"
  },
  "trigger": "Accepted SessionPatch changes max_budget and leaves city/date unmentioned",
  "expected": {
    "action": "apply_patch",
    "http_status": 200,
    "state_effect": "session_updated",
    "callback_ack": "not_applicable",
    "visible": ["session_revision: 5"],
    "preserved": ["city", "date"],
    "invariants": ["session_patch_increments_revision"]
  },
  "forbidden": ["unmentioned_constraints_cleared"],
  "notes": "Synthetic contract expectation."
}
```

Пример сокращён; нормативные обязательные поля и enum находятся в `scenarios.schema.json`.

### 3.1. Поля

| Поле | Смысл |
|---|---|
| `id` | Стабильный `PREFIX-00N`, по шесть на prefix |
| `category` | Контролируемая категория, связана с prefix |
| `surface` | `web`, `telegram`, `widget`, `api` или `all` |
| `given` | Минимальный synthetic state перед триггером |
| `trigger` | Пользовательское действие, ответ зависимости или transport event |
| `expected.action` | Переносимое действие application/adapter |
| `expected.http_status` | HTTP status либо `null` для чистого UI/transport expectation |
| `expected.state_effect` | Допустимый эффект на состояние |
| `expected.callback_ack` | `not_applicable`, `required` или `sent` |
| `expected.visible` | Наблюдаемые машиночитаемые маркеры результата |
| `expected.preserved` | Что обязано сохраниться |
| `expected.invariants` | Controlled vocabulary из §5 |
| `forbidden` | Явно недопустимые эффекты/утверждения |
| `notes` | Зачем сценарий существует и как неправильно его реализовать |

### 3.2. Durable состояние, `draft` и `unknown`

`given` описывает durable snapshot: `plan_state=none` требует `plan_revision=null`; `saved` и `attention` требуют revision ≥ 1. Других durable состояний в fixture enum нет.

`draft` — **только UI projection активного непринятого plan preview**, поэтому он не допускается в `given.plan_state`. Непринятый preview обозначается действием `plan_preview`/`replacement_preview` и, при необходимости, наблюдаемым маркером `plan_preview: draft_projection`. Preview revision не следует путать с saved plan revision.

`data_state=partially_unknown` не превращает unknown в удовлетворённое ограничение. Каждый сценарий с `unknown_not_satisfied` обязан содержать точный маркер `forbidden`: `unknown_rendered_as: 0|false|free|scheduled|satisfied|verified|suitable` (одно значение). Проверка не использует substring matching, поэтому случайный `0` внутри другого ID не считается доказательством запрета. `stale` не означает удаление прежней выдачи: справочный просмотр возможен, новые compare/plan — нет.

## 4. Категории

| Prefix | Category | Покрытие |
|---|---|---|
| INT | `intake_revisions` | +1 на принятый patch, stale expected revision, clear→unknown, replay, repeated value, empty patch |
| SRC | `search_allowlists` | Search fingerprint, чужие IDs, stale response/details/compare, public ID без session authorization |
| PLN | `planning` | Compare 1/2/4, current result candidates, отдельный plan snapshot, unknown price |
| CHG | `plan_changes` | Recheck, replacement, accept, порядок/slots, expiry, reject→attention |
| TGR | `telegram_callbacks` | Ack, opaque token, stale/foreign/duplicate callback, явное подтверждение |
| DLV | `telegram_delivery` | Durable inbox, duplicate/out-of-order updates, edit recovery, render diff, 429 |
| WDG | `widget_protocol` | Ready allowlist, exact origin/source/schema, wildcard, lookalike, arbitrary URL/write |
| API | `api_semantics` | Replay, consumed preview, key conflict, principal namespace, Problem Details, 429 |
| XCH | `cross_channel_identity` | Общий backend, чтение только собственного snapshot, раздельные identity, группы, read-only widget handshake, fallback |
| SEC | `security_fallback` | Prompt injection, arbitrary tools, секреты, fallback, hard/soft, admin/write запрет |

## 5. Controlled invariants

Все 55 значений используются хотя бы в одном сценарии. Добавление нового значения требует одновременного изменения schema, validator, README и минимум одного содержательного сценария.

| Invariant | Обязательство |
|---|---|
| `no_fabricated_events` | Не создавать факты/мероприятия вне разрешённых backend-данных |
| `occurrence_specific` | Действие и факты относятся к конкретной Occurrence |
| `unknown_not_satisfied` | Unknown не равно false/0/free/scheduled/подходит |
| `hard_constraints_backend` | Жёсткие ограничения проверяет backend |
| `soft_ranking_only` | Soft preferences влияют только на ranking |
| `max_three_occurrences` | Comparison ограничен 2–3 Occurrence |
| `session_patch_increments_revision` | Каждый принятый новый patch увеличивает revision |
| `stale_response_discarded` | Поздний ответ не заменяет новую выдачу |
| `stale_results_read_only` | Stale выдача справочна, но не авторизует compare/plan |
| `result_allowlist_only` | Search actions ограничены текущим result allowlist |
| `plan_allowlist_only` | Plan preview использует собственный проверенный candidate snapshot |
| `replacement_allowlist_only` | Replacement candidates проверяются отдельно |
| `preview_revision_bound` | Действие привязано к конкретному preview revision |
| `plan_revision_bound` | Mutation привязана к ожидаемой base plan revision |
| `ordered_occurrence_ids_match` | Полный порядок IDs совпадает, не только set |
| `original_plan_retained` | Исходная saved revision остаётся доступной |
| `unaffected_plan_items_preserved` | Replacement не меняет незатронутые пункты |
| `user_confirms_plan_revision` | Новая plan revision создаётся только явным accept |
| `attention_until_valid_accept` | Reject/просмотр не снимают attention |
| `no_silent_hard_relaxation` | Hard constraints не ослабляются молча |
| `critical_constraints_not_relaxed` | Возрастные/критичные ограничения не предлагаются как обычное ослабление |
| `callback_acknowledged` | Каждый callback получает acknowledgement |
| `opaque_callback_token` | Callback содержит только opaque short action token |
| `stale_callback_no_mutation` | Старая кнопка не мутирует новую сессию |
| `edit_failure_new_message` | Ошибка edit восстанавливается новым сообщением |
| `text_equivalent` | Действие клавиатуры имеет текстовый эквивалент |
| `idempotent_retry` | Retry использует idempotency/operation record |
| `no_duplicate_effect` | Повтор доставки/запроса не создаёт второй эффект |
| `problem_details` | Ошибки оформлены как `application/problem+json` |
| `sanitized_error` | Ошибка не содержит внутренних implementation details |
| `retry_after_present` | 429 содержит Retry-After и корректный retry |
| `foreign_session_not_leaked` | Чужие session/revisions/keys не раскрываются |
| `no_account_auto_link` | Нет эвристической склейки Web/Telegram identity |
| `same_backend_contract` | Каналы разделяют backend-правила, а не обязательно session |
| `widget_origin_exact` | Origin проверяется точным allowlist-сравнением |
| `widget_source_checked` | Проверяется ожидаемый `event.source` |
| `widget_schema_validated` | Envelope/version/type/payload проходят схему |
| `no_wildcard_target_origin` | `targetOrigin: "*"` запрещён |
| `no_top_navigation` | Сообщение не управляет top-level navigation |
| `no_arbitrary_url` | Parent не принимает произвольный URL от widget |
| `widget_read_only` | Widget получает только public read-only возможности |
| `read_only` | Публичный контур не получает admin/произвольные write tools |
| `no_unrequested_write` | Нет write без явного подтверждения человека |
| `untrusted_content_not_executed` | Внешнее содержимое остаётся данными, не кодом/промптом |
| `no_sensitive_data` | Секреты/PII/stack traces не попадают в сообщения/логи |
| `llm_not_required_for_basic_search` | Structured search работает без LLM |
| `no_dead_controls` | Ошибка/fallback оставляет рабочий путь действий |
| `durable_inbox_before_ack` | Webhook 200 следует после durable commit |
| `duplicate_update_deduplicated` | Повтор update обрабатывается как дубликат |
| `ordered_update_not_trusted` | Порядок/update_id не заменяет domain revisions |
| `slot_mapping_match` | Accept сверяет точный slot→occurrence mapping |
| `preview_expiry_checked` | Expired preview отклоняется сервером |
| `immutable_saved_plan` | Saved snapshot не переписывается |
| `plan_recheck_no_snapshot_mutation` | Recheck добавляет reasons, но не меняет snapshot |
| `no_widget_session_mutation` | Widget не вызывает patch/accept/reject или скрытые session writes |

## 6. Action vocabulary

Все 27 actions используются хотя бы в одном сценарии; validator отклоняет набор, если какой-либо controlled action потерян.

| Action | Использование |
|---|---|
| `create_session` | Создание независимой session |
| `read_session` | Чтение собственного durable snapshot |
| `apply_patch` | Принятый SessionPatch |
| `reject_patch` | Отклонённый SessionPatch |
| `search_preview` | Построение search preview |
| `discard_stale_response` | Безопасное отбрасывание позднего ответа |
| `open_occurrence` | Read-only детали Occurrence |
| `comparison_preview` | Сравнение 2–3 Occurrence |
| `plan_preview` | Непринятый initial plan preview |
| `replacement_preview` | Непринятый replacement preview |
| `accept_plan` | Явный accept initial/replacement |
| `reject_replacement` | Reject с сохранением attention |
| `recheck_plan` | Перепроверка saved plan |
| `callback_acknowledge` | Ранний callback acknowledgement |
| `resolve_callback` | Server-side token resolution и действие |
| `recover_message` | Новое сообщение/отложенная доставка |
| `receive_webhook` | Durable webhook intake |
| `deduplicate_update` | Дедупликация delivery/business action |
| `widget_handshake` | Проверенный protocol handshake |
| `widget_reject` | Отказ widget message без мутации |
| `widget_open` | Открытие allowlisted public Occurrence |
| `api_replay` | Replay сохранённого успешного результата |
| `api_error` | Контролируемая ошибка API |
| `api_reject` | Отказ API без state diff |
| `channel_isolate` | Изоляция identity/session/channel |
| `structured_fallback` | Детерминированный fallback без LLM |
| `refuse_action` | Безопасный отказ с рабочей альтернативой |

## 7. Проверки OpenAPI и widget

Validator проверяет:

- структуру каждого fixture также в stdlib-режиме: точные ключи, типы без bool-as-int, диапазоны revisions/status, непустые строки, уникальность элементов и непустой controlled invariant list;
- callback acknowledgement по стабильному набору callback-сценариев, а не по слову в свободном `trigger`;
- связку действия, HTTP status и state effect: успешные действия — 2xx/`null`, API-отказы — обязательные конкретные 4xx/5xx, transport/UI-отказы могут использовать `null`; rejected action не может заявить durable/recovery mutation, а успешное действие — `state_effect=rejected`; `recover_message` допускает только 2xx/429/`null` и только `message_recovered`/`none`, не durable session/plan mutation;
- точный `Retry-After`/`retry_after` marker для 429 и точный `unknown_rendered_as` marker для unknown;
- точные 11 path/method operations и уникальные `operationId`;
- отсутствие admin/chat/purchase/booking/payment/account-link/merge/split surface;
- required `Idempotency-Key` и requestBody на каждом POST;
- `application/problem+json` для errors, совпадение example `Problem.status` с HTTP status;
- 422 `Unprocessable Content`, отсутствие 412, required `Retry-After` на 429;
- `WidgetCapability` только на public occurrence GET;
- comparison `minItems=2`, `maxItems=3`;
- полный ordered accept payload и durable plan enum;
- strict `additionalProperties: false` в component schemas;
- widget protocol/version/types, strict payloads и `ready.occurrence_ids`;
- отсутствие widget write types, arbitrary URL и secret/session fields.

В полном режиме `jsonschema` дополнительно проверяет schema sanity и 112 inline examples. Это не заменяет будущие authorization, concurrency и transport tests.

## 8. Negative self-tests

`--self-test` выполняет 46 проверок:

1. clean control обязан пройти;
2. malformed JSONL обязан быть отклонён;
3–46. 44 независимых controlled corruptions обязаны быть обнаружены:

- duplicate scenario ID;
- wrong category/count;
- `none` с plan revision;
- `attention` без revision;
- callback без acknowledgement;
- callback без visible acknowledgement;
- callback с переформулированным `trigger`, скрывшим acknowledgement;
- reject→`plan_saved`;
- потеря `attention_until_valid_accept`;
- неизвестный invariant;
- пустой invariant list;
- stale response с mutation;
- lookalike-маркер вместо точного запрета conversion unknown;
- rejected patch с HTTP 200;
- accepted patch с HTTP 409;
- accepted patch без state update;
- разрешённый wildcard targetOrigin;
- valid widget open без source check;
- 429 без retry metadata;
- 429 с ложным `retry: never` вместо `Retry-After`;
- foreign session с HTTP 200;
- `draft`, подменяющий durable `given.plan_state`;
- duplicate visible marker;
- лишний ключ в `given`;
- пустой `trigger`;
- HTTP status вне 100–599;
- строковый HTTP status;
- boolean вместо integer `session_revision`;
- нестроковый `plan_state`, который не должен ронять validator;
- API rejection без конкретного HTTP status;
- rejected API action с выдуманным durable mutation;
- успешное действие с `state_effect=rejected`;
- `recover_message` с недопустимым HTTP 500;
- `recover_message` с выдуманной durable session mutation;
- нелокальный `$ref` у OpenAPI parameter без traceback;
- не-объектный OpenAPI parameter без traceback;
- не-объектный widget `$defs.ready` без traceback;
- comparison с четырьмя элементами;
- POST без Idempotency-Key;
- запрещённый admin path;
- Problem status mismatch;
- WidgetCapability на plan accept;
- widget `acceptPlan` type;
- widget ready без occurrence allowlist.

Self-tests работают на копиях в памяти, не перезаписывают fixtures и не создают временные файлы. Успешный clean control и пойманные повреждения обязательны: одного зелёного прогона основного набора недостаточно.

## 9. Границы и следующий этап

Зелёный прогон не доказывает:

- существование backend, Telegram-бота, виджета или host-страницы;
- реальную доставку, ordering, exactly-once или latency Telegram;
- браузерную изоляцию iframe/CSP/CORS;
- usability, accessibility или внешний вид UI;
- отсутствие уязвимостей и устойчивость к prompt injection реальной модели;
- нагрузочные характеристики и production SLO;
- качество поиска, планирования или фактическую полноту каталога.

При появлении реализации каждый scenario должен быть связан с исполняемым test case:

1. application tests — transactions, revisions, allowlists, immutable plan, idempotency;
2. fake Telegram transport — durable inbox, callback acknowledgement, duplicate/out-of-order, edit recovery;
3. живой Telegram smoke — отдельный тестовый бот, без production credentials в Git;
4. browser integration — два origins, CSP/frame-ancestors, exact postMessage checks, CORS;
5. security tests — ownership, scope, untrusted content, log redaction;
6. usability/accessibility — отдельные методы и честные измерения, а не вывод из JSONL.

Нельзя менять expected под уже написанную реализацию без объяснения, какой инвариант и почему изменился.
