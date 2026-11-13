# Каноническая модель событий и дедупликация

> **Вне скоупа хакатона (2026-11-13).** ТЗ требует одну карточку события с полями п. 8.1, а не многосущностную модель идентичности. Документ сохранён как исследование. Действующий контракт: [`contracts/event.schema.json`](../contracts/event.schema.json), правила и дедупликация по `dedup_key`: [`docs/EVENT_SCHEMA.md`](EVENT_SCHEMA.md). Подробнее — [`docs/DECISIONS.md`](DECISIONS.md), раздел «Вне скоупа хакатона».

Статус: исследовательское предложение для D-005 и D-008, не утверждённая production-схема. Документ подготовлен до выдачи реального каталога и API хакатона. Он не меняет решения в `main` и не закрывает D-005/D-008 автоматически.

Дата проверки внешних стандартов: 2026-11-11. Реальные источники и API афиши не исследовались.

## 1. Цель и границы

Система должна отвечать на четыре разных вопроса:

1. Это две записи об одном audience-facing событии?
2. Это две записи об одном конкретном сеансе?
3. Это разные события, связанные произведением, постановкой, серией или фестивалем?
4. Какое значение поля можно показать, если источники противоречат друг другу?

Нельзя сводить их к одному similarity score. Ошибочный merge может скрыть отдельное событие или сеанс, поэтому начальная стратегия асимметрична: **ложное объединение хуже оставленного для модерации дубликата**.

В этом исследовании:

- все тестовые события полностью синтетические и находятся только в `evals/identity/`;
- реальные источники афиши и API не исследовались;
- production precision, recall, nDCG и доля дублей не измерялись;
- fixtures проверяют контракт и будущую реализацию, а не доказывают качество на реальных данных;
- сомнительные записи публично остаются раздельными до модерации.

## 2. Основные решения

1. Внутренняя модель разделяет `Work`, `Production`, `Event`, `Occurrence`, `Venue` и `Offer`.
2. `EventRelation` выражает связь, но не идентичность: `part_of`, `same_work`, `same_production`, `series_member`, `related`.
3. Сырые наблюдения источника не перезаписываются канонической карточкой. Происхождение каждого значения сохраняется через `FieldAssertion`.
4. Решения об идентичности Event и Occurrence принимаются раздельно.
5. Автоматический merge требует сильной положительной evidence и отсутствия veto. Нечёткая похожесть сама по себе достаточна максимум для `review`.
6. Кластер не собирается наивным connected components. Перед commit проверяются все поперечные пары и cannot-link constraints.
7. Merge/split — append-only операции с membership history, аудитом и разрешением старых ссылок. Исходные наблюдения не удаляются.
8. Matching и survivorship разделены: конфликт цены, описания, возраста, времени или статуса не обязан менять решение об идентичности.
9. `unknown` не равно `false`, `0`, `free`, `scheduled` или «подходит пользователю».
10. `last_seen_at` — heartbeat наблюдения, а не статус события. Отсутствие записи не означает отмену.

## 3. Модель сущностей

| Сущность | Значение | Примеры границ |
|---|---|---|
| `Work` | Абстрактное произведение: пьеса, музыкальное сочинение, фильм как произведение | Не содержит конкретный сеанс или город как часть идентичности |
| `Production` | Конкретная постановка, интерпретация, монтаж или тур | Две разные постановки одного `Work` не объединяются |
| `Event` | Локальное событие или run, с которым пользователь работает как с единой карточкой | Может содержать много сеансов; не является произведением или фестивальной программой целиком |
| `Occurrence` | Конкретный экземпляр/сеанс с началом, концом, площадкой, статусом и предложениями | Основная единица для проверки времени и выдачи `occurrence_id` ассистентом |
| `Venue` | Каноническая площадка | Название, город, адрес, координаты; зал — отдельный атрибут или дочерняя площадь по правилам источника |
| `Offer` | Отдельное билетное/ценовое предложение | Валюта, audience, fees, availability, observed/valid time; не сводится к одной минимальной цене |
| `EventSeries` | Редакционная серия разных событий с общим признаком | Участники серии не становятся дубликатами |
| `EventRelation` | Типизированная связь между сущностями | `part_of` не означает `same_event` |
| `SourceRecord` | Запись источника и её стабильный внешний ключ | Upsert выполняется по ключу источника, а не по названию |
| `RawObservation` | Неизменяемая версия полезной нагрузки, полученная в конкретный import run | Хранит raw payload, hash и время получения |
| `FieldAssertion` | Утверждение конкретного наблюдения о значении поля | Позволяет пересчитать проекцию и показать provenance |
| `IdentityDecision` | Решение `merge/separate/review` для пары и уровня identity | Содержит evidence, vetoes, версию правил и actor |
| `IdentityOperation` | Фактический append-only merge/split | Не стирается при исправлении; исправление — новая операция |
| `IdRedirect` | Разрешение старого ID | Ведёт к активному ID или к split tombstone с несколькими replacements |
| `ModerationTask` | Спорная пара, конфликт поля или подозрительное содержимое | Не считается ни match, ни non-match до решения человека |

