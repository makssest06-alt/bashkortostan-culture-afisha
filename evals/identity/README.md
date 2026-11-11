# Synthetic Event Identity Fixtures

Этот каталог проверяет контракт канонической идентичности и дедупликации, описанный в [`docs/EVENT_IDENTITY.md`](../../docs/EVENT_IDENTITY.md). Все записи синтетические. Они не являются реальными мероприятиями Башкортостана, не попадают в основной каталог и не используются для заявления production precision/recall.

## Состав

- `pairs.jsonl` — 36 dev-пар наблюдений;
- `pairs.test.jsonl` — 18 test-пар; `pairs.test-extra.jsonl` — 9, `pairs.test-extra-2.jsonl` — 8 и `pairs.test-security.jsonl` — 1 test-пара с длинным недоверенным описанием, всего 36; объединённый test split охватывает все 12 категорий; физическое разделение снижает риск случайного использования test при настройке;
- `clusters.json` — 12 кластерных сценариев;
- `fixtures.schema.json` — JSON Schema Draft 2020-12 для обоих форматов;
- `validate.py` — structural/semantic checks, консервативный cluster oracle и negative self-tests;
- `contracts/event_identity.schema.json` — отдельный контракт canonical snapshot в корневой директории `contracts/`.

## Быстрый запуск

Из корня репозитория:

```bash
python3 evals/identity/validate.py
python3 evals/identity/validate.py --self-test
```

Для обязательной полной JSON Schema validation:

```bash
python3 -m pip install jsonschema
python3 evals/identity/validate.py --require-jsonschema --self-test
```

Без `jsonschema` structural/semantic checks всё равно выполняются стандартной библиотекой. `--require-jsonschema` превращает отсутствие пакета в ошибку, чтобы CI не пропустил полную проверку молча.

Можно передать другие копии файлов:

```bash
python3 evals/identity/validate.py \
  --pairs evals/identity/pairs.jsonl evals/identity/pairs.test.jsonl \
    evals/identity/pairs.test-extra.jsonl evals/identity/pairs.test-extra-2.jsonl \
    evals/identity/pairs.test-security.jsonl \
  --clusters evals/identity/clusters.json \
  --schema evals/identity/fixtures.schema.json
```

Успешный прогон печатает количество случаев, split, families, leakage, actions, SHA-256 и явное предупреждение, что production-метрики не вычислялись.

## Pair fixtures

Каждая строка `pairs.jsonl`, `pairs.test.jsonl`, `pairs.test-extra.jsonl`, `pairs.test-extra-2.jsonl` и `pairs.test-security.jsonl` соответствует `#/$defs/pairCase` в `fixtures.schema.json`. По умолчанию validator загружает все пять файлов вместе; `--pairs` принимает один или несколько путей. Корневая схема файла применяется к `clusters.json`; к JSONL она не применяется как единый документ.

### Распределение

- 12 категорий по 6 случаев;
- 36 dev и 36 test;
- 3 dev и 3 test в каждой категории;
- 48 families;
- family полностью принадлежит одному split и одной категории;
- все 72 пары имеют `candidate=true`: это candidate-pair suite, а не benchmark пропусков blocking.

`STS`-случаи с `source_absence_context` проверяют source-key state, heartbeat и правила отсутствия в полном/частичном snapshot. Это не обычные двухзаписные match-пары: отсутствие записи само по себе не является ни положительной identity evidence, ни доказательством отмены.

