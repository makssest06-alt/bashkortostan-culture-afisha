# UX regression suite — «ИИ-куратор культурного дня» (research Issue #9)

Машиночитаемый набор **текстовых/структурных контрактных fixtures** для регрессионной
проверки поведения UI двух поверхностей (Web и Telegram) над общим backend.
Web и Telegram используют один и тот же backend, но UI адаптирован; поэтому сценарии
привязаны к `surface` (`web`, `telegram`, `both`), а контракты описывают поведение,
а не пиксели.

## Границы (что это такое и чем не является)

- Это **контрактные фикстуры**: «при состоянии X и ответе backend Y интерфейс обязан
  показать A, сохранить B и не делать C». Они проверяют структурные обязательства UI.
- Это **не** реальный UI и **не** доказательство usability: никакие UX-метрики
  (время задачи, SUS, успешность сценариев и т.п.) здесь не измеряются.
  Валидатор при успехе явно печатает: «UX usability не измерялось».
- **Никаких реальных данных**: сценарии не содержат реальных названий, цен и URL
  событий, реальных `event_id`/`occurrence_id`, qrels и выдуманных мероприятий.
  Допустимы только абстрактные условия (город/дата/бюджет/возраст) и абстрактные
  исходы backend (`0 результатов`, `occurrence распродан`, `counts: дата ±1 день → 4`).

## Файлы

| Файл | Назначение |
|---|---|
| `scenarios.jsonl` | 60 сценариев, по одному JSON-объекту на строку. |
| `scenarios.schema.json` | JSON Schema (draft 2020-12) для одной строки JSONL. |
| `validate.py` | Валидатор: stdlib + опционально `jsonschema`. |
| `README.md` | Этот файл. |

## Запуск

Из корня репозитория:

```bash
python3 evals/ux/validate.py --require-jsonschema --self-test
```

или из каталога `evals/ux`:

```bash
python3 validate.py --require-jsonschema --self-test
```

Полезные флаги:

- `--file PATH` / `--schema PATH` — нестандартные пути;
- `--require-jsonschema` — падать, если пакет `jsonschema` не установлен
  (без флага schema-проверка пропускается с предупреждением, остальные проверки
  полностью работают на чистом stdlib);
- `--self-test` — 20 итоговых проверок: валидатор портит копии набора
  (счётчики, дубликаты id, enum, критичные ограничения, callback acknowledgement,
  пустые focus/announcement, surfaces, malformed JSONL, отсутствующие поля),
  подтверждает поимку каждого повреждения без traceback и отдельно проверяет
  неповреждённый набор.

Коды выхода: `0` — всё валидно; `1` — ошибки валидации/self-test; `2` — файл не прочитан.

## Формат строки JSONL

```json
{
  "id": "INT-001",
  "category": "intake_editing",
  "surface": "web|telegram|both",
  "given": {"state": "editing", "backend": "короткое абстрактное условие backend"},
  "trigger": "пользовательское или системное событие",
  "expected": {
    "action": "update_constraints",
    "visible": ["что обязано быть видно"],
    "preserved": ["какие поля/состояния обязаны сохраниться"],
    "focus": "строка или null",
    "announcement": "строка или null",
    "invariants": ["controlled", "strings"]
  },
  "forbidden": ["что запрещено показывать/делать"],
  "notes": "произвольная строка (может быть пустой)"
}
```

`given.state` — состояние интерфейса **непосредственно до `trigger`**, а не ожидаемое
состояние после него. Например, перед ответом backend с результатами указано `loading`;
ожидаемый переход определяется через `expected.action`. Для ручного рендера уже
подготовленного состояния `given.state` описывает исходный экран.

## Controlled vocabulary

### Категории и префиксы id (ровно 6 сценариев каждая, нумерация `PREFIX-001..006`)