### 3.1. Обязательные различия

- Один `Event`, разные `Occurrence`: сеансы одной локальной постановки/run.
- Разные `Event`, один `Production`: гастроли в разных городах или самостоятельные локальные runs.
- Разные `Event`, один `Work`: разные постановки одного произведения.
- Parent `Event` и subevents: фестиваль и отдельные концерты в его программе.
- `EventSeries` и участники: лекционный цикл и отдельные лекции.
- Continuous exhibition run и посетительский сеанс: выставка как карточка и конкретное посещение/сеанс.
- Одинаковые названия и действительно одинаковая реальная сущность: первое не доказывает второе.

### 3.2. Граница Event по типовым сценариям

**Постановка на несколько дат.** По умолчанию это один локальный `Event` с несколькими `Occurrence`, если организатор подаёт их как один run и совпадают Production и локальный контекст. Разное время не делает автоматически разные Event.

**Тур.** Одна Production в разных городах обычно порождает разные Event, связанные `same_production`. Это предотвращает смешение программы дня и площадок.

**Фестиваль.** Родительский фестиваль и входящие в программу события — разные Event с `part_of`. Даже совпадение даты, площадки или части названия не отменяет эту связь и не создаёт дубликат.

**Лекционный/тематический цикл.** Если участники имеют самостоятельную программу, спикеров или билеты, это EventSeries с разными Event. Повторяемость сама по себе не превращает серию в один Event.

**Выставка.** Длительная экспозиция — один Event/run. Часы посещения могут быть Occurrence или расписанием доступности в зависимости от билетной семантики. Отдельная экскурсия внутри выставки — самостоятельный subevent, если продаётся/описывается отдельно.

**Спорная граница.** Если источник не позволяет отличить run от серии самостоятельных событий, создаётся review. Нельзя выбирать границу только потому, что так удобнее поисковому ranking.

## 4. Стабильные идентификаторы

### 4.1. Внутренние ID

- `work_id`, `production_id`, `event_id`, `occurrence_id`, `venue_id` — непрозрачные и не вычисляются из `title`, даты или площади.
- Изменение названия, перенос или смена источника не меняет ID автоматически.
- Старые ID не переиспользуются после merge/split.
- Hash payload нужен для change detection, но не становится Event/Occurrence ID.

### 4.2. Ключи источника

Минимальный source upsert:

```text
SourceRecord:   (source_id, external_event_id)
Occurrence key: (source_id, external_occurrence_id)
```

Если источник вкладывает сеанс в событие, внешний occurrence key должен быть уникален в документированной области; при необходимости используется составной ключ `(source_id, external_event_id, external_occurrence_id)`.

Для iCalendar:

```text
series/stream identity: UID в пределах authority/namespace
instance identity:      UID + RECURRENCE-ID
```

`RECURRENCE-ID` отличает конкретный экземпляр. Override с тем же `UID + RECURRENCE-ID` обновляет экземпляр, а не появляется рядом как дополнительный дубликат. `EXDATE` означает исключение экземпляра, а не новую карточку.

### 4.3. Namespace и качество внешних ID

- Внешние ID — opaque strings. Нельзя case-fold, удалять значащие символы или считать одинаковые строки из разных источников глобально одинаковыми.
- Сильное сравнение возможно только внутри одной документированной authority/namespace.
- URL, `mailto:`, `../` и другие конструкции во внешнем ID остаются данными; они не используются как путь или команда.
- Совпадение ID, скопированного агрегатором у другого агрегатора, учитывается как сильное только после подтверждения общей семантики namespace.
- При отсутствии внешнего ID сохраняется provisional source key. Fingerprint изменчивых полей может помочь blocking, но не даёт auto-merge.

## 5. Время, recurrence и точность

Каждое временное значение хранит одновременно:

```json
{
  "start_utc": "2030-01-15T14:00:00Z",
  "start_local_raw": "2030-01-15T19:00:00+05:00",
  "timezone": "Asia/Yekaterinburg",
  "offset_raw": "+05:00",
  "precision": "minute"
}
```

Правила:

1. UTC instant сохраняется только когда его можно вычислить без догадок.
2. Исходная локальная строка, offset, IANA timezone и precision не теряются.
3. Date-only не превращается в `00:00:00Z`; точность `date` не равна точности `minute`.
4. Naive local datetime без надёжной timezone получает `start_utc: null` и не служит доказательством точного совпадения instant.
5. Overnight хранится абсолютными началом и концом; нельзя сравнивать только календарную дату начала.
6. Перенос обновляет ту же Occurrence, если подтверждена её идентичность; старое значение остаётся в provenance/`previous_start`.
7. `postponed` означает, что новой даты нет. `rescheduled` означает, что новая дата известна.
8. Recurrence хранит идентичность правила/серии и идентичность экземпляра отдельно. Нормализованный список экземпляров строится с учётом `RRULE`, `RDATE`, `EXDATE` и overrides.