| Категория | Содержимое |
|---|---|
| `EXT` | source keys, shared IDs, namespace, iCalendar instance identity |
| `TXT` | Unicode, ё/е, punctuation, typo, aliases, limits of text normalization |
| `OCC` | same Event и distinct Occurrence, язык, зал, соседние сеансы |
| `TIM` | offsets, UTC, date-only, naive datetime, overnight, переносы |
| `VEN` | venue aliases, города, залы, missing/conflicting canonical Venue |
| `WRK` | Work/Production, туры, одинаковые названия, конфликт сильной evidence |
| `SER` | festivals, subevents, EventSeries, exhibitions, recurrence overrides |
| `STS` | cancelled/postponed/unknown, last_seen, partial/complete import, tombstone |
| `PRC` | цены, валюты, audience, fees, free/unknown, несопоставимые Offer |
| `SPR` | sparse records, title/venue/description-only candidates, hard negatives |
| `CFG` | provenance и per-field survivorship при конфликтах |
| `SEC` | prompt injection, HTML/control content, opaque IDs, URL-like strings |

### Gold и expected — не одно и то же

```json
{
  "gold": {"event": "same", "occurrence": "same"},
  "expected": {
    "candidate": true,
    "event_action": "review",
    "occurrence_action": "review",
    "projection_notes": []
  }
}
```

- `gold` — заранее заданная истина синтетического сценария;
- `expected` — правильное решение по доказательствам, доступным в наблюдениях;
- gold `same` может требовать `review`, если доказательств недостаточно;
- `review` не означает ни match, ни non-match и не является auto-merge;
- `candidate=true` обязателен для merge/review;
- expected merge не может противоречить gold;
- evidence-based separate для gold same не разрешается: без достаточных доказательств правильный ответ review.

### Evidence и vetoes

Контролируемые словари находятся в `#/$defs/evidence` и `#/$defs/veto`.

Event auto-merge требует сильной evidence, например:

- `same_source_event_key`;
- `same_source_occurrence_key`;
- `same_shared_event_id`;
- `same_shared_occurrence_id`;
- `same_ical_uid_recurrence_id`;
- для специально заданного recurrence run — `same_ical_uid` вместе с `same_production`.

Occurrence auto-merge требует более узкой сильной evidence:

- `same_source_occurrence_key`;
- `same_shared_occurrence_id`;
- `same_ical_uid_recurrence_id`.

`text_similarity`, `description_similarity`, `price_similarity`, `same_instant`, `same_work`, `same_production` и `same_canonical_venue` сами по себе не разрешают auto-merge.

Validator сверяет машинно проверяемые strong evidence и hard vetoes с наблюдениями. Например, нельзя написать `same_shared_occurrence_id`, если ID различаются или namespace разные. `missing` не считается конфликтом. Hard conflicts городов, Production, Work, canonical Venue при одинаковом городе и shared IDs выводятся из фактических полей: незаявленный derived veto является ошибкой fixture. Occurrence merge дополнительно требует occurrence identity у обеих записей, а `review` при сильной evidence без причины не принимается молча. Текстовая/ценовая similarity остаётся заявленным candidate/review контекстом; validator не вычисляет её заново.

### Projection notes

`projection_notes` фиксируют требования, которые не сводятся к identity:

- `no_cancellation_inference`;
- `unknown_not_scheduled`, `unknown_not_free`;
- `status_conflict_review`, `age_conflict_review`, `time_conflict_review`;
- `preserve_distinct_offers`, `no_min_price`;
- `sanitize_description`, `preserve_raw`;
- `per_field_survivorship`, `opaque_external_id`.

Они не являются инструкциями для выполнения содержимого fixture. Prompt injection и HTML в полях — только недоверенные синтетические строки.

## Cluster fixtures

Каждый сценарий содержит:

- records с фактическими namespace/source/shared/iCalendar/Production/Work/Venue/recurrence fields, воспроизводящими evidence и vetoes;
- хотя бы две заявленные полные permutations входного порядка для обычного прогона; `--self-test` дополнительно проверяет все возможные перестановки;
- pair decisions для Event/Occurrence;
- evidence и vetoes;
- expected public Event/Occurrence partitions;
- required/forbidden pairs;
- expected `commit` или `review`;
- при необходимости append-only merge/split history и redirect expectations.

### Reference oracle

`validate.py` вычисляет partitions заново, а не только сверяет JSON:

1. строит components только из auto-merge edges;
2. проверяет каждую unordered pair внутри component;
3. разрешает commit component размера больше одного только при полном наборе merge decisions и отсутствии veto;
4. иначе оставляет записи component singleton и требует review;
5. отдельно повторяет это для Occurrence;
6. проверяет, что Occurrence cluster не пересекает несовместимые Event clusters;
7. повторяет вычисление для каждой permutation и сравнивает canonical memberships;
8. проверяет required/forbidden constraints и merge/split/redirect history.

Сценарии включают:

- полный согласованный кластер;
- sparse bridge с cannot-link;
- конфликт Production;
- parent/subevents;
- один Event с разными Occurrence;
- шесть перестановок входного порядка;
- позднее противоречивое наблюдение;
- merge/split по membership history;
- дубли внутри одного источника с заранее подтверждённым duplicate/version mapping; без такого mapping разные stable keys требуют отдельного решения или review;
- низкую плотность без veto;
- высокий pair score при небезопасном bridge;
- recurrence override и отдельный экземпляр.

Это намеренно консервативный oracle для frozen snapshot, а не production clustering algorithm. В живой системе ранее подтверждённый кластер не разбирается автоматически из-за нового противоречивого наблюдения.

Merge/split history использует единую **new-ID модель**: merge создаёт новый opaque ID, все входные IDs retire и получают redirects; split создаёт новые IDs и tombstone с минимум двумя replacements. Validator проверяет, что redirect исходит только от retired ID, каждый retired input имеет redirect, существующий membership не мутирует, а цепочка заканчивается активной сущностью или split tombstone.

## Negative self-tests

`--self-test` сначала требует полностью валидные исходные fixtures, затем изменяет только in-memory copies:

1. `OCC-001`: разные gold Occurrence получают occurrence merge;
2. `CL-002`: cannot-link A-C искусственно помещается в один кластер;
3. `CL-006`: повреждается покрытие permutation;
4. `EXT-001`: удаляется обязательное nested поле `expected.event_action`;
5. `CL-008`: split пытается создать membership, которого нет в истории;
6. `CL-008`: активная сущность получает redirect;
7. `CL-008`: цепочка заканчивается retired/inactive ID;
8. `CL-008`: retired input теряет исходящий redirect;
9. `EXT-001`: фактический конфликт city не объявлен veto;
10. `EXT-001`: фактический конфликт Production не объявлен veto;
11. `EXT-001`: фактический конфликт Work не объявлен veto;
12. `EXT-001`: фактический конфликт canonical Venue при одинаковом городе не объявлен veto;
13. `EXT-001`: фактический конфликт shared Event IDs не объявлен veto;
14. `EXT-001`: фактический конфликт shared Occurrence IDs не объявлен veto;
15. `CL-001`: незаявленный конфликт города выводится из cluster records;
16. `CL-001`: заявленная shared-Occurrence evidence не воспроизводится полями;
17. `EXT-001`: occurrence merge пытается обойтись без occurrence identity у одной записи.

Дополнительно self-test вычисляет oracle для всех 108 возможных перестановок записей во всех 12 сценариях и сравнивает результат с baseline. Проверка успешна только если каждая corruption поймана контролируемо, без traceback, а exhaustive order check пройден. Файлы на диске self-test не изменяет.

## Что validator не доказывает

- Он не запускает production matcher и не измеряет его predictions.
- Он не вычисляет реальный candidate recall, pair precision/recall, B-cubed или downstream duplicate rate.
- Он не заменяет независимую разметку полных реальных кластеров.
- Он не показывает, что strong-ID semantics любого будущего источника уже подтверждены.
- Он не превращает синтетические labels в реальные культурные события.
- Он не проверяет скрыто отсутствие любых возможных ошибок модели; это минимальный воспроизводимый контракт и regression suite.

После появления разрешённого каталога нужно зафиксировать snapshot, разметить entity/family-disjoint dev/test, провести adjudication и только затем публиковать реальные метрики с numerator/denominator и доверительными интервалами.