| Префикс | Категория | Покрытие |
|---|---|---|
| INT | `intake_editing` | Видимые/редактируемые условия; SessionPatch-подобное сохранение неупомянутых полей. |
| CLR | `clarification` | Обязательные уточнения только при необходимости; неоднозначность, противоречия, unknown. |
| RES | `results_cards` | Occurrence-specific время/цена/статус; источник и freshness; unknown ≠ «подходит». |
| EMP | `empty_relaxation` | Пустой результат с исходными условиями; backend aggregate counts; явное подтверждение ослабления hard-ограничений; запрет ослабления критичных/возрастных ограничений. |
| CMP | `comparison` | Сравнение 2–3 вариантов; unknown как «не указано»; никакого выдуманного победителя. |
| PLN | `planning` | План без пересечений; пересчёт бюджета/возраста; буферы как допущения. |
| CHG | `plan_changes` | Отмена/перенос: saved plan → `plan_attention`; старая revision сохраняется; замена — preview + подтверждение; нет silent mutation. |
| ERR | `errors_fallback` | LLM/API/timeout; structured fallback; идемпотентный retry; expired Telegram callback; устаревшие результаты. |
| ACC | `accessibility` | Keyboard, фокус, status announcements, labels/target size, текстовые альтернативы, не только цвет; фоновые обновления не крадут фокус. |
| SEC | `safety_trust` | Prompt injection в описании; запрещённые write/purchase; несанкционированные ID; произвольный SQL/HTTP/shell; отсутствие секретов/персональных данных. |

Правило surface: в каждой категории есть минимум по одному сценарию `web`,
`telegram` и `both` (валидатор проверяет).

### `given.state`

`new`, `editing`, `clarifying`, `loading`, `results`, `empty`, `comparing`,
`plan`, `plan_attention`, `error`, `fallback`.

### `expected.action`

`render_input`, `ask_clarification`, `update_constraints`, `render_loading`,
`render_results`, `render_empty`, `preview_relaxation`, `render_comparison`,
`render_plan`, `show_plan_revision`, `show_error`, `render_fallback`,
`render_source_details`, `reject_untrusted_action`.

### Инварианты (`expected.invariants`)

Обязательный набор:

| Инвариант | Смысл |
|---|---|
| `no_fabricated_events` | Никаких выдуманных событий/времени/цен; только данные backend. |
| `no_silent_hard_relaxation` | Hard-ограничения не ослабляются без явного подтверждения. |
| `critical_constraints_not_relaxed` | Возрастные и другие критичные ограничения не предлагаются к ослаблению и не ослабляются автоматически. |
| `preserve_unmentioned_constraints` | Неупомянутые в правке поля сохраняются (SessionPatch-семантика). |
| `backend_counts_only` | Числа при ослаблении — только агрегаты backend, без выдуманных оценок. |
| `unknown_not_satisfied` | Неизвестное поле не показывается как удовлетворяющее условию. |
| `source_and_freshness_visible` | Источник и давность данных видны. |
| `occurrence_specific` | Время/цена/статус привязаны к конкретному occurrence. |
| `no_overlap` | Пункты плана не пересекаются по времени. |
| `budget_rechecked` | Итог плана пересчитан против бюджета при показе/изменении. |
| `age_rechecked` | Возрастные ограничения перепроверены при показе/изменении. |
| `unaffected_plan_items_preserved` | Незатронутые пункты плана не меняются. |
| `user_confirms_plan_revision` | Новая revision плана применяется только после подтверждения. |
| `original_plan_retained` | Исходная revision плана сохраняется и доступна. |
| `read_only` | Никаких write-операций наружу. |
| `untrusted_content_not_executed` | Контент событий/пользователя не исполняется как команды. |
| `keyboard_operable` | Сценарий полностью доступен с клавиатуры. |
| `focus_managed` | Фокус предсказуем; фоновые обновления его не крадут. |
| `status_announcement` | Смена статуса объявляется (live region / отдельное сообщение). |
| `text_equivalent` | У нетекстового контента есть текстовый эквивалент. |
| `no_color_only_status` | Статус не передаётся только цветом. |
| `no_dead_controls` | Нет нерабочих/мёртвых элементов управления в error/fallback. |
| `llm_not_required_for_basic_search` | Базовый поиск работает без LLM. |
| `no_unrequested_write` | Нет незапрошенных записей/изменений. |
| `no_sensitive_data` | Нет секретов, ключей, персональных данных в выводе. |