Совпадение или близость времени — положительный feature, но не самостоятельное identity evidence. Два сеанса с различием в 30 минут нельзя объединять только из-за близости.

## 6. Статус, видимость и отсутствие записи

### 6.1. Статусы

Базовый внешний словарь: `unknown`, `scheduled`, `postponed`, `rescheduled`, `cancelled`, `moved_online`. Завершённость может вычисляться отдельно от источника по времени и не должна затирать исходный статус.

- Статус относится прежде всего к Occurrence.
- Отмена одной Occurrence не отменяет всё Event.
- Event-level `cancelled` допустим при явном утверждении источника/модератора либо по отдельно задокументированному агрегирующему правилу с достаточным покрытием сеансов.
- Unknown Occurrence не считаются активными и не считаются отменёнными.
- Внешний default вроде Schema.org `EventScheduled` не разрешает нам называть неизвестный статус проверенным `scheduled`. Default учитывается только при явно документированной семантике конкретного источника и с disclosure.

### 6.2. Наблюдение источника

Отдельно хранятся:

```text
observed_at       — когда получено это наблюдение;
last_seen_at      — последний heartbeat, когда source key действительно наблюдался;
import_run_id     — конкретный запуск;
run_completeness  — complete | partial | failed;
presence          — present | explicit_tombstone | not_observed.
```

`not_observed` допустимо вычислять только относительно известного scope полного snapshot. Partial/failed run не порождает даже уверенный `missing_in_source`.

Даже подтверждённое `missing_in_source` — это не `cancelled`. Оно может запустить проверку свежести или модерацию. Число пропущенных выгрузок и задержки не задаются произвольно до анализа реального источника.

### 6.3. RecurrenceSet и публикация наружу

Внутри системы `RecurrenceSet` хранит `DTSTART`, `RRULE`, `RDATE`, `EXDATE`, timezone и `override_occurrence_ids` — ссылки на материализованные Occurrence, переопределяющие экземпляры по `UID + RECURRENCE-ID`. Occurrence материализуется даже для одиночного сеанса: это убирает особый режим хранения «одно-дата события» и позволяет добавить второй сеанс без миграции идентичности.

Порядок построения recurrence set:

1. взять локальный `DTSTART` и включения `RRULE`;
2. добавить `RDATE`;
3. исключить `EXDATE`;
4. применить overrides по `RECURRENCE-ID`;
5. только затем вычислить UTC каждого экземпляра.

`EXDATE` и пользовательская отмена не тождественны. Если сеанс уже был продан/опубликован, обычно нужна Occurrence со статусом `cancelled`, а не бесследное исключение.

Для повторяемости в локальном времени одного UTC offset недостаточно: правило относится к локальному времени площадки, а IANA timezone задаёт будущие смещения. RFC 3339 `-00:00` означает известный UTC instant при неизвестном локальном смещении и не заменяет `Z`.

Наружу возможны разные проекции:

- JSON-LD/schema.org может представлять повторения отдельными `Event` или через `eventSchedule`;
- внутренний `Occurrence` при этом не исчезает;
- при `eventSchedule` не следует одновременно публиковать противоречащие `startDate/endDate` на связанном Event;
- iCalendar использует `UID`, `RECURRENCE-ID`, `SEQUENCE` и ограниченный набор `TENTATIVE/CONFIRMED/CANCELLED`; полной round-trip конверсии со Schema.org statuses нет.

Внутренний статус дополнительно может быть `tentative`; его нельзя молча приравнивать к подтверждённому `scheduled`. Многократные переносы хранятся как цепочка истории, а не плоский неупорядоченный список `previousStartDate`.

## 7. Raw observations, provenance и каноническая проекция

### 7.1. Источник истины

```text
SourceRecord + RawObservation + FieldAssertion + IdentityOperation
                              ↓
                 пересчитываемая canonical projection
                              ↓
                    поиск / API / Web / Telegram
```

`RawObservation` содержит как минимум:

- `source_record_id`, `import_run_id`, `observed_at`;
- исходный payload и content hash;
- адрес/идентификатор выборки в разрешённом источнике;
- parser version и результат валидации;
- статус получения и completeness контекста.

`FieldAssertion` содержит:

- `subject_type`, `subject_id`, `field_path`;
- значение и его тип/precision;
- `raw_observation_id`;
- `observed_at`, при наличии `valid_from/valid_to`;
- extraction/mapping version;
- conflict group и решение survivorship, если оно есть.

Каноническая карточка — пересчитываемая проекция, а не единственная копия истины. Любое показанное значение можно проследить до наблюдения и решения. Raw payload не редактируется задним числом; новая версия — новое наблюдение.

### 7.2. Matching ≠ survivorship

