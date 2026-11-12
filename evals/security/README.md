# Synthetic Security Adversarial Fixtures

Этот каталог реализует машиночитаемую часть Issue #15 и дополняет [`docs/SECURITY_THREAT_MODEL.md`](../../docs/SECURITY_THREAT_MODEL.md) и [`docs/SECURITY_RESEARCH.md`](../../docs/SECURITY_RESEARCH.md).

Все сценарии синтетические. Они не содержат реальных мероприятий, пользователей, персональных данных или credentials и не добавляют ничего в основной каталог. Это research contract и regression suite для будущей реализации, **не выполненный penetration test и не security benchmark работающей системы**.

## Состав

- `scenarios.jsonl` — 72 сценария: 12 категорий по 6, 36 dev и 36 test;
- `scenarios.schema.json` — JSON Schema Draft 2020-12 для одной JSONL-строки;
- `policy.py` — детерминированный conservative reference oracle над structured context;
- `validate.py` — structural/semantic validation, policy↔expected checks и negative self-tests;
- `../../security/policy_controls.json` — канонические инварианты, principals, tool surface и проектные fixture limits.

## Запуск

Из корня репозитория:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 evals/security/validate.py --require-jsonschema --self-test
PYTHONDONTWRITEBYTECODE=1 python3 -S evals/security/validate.py --self-test
```

Первая команда требует установленный `jsonschema` и дополнительно выполняет полную JSON Schema validation. Вторая намеренно запускается с `python3 -S`: сторонние пакеты не импортируются, поэтому проверяется самостоятельный stdlib-режим.

`--require-jsonschema` запрещает молчаливый пропуск внешней схемной проверки. Exit code `0` означает успешную проверку fixtures и reference policy; ненулевой код означает validation error или невозможность загрузить контракт. Повреждённые входы должны давать управляемую диагностику, а не traceback.

## Матрица сценариев

| Категория | Предметные случаи |
|---|---|
| `DINJ` | Прямой override, fake system/persona/admin, system-prompt и secret probes, benign control |
| `IINJ` | Инъекции в описаниях и tool/retrieval content, nesting, multilingual, base64, homoglyph/zero-width |
| `TOOL` | Tool allowlist, arbitrary SQL/HTTP/shell, argument smuggling, confused deputy, параметризованный поиск |
| `PROV` | Provenance spoof, retrieval poisoning, fabricated assertions, ranking/highlight manipulation |
| `OUTX` | HTML/Markdown/Telegram HTML, remote loads, `ts_headline`, context-aware escaping |
| `AUTH` | Foreign/missing sessions, principal spoofing, replay, CSRF и forged Telegram webhook |
| `PRV` | Секреты, PII, external exfiltration, error/log disclosure, CRLF/ANSI log injection |
| `RES` | Input bytes/depth/results/tool loops/rate limits и допустимые bounded controls |
| `SEM` | Unknown/missing/conflicting facts, запрет free/zero/scheduled/cancelled/satisfied coercion |
| `ADM` | Публичный merge/split запрещён; отдельный admin contour, new-ID и append-only identity history |
| `WGT` | Exact origin/source/schema, instance-bound ready allowlist, `open_occurrence` только для ID из `ready.payload.occurrence_ids` того же `widget_instance_id`, read-only messages |
| `HUM` | Exact-action approval, replay/expiry/mismatch/quoted confirmation, fatigue и UI redress |

В каждой категории 3 dev и 3 test сценария. Family полностью принадлежит одному split. Corpus содержит и attacks, и явно маркированные benign positive controls: защита не должна превращаться в блокировку любого обычного запроса.

`fixture_kind` принимает только:

- `synthetic_attack_fixture`;
- `synthetic_control_fixture`.

Внешние URL встречаются только как недоверенные строки и используют reserved `.invalid`. Секреты обозначены очевидными placeholders, а не реальными или временно действующими tokens.

## Формат сценария

Точный закрытый формат находится в `scenarios.schema.json`. Верхний уровень содержит:

```text
id, category, split, family, title, severity,
channel, principal, fixture_kind,
input, attack_features, context, expected, notes
```

`input` хранит текст и тип недоверенного источника. `attack_features` — controlled vocabulary, а не свободные labels. `context` содержит только структурированные условия, необходимые reference policy: действие, инструмент и аргументы, session/widget/approval/fact/render/resource/provenance properties.

`expected` фиксирует:

- `decision`;
- `tool_effect`;
- `http_status`, если проектный контракт его определяет, иначе `null`;
- обязательные `invariants`;
- `effects.must` и `effects.must_not` из закрытого словаря.

Validator проверяет точные ключи и типы также без `jsonschema`, включая JSON Schema integer semantics: `true` не считается integer. Пустые строки/lists, duplicate IDs/items, extra keys, family leakage и неизвестные vocabulary values отклоняются. Для `open_occurrence` обязательность occurrence ID, непустого unique ready-allowlist и обоих instance IDs закреплена как conditional `allOf/if/then` непосредственно в JSON Schema и продублирована stdlib-проверкой.

## Reference policy — что это и чего не является

`policy.py` вычисляет ожидаемое решение из structured `context`, `attack_features` и `policy_controls.json`, не читая `scenario.expected`. Validator затем сравнивает вычисленный результат с зафиксированным ожиданием.

Это позволяет обнаружить, например:

- public admin/write попытку, ошибочно признанную разрешённой;
- foreign session с 200/403 вместо неразличимого 404;
- rejected action, который одновременно заявляет write effect;
- unknown, превращённый в `free`, `0`, `scheduled` или другое конкретное значение;
- raw `ts_headline`/markup или automatic remote load;
- quoted/replayed/expired/mismatched confirmation, принятое как валидное;
- wildcard/lookalike origin, чужой source или allowlist другого widget instance;
- превышение input/depth/results/tool/rate limit без ограничения;
- merge со survivor среди входных IDs вместо new-ID append-only операции;
- missing provenance или secret/error/log disclosure.

Oracle не выполняет NLP, не декодирует атаки и не оценивает LLM. Он проверяет согласованность размеченного security contract. Совпадение policy и expected может означать лишь то, что оба отражают одну политику; поэтому дополнительно нужны negative self-tests, независимое review и будущий live adapter.

## Self-tests

`--self-test` сначала требует валидный clean control, затем применяет контролируемые mutations только к in-memory copies. Проверяются как обнаружение повреждений, так и отсутствие traceback. Исходные файлы self-test не изменяет.

Mutations охватывают structural errors, vocabulary escape, policy bypass и попытки скрыть атаку переименованием/lookalike marker. Фактический итог текущей версии: `SELF-TEST OK: 69/69 checks passed` — clean control, malformed JSONL/JSON controls/schema (управляемая ошибка без traceback), behavioral proof, что policy не читает `expected`, positive case «invalid CSRF metadata на read-only search не блокирует вызов», и 63 targeted corruptions, включая reworded trigger, lookalike marker, null/200/403 status на foreign session, unknown→free, raw `ts_headline`, quoted/replayed/expired/fatigued/clickjacked confirmation, wildcard/lookalike origin, widget write verb, foreign occurrence вне ready allowlist и missing instance binding (изолированно), forbidden tool в allowlist, public admin claim, missing no-secret effect, bool-as-int, duplicate IDs, family leakage, extra keys, empty lists, over-limit accept, missing provenance, CSRF-less cookie mutation, forged webhook, а также null/empty `base_revision`/`idempotency_key`, stale revision mismatch и missing `current_revision` для session-domain mutation. Успешный результат не заменяет review самого validator.

## Что validator не доказывает

- защищённость любой реализации или инфраструктуры;
- устойчивость конкретной LLM к direct/indirect prompt injection;
- полноту покрытия атак и отсутствие неизвестных уязвимостей;
- корректность будущего adapter mapping;
- реальные browser/Telegram/session security properties;
- отсутствие timing side channels, supply-chain и hosting compromise;
- нулевой attack success, false positive или false negative rate;
- production latency, стоимость, quotas и доступность;
- качество поиска, identity resolution или реального пользовательского сценария.

Лимиты в `policy_controls.json` — консервативные проектные defaults для fixtures, не официальные требования и не измеренные значения.

## Будущий live adapter

После появления реализации adapter должен версионировать mapping principals/channels/tools и фиксировать implementation commit, model/configuration, policy version и fixture hashes. Для каждого случая необходимо записывать tool/network calls, side effects, rendered output, safe logs и errors.

`blocked`, `allowed benign`, `error`, `timeout`, `unsupported` и `missing telemetry` отчитываются раздельно. Errors/timeouts/unsupported/missing telemetry нельзя засчитывать как успешно блокированные атаки. Результаты публикуются с numerator/denominator по конфигурации и категории; прохождение corpus называется smoke/regression test, а не доказательством абсолютной безопасности.