Дополнительные: `buffers_marked_as_assumptions` (буферы/допущения помечены),
`no_invented_winner` (нет выдуманного победителя в сравнении),
`unknown_rendered_as_unspecified` (unknown показан как «не указано»),
`idempotent_retry` (retry не дублирует запрос/запись),
`stale_output_marked` (устаревший результат помечен),
`callback_expiry_graceful` (устаревший Telegram callback обработан gracefully),
`callback_acknowledged` (каждый Telegram callback получает acknowledgement,
обозначенный контрольной строкой `callback_ack: ...`).

## Строковые конвенции (проверяются валидатором семантически)

- `ask_clarification`: в `visible` обязан быть вопрос (строка оканчивается на «?»)
  и причина (строка начинается с `reason:`); `preserved` непуст.
- `render_empty`: в `visible` исходные условия (`constraints: ...`);
  инварианты `no_silent_hard_relaxation` и `critical_constraints_not_relaxed`.
- `preview_relaxation`: `constraints: ...`, явное подтверждение (`confirm: ...`);
  инварианты `no_silent_hard_relaxation`, `backend_counts_only` и
  `critical_constraints_not_relaxed`.
- `render_plan`: `no_overlap` всегда; `budget_rechecked`/`age_rechecked` —
  когда бюджет/возраст упоминаются в `given.backend`, `trigger`, `visible` или
  `preserved`. Поля `forbidden` и `notes` в эвристику не входят; это проверка
  контрактной пометки, а не полноценный разбор естественного языка.
- Telegram callback в `given.backend`/`trigger`: инвариант `callback_acknowledged`
  и строка `callback_ack: ...` в `visible`.
- `show_plan_revision`: `original_plan_retained`, `unaffected_plan_items_preserved`,
  `user_confirms_plan_revision`.
- `render_comparison`: `unknown_rendered_as_unspecified`, `no_invented_winner`.
- `render_source_details` и карточки RES: `source_and_freshness_visible`.
- Любое «не указано» в `visible` требует `unknown_not_satisfied` или
  `unknown_rendered_as_unspecified`.
- `focus_managed` ⇒ `focus` непуст; `status_announcement` ⇒ `announcement` непуст;
  `text_equivalent` ⇒ строка `alt: ...`/`label: ...`; `no_color_only_status` ⇒
  строка `status: ...`.
- Категория ACC: хотя бы один a11y-инвариант; категория SEC: хотя бы один из
  `read_only` / `untrusted_content_not_executed` / `no_unrequested_write` /
  `no_sensitive_data`; `reject_untrusted_action` требует
  `untrusted_content_not_executed` или `no_unrequested_write`.

Валидатор намеренно **не** требует неприменимые инварианты механически ко всем
строкам: проверки привязаны к `action`/`category` и к упоминаниям в тексте.

## Как маппить в Playwright / Telegram-тесты позже

Каждая строка — декларативный контракт, который можно механически превратить в тест:

- `id` → стабильный test id (`test[INT-001]`), `category` → тестовый suite;
- `surface: both` → прогон одного теста в двух реализациях (web + telegram);
- `given.state` + `given.backend` → фикстура: мок backend-ответа/состояния сессии
  (без реальных событий — подставляются заглушки);
- `trigger` → пользовательское действие (Playwright: click/fill; Telegram: сообщение
  или callback боту);
- `expected.action` → выбор page-object/хендлера и набора ассертов;
- `expected.visible` → проверки видимых строк (`getByText`, текст сообщения бота);
- `expected.preserved` → повторная проверка значений полей после действия;
- `expected.focus` / `expected.announcement` → `document.activeElement` /
  aria-live region (web), отдельное уведомление (telegram);
- `expected.invariants` → сквозные ассерты-хелперы (например, `no_overlap` —
  сортировка интервалов и сравнение концов/начал);
- `forbidden` → негативные ассерты (`toHaveCount(0)`, отсутствие сетевых вызовов,
  отсутствие записей в мок-хранилище).

## Ограничения

- Suite не проверяет реальный рендер, вёрстку, скорость и удобство;
  UX usability не измерялось.
- Строки `visible`/`forbidden` — контрольные фразы, а не финальная копия UI:
  при маппинге в тесты допустимо сопоставление по смыслу/ключам.
- Сценарии опираются на абстрактные исходы backend; привязка к реальным API
  делается на уровне фикстур тестов, а не этого набора.