Matching отвечает «одна ли это сущность?». Survivorship отвечает «какое значение показать?».

Пример: два наблюдения с одним подтверждённым occurrence key содержат разные описания. Occurrence можно объединить, но конфликт описания остаётся в provenance и решается отдельным правилом.

Обратный пример: две записи имеют одинаковую цену и описание, но конфликтующие Production. Это разные Event; общие значения полей не отменяют identity veto.

## 8. Конвейер дедупликации

```text
Raw source observations
         ↓
Source-key upsert + сохранение raw payload
         ↓
Нормализация без потери исходной строки
         ↓
Несколько независимых blocking passes
         ↓
Pair features + positive evidence + vetoes
         ↓
Решение Event: merge / separate / review
         ↓
Решение Occurrence: merge / separate / review / not_applicable
         ↓
Cluster constraints и проверка cross-links
         ↓
Canonical projection + redirects + append-only audit
         ↓
Модерация спорных решений и обратимый split
```

На каждом этапе сохраняются версия правил/модели, входной snapshot, candidate pass, evidence и причина решения. Без этого невозможно воспроизвести ошибочный merge после изменения алгоритма.

### 8.1. Нормализация

Допустимые feature-представления:

- Unicode normalization для сравнения текста;
- `ё/е`, punctuation и whitespace variants;
- словарь подтверждённых alias;
- токены и q-grams;
- приведение известных форматов времени с сохранением precision;
- нормализация адреса только через версионированные правила.

Исходная строка сохраняется всегда. Нормализация текста не применяется к opaque external ID. HTML и управляющие символы обрабатываются как недоверенные данные, а не как инструкции.

### 8.2. Candidate generation / blocking

Независимые passes объединяются через union:

1. source/global IDs в одном authority/namespace;
2. `UID + RECURRENCE-ID`;
3. city + local date;
4. canonical venue + local date;
5. Production/Work + город/площадка;
6. title tokens/q-grams и curated aliases;
7. parent/series candidates для обнаружения hard negatives и связей.

Blocking должен находить не только потенциальные дубли, но и трудные негативы. Veto применяется на pair decision, а не используется для скрытия пары из оценки candidate recall.

```text
CandidateRecall =
  истинные match-пары, попавшие хотя бы в один candidate pass
  / все истинные match-пары
```

Отдельно считаются Event candidate recall и Occurrence candidate recall. Matcher не восстановит пару, которую blocking не выдал.

### 8.3. Evidence и vetoes

| Наблюдение | Роль |
|---|---|
| Тот же подтверждённый source occurrence key | Сильное evidence same Occurrence и связанного Event |
| Тот же подтверждённый global/shared occurrence ID в одном namespace | Сильное evidence, если нет конфликтующего veto |
| Тот же `UID + RECURRENCE-ID` | Сильное evidence same recurrence instance |
| Тот же Event key, разные стабильные occurrence keys | Same Event, distinct Occurrence |
| Совпадение Production/Work | Положительный feature или relation, не самостоятельный merge |
| Совпадение canonical venue/города | Положительный feature; missing venue не disagreement |
| Совпадение title/описания/цены/embedding | Candidate/review evidence, не auto-merge |
| Точное совпадение instant | Положительный feature, не самостоятельный merge |
| Разные независимые Production | Cannot-link для Event, если обе идентификации надёжны |
| Parent/subevent | Cannot-link для Event; создаётся relation |
| Разные города для локального run | Обычно Event veto; онлайн/гибрид требует отдельной семантики |
| Конфликт независимых сильных ID | Veto или review при противоречии с другой сильной evidence |
| Разные stable occurrence keys / recurrence IDs | По умолчанию Occurrence separate, даже если Event merge; исключение только для подтверждённого duplicate/version mapping |
| Разный язык сеанса, зал или посадочный вариант | Потенциально distinct Occurrence; зависит от билетной семантики |
| Конфликт цены/описания/возраста/статуса | Survivorship issue, не автоматический identity veto |

Отсутствующее поле — unknown, а не disagreement. Два независимых источника, повторяющие один и тот же первичный источник, не считаются независимым подтверждением.

Hard conflicts выводятся из фактических наблюдений, а не доверяются только подписи `vetoes`: разные надёжные Production, Work, города локального run, canonical Venue при одном подтверждённом городе или shared IDs в одном namespace обязаны породить соответствующий veto/review. Нельзя получить auto-merge, просто не записав конфликт в список labels.

Разные source occurrence keys внутри одного источника обычно означают разные Occurrence. Узкое исключение — независимый shared authority заранее и явно подтвердил, что эти keys являются duplicate/version keys одного Occurrence: тогда общий shared occurrence ID в одном namespace может подтвердить merge. Это не правило «shared ID всегда побеждает»; без подтверждённой семантики mapping конкурирующие сильные ключи требуют `review`. Синтетический `CL-009` предполагает такой подтверждённый mapping, а в `CL-005` дубли A-B имеют одинаковый source occurrence key.

### 8.4. Начальная decision policy

До собственной разметки применяется консервативный rule-based baseline:

- **Event auto-merge:** есть разрешённое сильное identity evidence, нет Event veto, кластерный commit безопасен.
- **Occurrence auto-merge:** есть разрешённое сильное occurrence evidence, нет Occurrence veto, обе записи принадлежат совместимому Event cluster.
- **Separate:** подтверждённая разная идентичность или устойчивый veto; отсутствие доказательств само по себе не доказывает different.
- **Review:** недостаток доказательств, конфликт сильных evidence, неизвестная timezone/precision мешает решению, спорная граница Event или небезопасная кластерная структура.
- **Public до review:** записи остаются раздельными; `review` не считается auto-merge и не входит в его denominator.

`separate` по текущему snapshot не становится вечным cannot-link. Постоянный constraint создаётся только подтверждённым правилом или человеком с аудитом.

### 8.5. Вероятностный matcher позже

Fellegi–Sunter может ранжировать пары после появления разметки:

```text
M_obs = log2(λ/(1−λ)) + Σ_i log2(m_i/u_i)
Pr(match | observation) = 2^M_obs / (1 + 2^M_obs)
```

Здесь `m_i` — вероятность наблюдения для истинного match, `u_i` — для non-match, `λ` — prior match probability.

Ограничения:

- условная независимость полей — допущение; город/площадка, название/Production и адрес/координаты коррелируют;
- correlated evidence нельзя складывать как независимые подтверждения без проверки;
- два порога создают auto-merge/review/separate, но числа из чужих систем не переносятся;
- vetoes и правила Occurrence остаются поверх score;
- score не заменяет cluster constraints;
- пороги калибруются на dev, замороженный test используется после независимой разметки.

## 9. Кластерный commit

### 9.1. Почему connected components недостаточно

Из `A≈B` и `B≈C` не следует `A=C`. Sparse bridge или один ошибочный matcher edge может соединить две большие разные сущности. Повышение pair threshold само по себе не устраняет этот риск.

### 9.2. Консервативный reference algorithm

Для замороженного snapshot отдельно строятся Event graph и Occurrence graph:

1. Ребро `merge` добавляется только из пары, разрешённой к auto-merge.
2. Для каждого connected component из таких рёбер проверяются **все unordered pairs внутри component**.
3. Компонент размера больше одного коммитится целиком только если:
   - каждая внутренняя пара имеет решение `merge` на этом уровне;
   - нет cannot-link/veto внутри;
   - нет неразрешённой Event/Occurrence несовместимости;
   - все required constraints выполнимы.
4. Если внутри есть `review`, `separate`, отсутствующая пара или veto, новый component не коммитится: на этом frozen snapshot его записи публично остаются singleton, создаётся модерация.
5. Ранее подтверждённый кластер не разбирается автоматически из-за нового противоречивого наблюдения. Оно изолируется/помечается review; изменение старого кластера требует новой IdentityOperation.
6. Результат сравнивается по membership, а не по случайным новым ID, и обязан быть инвариантен к порядку входа.

Это намеренно простой и осторожный baseline. Более плотная constrained-correlation clustering возможна позже, но только при сохранении vetoes, order invariance, audit и прохождении тех же fixtures.

### 9.3. Два уровня кластеров

- Event clusters могут объединять записи с разными Occurrence.
- Occurrence clusters не могут пересекать несовместимые Event clusters.
- Если Event merge и Occurrence separate, сеансы остаются отдельными внутри одной карточки.
- Parent/subevents и разные Production не соединяются даже при наличии candidate edges.

## 10. Обратимый merge/split и redirects

### 10.1. IdentityOperation

Каждая операция содержит:

- `operation_id`, `level`, `type`, `created_at`;
- actor (`system` или человек) и причину;
- входные entity IDs и точные source-record memberships;
- список IdentityDecision/evidence;
- resulting entity IDs;
- ссылки на предыдущие операции и версию проекции;
- для split — основание и восстановленную membership history.

Операции append-only. Исправление не редактирует прошлое, а добавляет новую операцию. Inputs и outputs disjoint; output IDs новые и непрозрачные. Membership существующего ID никогда не мутирует: `memberships_before` и `memberships_after` — отдельные исторические snapshots.

### 10.2. Merge

1. Зафиксировать memberships всех участников до операции.
2. Создать новый opaque output ID, не совпадающий ни с одним известным ID; survivor среди входных IDs нет.
3. Создать новую каноническую проекцию из всех assertions и связать её с output ID.
4. Retire все входные IDs и создать исходящий redirect от каждого к output ID.
5. Сохранить исходные наблюдения, decisions и неизменную историю memberships.
6. Проверить Occurrence membership отдельно: merge Event не объединяет сеансы автоматически.

### 10.3. Split

Split не угадывает разделение заново по title similarity:

1. выбрать конкретную ошибочную операцию/состояние;
2. восстановить memberships из history с учётом последующих операций;
3. человек подтверждает спорные назначения новых наблюдений;
4. создать новые entity IDs для частей; старые ID не воскрешаются и не переиспользуются;
5. объединённый ID пометить split tombstone со списком `replacement_ids`;
6. пересчитать проекции и аудит.

Один старый URL нельзя молча перенаправить на несколько сущностей. Resolver возвращает split tombstone и replacements; выбор одной части без доказательств запрещён. Redirect graph должен быть ациклическим, каждый retired input должен иметь исходящий redirect, а каждая цепочка — заканчиваться активной сущностью или split tombstone. Redirect от ещё активной сущности запрещён.

## 11. Survivorship и конфликты полей

Правила задаются per-field. «Вся запись последнего источника побеждает» запрещена.

| Поле | Начальная политика |
|---|---|
| `title` | Сохранить variants; предпочесть подтверждённый официальный/наиболее полный вариант по явному правилу, не самую длинную строку |
| `description` | Выбрать по источнику/свежести при сопоставимой редакции; raw variants сохранить; sanitize при выводе |
| `start/end` | Использовать подтверждённый occurrence identity и историю переносов; precision/timezone обязательны; конфликт без достаточных данных → review |
| `status` | Явные статусные утверждения важнее heartbeat; конфликт active/cancelled → uncertainty и review до разрешения |
| `age_rating` | Unknown не равно `0+`; нерешённый конфликт не проходит строгий возрастной фильтр |
| `venue` | Canonical venue разрешается identity layer площадок; зал не теряется; конфликт не затирается более новым текстом автоматически |
| `Offer` | Хранить предложения отдельно: audience, валюта, fees, availability, seller, valid/observed times |
| `category` | Сохранять source category и версию mapping в общий словарь |
| `images/links` | Проверять разрешённый URL/content policy; не использовать как доказательство identity |

Нельзя молча выбирать минимальную цену из несопоставимых Offer. «От 0» не появляется из unknown. Бесплатно фиксируется только явным утверждением или сопоставимым free Offer.

При нерешённом конфликте возраста, времени или статуса публичный ответ показывает uncertainty. Строгий поиск не считает такое значение проверенным.

## 12. Модерация

Типы задач:

- `event_pair_review`;
- `occurrence_pair_review`;
- `cluster_bridge_review`;
- `conflicting_strong_evidence`;
- `event_boundary_review` (run/series/parent);
- `field_conflict_review`;
- `stale_or_missing_source_review`;
- `split_membership_review`;
- `untrusted_content_review`.

Карточка модератора показывает:

- raw и normalized значения рядом;
- источник, external keys, namespace и observation times;
- candidate passes и pair evidence;
- vetoes и связанные Production/Event/Venue;
- уже существующие relations и constraints;
- предполагаемые Event/Occurrence clusters;
- последствия merge/separate для публичных сеансов;
- историю операций и возможность split.

Действия модератора имеют права на сервере, reason и audit. Административный контур отделён от публичного read-only ассистента. Публичная модель не получает права merge/split.

## 13. Безопасность и недоверенные данные

- Внешние описания, title, external IDs и URLs — данные, не инструкции.
- Prompt injection в описании не меняет identity rules и не вызывает инструменты.
- HTML/Markdown sanitization выполняется на выводе; raw payload доступен только защищённому контуру.
- External ID не используется как файловый путь, shell fragment или произвольный URL.
- Секреты не помещаются в fixtures, payload, логи или Git.
- Публичные инструменты ассистента read-only; любые write-действия требуют отдельного подтверждения человека и серверной авторизации.
- Fixtures не содержат реальных событий, персональных данных или production IDs.

## 14. Контракт публичного результата

Для выдачи ассистента и программы дня предпочтителен `occurrence_id`, а не только `event_id`:

```json
{
  "event_id": "evt_opaque",
  "occurrence_id": "occ_opaque",
  "start_utc": "2030-01-15T14:00:00Z",
  "start_local_raw": "2030-01-15T19:00:00+05:00",
  "timezone": "Asia/Yekaterinburg",
  "precision": "minute",
  "status": "unknown",
  "status_is_verified": false,
  "venue_id": "venue_opaque",
  "offers": [],
  "source_assertions": ["assertion_opaque"],
  "identity_revision": "operation_or_snapshot_id"
}
```

Hard filters применяет backend. Unknown или conflicted значение нельзя молча считать удовлетворяющим фильтру. Результат показывает источник, свежесть и неопределённость; факты не генерируются языковой моделью.

## 15. Оценка качества

### 15.1. Раздельные метрики

1. **Source upsert correctness:** повторный импорт не создаёт новый SourceRecord; revision history сохраняется.
2. **Candidate recall:** отдельно Event и Occurrence, с numerator/denominator по каждому pass и union.
3. **Pair decisions:** precision/recall по `merge`, `separate`, `review`; macro по категориям и micro по парам.
4. **Auto-merge precision:** только фактические auto-merge; review не переносится молча ни в matches, ни в non-matches.
5. **False merge / false split:** отдельно Event и Occurrence; критические случаи parent/subevent, Production conflict и потеря сеанса перечисляются явно.
6. **Review rate / review coverage:** доля пар и записей в review; сколько истинных сложных случаев попало в очередь.
7. **Cluster quality:** B-cubed и constraint violations; отдельно Event и Occurrence.
8. **Order invariance:** одинаковые memberships при перестановках frozen snapshot.
9. **Merge/split/redirect correctness:** восстановление memberships, ацикличность и корректные replacements.
10. **Downstream duplicate rate:** доля топов поиска/плана, где дубли вытесняют разные события; измеряется после появления реального каталога.
11. **Стоимость модерации:** задачи на 1000 записей, время решения, повторное открытие и согласованность модераторов.

### 15.2. Pair metrics

Для auto-merge:

```text
AutoMergePrecision = TP_auto_merge / (TP_auto_merge + FP_auto_merge)
AutoMergeRecall    = TP_auto_merge / все истинные match-пары
```

Review не считается auto-merge. Для итогового качества после арбитража публикуется отдельный отчёт с решениями модератора; иначе нельзя сравнивать системы с разной долей review.

Для каждой доли указываются numerator, denominator и Wilson interval. Для доверительных интервалов различий между алгоритмами применяется grouped bootstrap по entity/family, а не независимый bootstrap коррелированных пар.

### 15.3. B-cubed

Для записи `r`, истинного кластера `T(r)` и предсказанного `P(r)`:

```text
precision(r) = |T(r) ∩ P(r)| / |P(r)|
recall(r)    = |T(r) ∩ P(r)| / |T(r)|

B3-Precision = среднее precision(r) по записям
B3-Recall    = среднее recall(r) по записям
```

Оригинальный B-cubed включает саму запись. Он дополняет, а не заменяет pair-level auto-merge precision и явный подсчёт критических false merges. Singleton-only отчёт недостаточен: возможен высокий B3 при большом числе false splits.

### 15.4. Разметка после получения каталога

1. Зафиксировать immutable snapshot и import run completeness.
2. Составить полностью разрешённые кластеры для выборки, а не только случайные пары.
3. Добавить hard negatives: одинаковые названия, один Work, разные Production, parent/subevents, соседние сеансы, unseen venues/works.
4. Разделить dev/test по entity/family; одна family не пересекает split.
5. Проверить unseen venues, works и productions отдельно.
6. Два независимых разметчика решают спорные границы; disagreements попадают в adjudication.
7. Сохранить gold identity отдельно от правильного evidence-based действия.
8. Pool-based оценка не называется истинным Recall вне покрытого пула.
9. Заморозить test до сравнения алгоритмов; не подгонять под него thresholds.
10. Публиковать версии snapshot, разметки, правил и кода.

## 16. Synthetic fixtures и автоматические проверки

Файлы:

- `contracts/event_identity.schema.json` — контракт canonical snapshot;
- `evals/identity/fixtures.schema.json` — JSON Schema pair/cluster fixtures;
- `evals/identity/pairs.jsonl` — 36 dev пар; `pairs.test.jsonl` — 18 test пар; `pairs.test-extra.jsonl` — 9, `pairs.test-extra-2.jsonl` — 8 и `pairs.test-security.jsonl` — 1 test пара с длинным недоверенным описанием; всего 72 пары, 12 категорий по 6; объединённый test split сохраняет покрытие всех категорий;
- `evals/identity/clusters.json` — 12 кластерных сценариев;
- `evals/identity/validate.py` — structural/semantic validator и reference cluster oracle;
- `evals/identity/README.md` — запуск, формат и ограничения.

Pair labels различают:

```json
{
  "gold": {
    "event": "same",
    "occurrence": "same"
  },
  "expected": {
    "candidate": true,
    "event_action": "review",
    "occurrence_action": "review"
  }
}
```

`gold` — истина синтетического сценария. `expected` — правильное действие по доступным доказательствам. Поэтому gold `same` может сочетаться с expected `review`.

Cluster oracle проверяет не только ожидаемые partitions, но и вычисляет их из pair decisions. Он ловит incomplete cross pairs, cannot-link внутри merge component, Event/Occurrence несовместимость и order dependence. Это не production matcher и не источник реальных метрик.

Запуск из корня репозитория:

```bash
python3 evals/identity/validate.py
python3 evals/identity/validate.py --self-test
```

При установленном `jsonschema` дополнительно выполняется полная JSON Schema validation. Стандартная библиотека обеспечивает базовые проверки и без неё. Опция `--require-jsonschema` запрещает молчаливый пропуск полной проверки.

## 17. Минимальный план внедрения после выдачи API

1. Сохранить официальные источники, их external ID semantics, timezone, status defaults и completeness.
2. Зафиксировать D-005: границы Event/Occurrence, статусы и время для каждого реального типа источника.
3. Ввести raw observations, source-key upsert и import run ledger до fuzzy matching.
4. Создать canonical Venue/Work/Production только там, где хватает доказательств; не заставлять модель выдумывать связи.
5. Запустить strong-ID baseline и измерить source upsert correctness.
6. Добавить blocking и собрать независимую разметку candidates/полных кластеров.
7. Зафиксировать D-008: evidence, vetoes, review policy и thresholds на dev.
8. Реализовать cluster commit, merge/split, redirects и аудит до публичного auto-merge.
9. Провести frozen test, order/permutation и adversarial fixtures.
10. Только затем включать probabilistic/dense features и публиковать реальные метрики с ограничениями.

## 18. Открытые решения

Этот документ предлагает baseline, но не закрывает следующие вопросы без реальных данных и команды:

- точные Event boundaries для каждого источника и категории;
- mapping источников в Work/Production/EventSeries;
- authority и независимость источников;
- source freshness policies и SLA;
- per-field source priority;
- auto-merge/review thresholds после собственной разметки;
- допустимый review budget;
- публичное представление split tombstone и redirects в REST API;
- JSON-LD projection для сеансов и компактных schedules.

## 19. Источники

### События, время и идентификаторы

- [Schema.org Event](https://schema.org/Event) — Event во времени/месте, offers, повторения как отдельные Event, workPerformed.
- [Schema.org EventSeries](https://schema.org/EventSeries) — серия событий, `superEvent`, вложенность серий.
- [Schema.org subEvent](https://schema.org/subEvent) и [superEvent](https://schema.org/superEvent) — программная иерархия.
- [Schema.org EventStatusType](https://schema.org/EventStatusType) — cancelled, postponed, rescheduled, moved online, scheduled.
- [Schema.org eventSchedule](https://schema.org/eventSchedule), [Schedule](https://schema.org/Schedule) и [exceptDate](https://schema.org/exceptDate) — расписания и исключения.
- [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html) — UID, RECURRENCE-ID, RRULE/RDATE/EXDATE, STATUS, DTEND, SEQUENCE.
- [RFC 3339, section 4.3](https://www.rfc-editor.org/rfc/rfc3339.html#section-4.3) — семантика `-00:00`.
- [RFC 9557](https://www.rfc-editor.org/rfc/rfc9557.html) — timestamp с дополнительной IANA timezone.
- Машиночитаемый релиз [Schema.org v30.1](https://raw.githubusercontent.com/schemaorg/schemaorg/v30.1/data/schema.ttl), использованный для сверки формулировок.

### Provenance и операции с идентичностью

- [W3C PROV-DM](https://www.w3.org/TR/prov-dm/) — Entity, Activity, Agent, derivation и attribution.
- [Wikidata Help: Merge](https://www.wikidata.org/wiki/Help:Merge) — источник идеи redirects и запрета переиспользования IDs; survivor-семантика Wikidata здесь не копируется, поскольку контракт использует new-ID merge.
- [MusicBrainz Merge](https://musicbrainz.org/doc/Merge) — осторожность при потенциально деструктивном merge.

### Entity resolution и оценка

- Fellegi, I. P.; Sunter, A. B. (1969), [A Theory for Record Linkage](https://doi.org/10.1080/01621459.1969.10501049).
- [Splink: Fellegi–Sunter theory](https://moj-analytical-services.github.io/splink/topic_guides/theory/fellegi_sunter.html) и [документация Splink](https://moj-analytical-services.github.io/splink/).
- Peter Christen, [A Survey of Indexing Techniques for Scalable Record Linkage and Deduplication](https://users.cecs.anu.edu.au/~christen/publications/christen2011indexing.pdf).
- Bagga, Baldwin, [Entity-Based Cross-Document Coreferencing Using the Vector Space Model](https://aclanthology.org/P98-1012.pdf) — B-cubed.
- Binette, Steorts, [(Almost) All of Entity Resolution](https://www.science.org/doi/10.1126/sciadv.abi8021).
- Binette et al., [Entity Resolution Evaluation](https://arxiv.org/pdf/2404.05622).
- [WDC Products: hard negatives и unseen entities](https://arxiv.org/abs/2301.09521).

## 20. Итог

Минимально устойчивый вариант — не «умный fuzzy merge», а восстановимая система идентичности:

```text
Work/Production → Event → Occurrence → Offer
                       ↘ Venue
RawObservation → FieldAssertion → canonical projection
Source keys → candidates → pair decisions → constrained cluster commit
IdentityOperation → merge/split history → redirects/tombstones
```

До реального каталога главная ценность — формальные границы, консервативные запреты и воспроизводимые synthetic tests. Численное качество будет заявлено только после независимой разметки реального snapshot.
