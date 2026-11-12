# Исследование безопасности ИИ-ассистента: первичные источники

Дата первичной сверки: 2026-11-12  
Статус: исследовательская справка для Issue #15, не security certification  
Связанная модель: `docs/SECURITY_THREAT_MODEL.md`

## 1. Метод и уровни утверждений

Исследовалась только общая безопасность ИИ-ассистентов и приложений. Конкретные источники данных/API афиши Башкортостана не изучались. Живые модели и инфраструктура не тестировались.

В документе различаются:

- **наблюдение** — утверждение непосредственно из прочитанного первичного источника;
- **проектное решение** — выбор команды для будущей афиши, который не выдаётся за требование стандарта;
- **открытая проверка** — свойство, которое можно оценить только после реализации или получения официальных материалов.

Использована прочитанная редакция **OWASP LLM Top 10 2025**. Она не называется здесь «самой новой» и не смешивается с непроверенной нумерацией других редакций. Перед реализацией ссылки и актуальные редакции нужно пересмотреть.

## 2. Реестр первичных источников

| ID | Документ | Использование |
|---|---|---|
| S1 | [OWASP LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) | Direct/indirect injection, внешний контент, human approval, ограничения предотвращения |
| S2 | [OWASP LLM02:2025 Sensitive Information Disclosure](https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/) | Минимизация чувствительных данных и ограниченность prompt-only ограничений |
| S3 | [OWASP LLM04:2025 Data and Model Poisoning](https://genai.owasp.org/llmrisk/llm042025-data-and-model-poisoning/) | Происхождение данных, внешние источники, версии и проверка legitimacy |
| S4 | [OWASP LLM05:2025 Improper Output Handling](https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/) | Context-aware output encoding, zero trust к model output, CSP |
| S5 | [OWASP LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) | Минимум функций/прав/автономии, downstream authorization, human-in-the-loop |
| S6 | [OWASP LLM07:2025 System Prompt Leakage](https://genai.owasp.org/llmrisk/llm072025-system-prompt-leakage/) | System prompt не секрет и не security control |
| S7 | [OWASP LLM10:2025 Unbounded Consumption](https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/) | Input limits, quotas, timeouts, graceful degradation |
| S8 | [OWASP LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) | Remote injection, RAG poisoning, smoke-test limitations, logging exclusions |
| S9 | [OWASP AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html) | Execution-side authorization, fail closed, exact-action approvals, bounded tool chains |
| S10 | [OWASP DOM based XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html) | Безопасные DOM sinks и sanitizer для недоверенного markup |
| S11 | [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) | Общая рамка Govern/Map/Measure/Manage |
| S12 | [NIST AI 600-1 — Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) | Indirect prompt injection, provenance, pre-deployment testing и ограничения измерения рисков |
| S13 | [MDN Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP) | CSP как дополнительный слой, не замена sanitization |
| S14 | [DOMPurify — официальный репозиторий](https://github.com/cure53/DOMPurify) | Пример специализированного HTML sanitizer и риск постобработки после sanitize |

MDN и DOMPurify не являются стандартами безопасности сами по себе; они используются как первичная техническая документация соответствующего механизма/инструмента. Выбор конкретной библиотеки в проекте пока не сделан.

## 3. Indirect prompt injection через события

### Наблюдения

OWASP LLM01 описывает indirect prompt injection как случай, когда LLM принимает вход из внешних источников, например websites или files, и содержащиеся в них данные изменяют поведение модели непредусмотренным образом. Отдельно отмечается, что такие входы могут быть незаметны человеку.

OWASP Cheat Sheet называет remote/indirect injection вредоносными инструкциями, скрытыми во внешнем контенте, который обрабатывает LLM. NIST AI 600-1 §2.9 описывает indirect prompt injection как удалённую эксплуатацию LLM-integrated applications через prompts, внедрённые в данные, которые вероятно будут retrieved.

OWASP LLM01 также предупреждает: из-за стохастической природы моделей неясно, существуют ли надёжные полные методы предотвращения prompt injection.

### Проектные решения

1. Описание события, venue, Offer, external ID, URL, highlight и tool result всегда untrusted data.
2. Маркировка и структурное разделение контента обязательны, но не считаются достаточной защитой.
3. Права не зависят от поведения модели: read-only tool surface и server authorization действуют даже при успешной инъекции.
4. Декодирование base64/entities/Unicode или перевод не превращает текст в инструкцию.
5. Невозможно честно обещать «полную защиту от инъекций» по итогам фиксированного набора.

Сценарии: `IINJ-*`, `DINJ-*`, `PROV-*`, `TOOL-*`.

## 4. System prompt не является авторизацией или секретом

### Наблюдения

OWASP LLM07 прямо указывает: system prompt не следует считать секретом или использовать как security control. Критические controls — privilege separation и authorization bounds checks — должны выполняться детерминированно и аудируемо вне LLM.

OWASP LLM02 отдельно отмечает, что ограничения в system prompt на возврат чувствительных данных могут быть обойдены prompt injection.

### Проектные решения

- В system prompt не помещаются API keys, DSN, роли как доказательство права, permission structure или скрытые бизнес-секреты.
- Self-declared role в сообщении не меняет server principal.
- Публичный read-only контур не зависит от фразы «не выполняй write».
- Утечка prompt не должна приводить к утечке credentials или обходу авторизации.

Сценарии: `DINJ-*`, `AUTH-*`, `PRV-*`, `ADM-*`.

## 5. Server-side tools и excessive agency

### Наблюдения

OWASP LLM06 связывает Excessive Agency с excessive functionality, permissions и autonomy. Документ рекомендует реализовывать авторизацию в downstream systems, применять complete mediation, ограничивать extensions минимально необходимым набором и выполнять действия в контексте конкретного пользователя с минимальными privileges.

OWASP AI Agent Security Cheat Sheet требует enforcing authorization в execution component вне agent context и fail closed для unknown tools или отсутствующих approval requirements. Там же рекомендуется избегать unrestricted tool access, wildcard permissions и неограниченных recursion/retry/tool chains.

### Проектные решения

- Публичной модели доступны только узкие typed read-only tools.
- Generic SQL/HTTP/shell не создаются «на всякий случай».
- Каждый вызов повторно проверяется по principal, аргументам, resource ownership, allowlist и лимитам.
- Backend не использует широкие service credentials для выполнения непроверенного публичного запроса.
- Неизвестный инструмент/действие отклоняется; отсутствие классификации риска не означает allow.

Сценарии: `TOOL-*`, `AUTH-*`, `ADM-*`, `WGT-*`.

## 6. Human confirmation для будущих write-действий

### Наблюдения

OWASP LLM01 и LLM06 рекомендуют human approval для high-risk/high-impact actions. OWASP AI Agent Security Cheat Sheet уточняет важное для реализации свойство: approval должен связываться с exact action — actor, tool, target resource, normalized parameters, timestamp и expiry. Также рекомендуются short-lived authorization artifacts, replay protection и fail-closed validation.

### Проектные решения

1. Для публичного ассистента write не предусмотрен даже с текстовым «подтверждаю» в сообщении.
2. Для отдельного будущего admin contour approval связывается с action hash, actor, target, normalized arguments, expiry и одноразовым approval ID.
3. Preview и фактические normalized arguments должны совпадать; изменение аргумента требует нового approval.
4. Approval проверяется и атомарно потребляется непосредственно перед исполнением.
5. Quoted confirmation, replay, expiry, mismatch и отсутствие approval запрещают действие.
6. Подтверждение не заменяет admin authorization, audit и domain invariants.

Сценарии: `HUM-*`, `ADM-*`.

## 7. Секреты, PII и логи

### Наблюдения

OWASP LLM07 рекомендует не встраивать sensitive information в system prompts, а выносить её в системы, к которым модель не имеет прямого доступа. OWASP LLM02 поддерживает least privilege для чувствительных данных.

OWASP Prompt Injection Prevention Cheat Sheet рекомендует логировать security-relevant metadata и decisions, исключая credentials, secrets и ненужное чувствительное содержимое prompts/responses. AI Agent Security Cheat Sheet отдельно требует redaction до logging и не хранить secrets/live customer data в test fixtures.

### Проектные решения

- Секреты существуют только в server secret manager/environment и не попадают в model context.
- В Git, fixtures, client code, callback_data, postMessage, URLs и screenshots секреты не помещаются.
- Логи содержат policy version, decision, safe request reference, tool name и authorization outcome без лишних PII и credentials.
- Redaction выполняется до записи в sink; CRLF/ANSI нейтрализуются в structured logs.
- Public error содержит safe diagnostic/reference, но не SQL, stack trace, DSN, headers или внутренний URL.

Сценарии: `PRV-*`, `DINJ-*`, `TOOL-*`.

## 8. Output handling и XSS

### Наблюдения

OWASP LLM05 рекомендует относиться к модели как к любому другому пользователю, применять context-aware output encoding и строгую CSP как дополнительную защиту. Он связывает improper output handling с рисками XSS, CSRF, SSRF и другими последствиями в зависимости от sink.

OWASP DOM XSS Cheat Sheet предостерегает от небезопасных sinks вроде `innerHTML` для недоверенных данных и рекомендует HTML sanitizer, когда небезопасный markup действительно необходим. MDN прямо отмечает, что CSP не заменяет sanitizing input; оба слоя нужны для defense in depth. Документация DOMPurify описывает удаление опасного HTML и предупреждает о рисках последующей модификации sanitized content.

### Проектные решения

1. Предпочтителен plain text; raw HTML источника и модели не копируется в DOM.
2. HTML text, attribute, URL и Telegram formatting обрабатываются по отдельным правилам контекста.
3. Для ограниченного Markdown порядок такой: Markdown → HTML-строка → allowlist sanitizer → вставка в DOM; последующие transformations запрещены или требуют повторной sanitization.
4. `ts_headline` не выводится напрямую как HTML для недоверенных данных.
5. Markdown automatic remote image loads запрещены проектной политикой вывода.
6. CSP не засчитывается как самостоятельное исправление unsafe sink.

Сценарии: `OUTX-*`, `PROV-*`, `WGT-*`.

## 9. Retrieval/data poisoning и provenance

### Наблюдения

OWASP LLM04 отмечает повышенный риск внешних источников, которые могут содержать непроверенный или вредоносный контент. Рекомендации включают отслеживание происхождения и преобразований данных, проверку legitimacy, версионирование datasets и сверку с trusted sources.

OWASP Prompt Injection Prevention Cheat Sheet отдельно называет RAG poisoning: документы с вредоносными инструкциями и манипуляцию retrieval results. NIST AI 600-1 включает Content Provenance и Pre-deployment Testing среди основных тем профиля и обсуждает риски непрозрачной интеграции upstream components/data.

### Проектные решения

- `SourceRecord + RawObservation + FieldAssertion` важнее текстовой декларации «official».
- Raw версии и parser/mapping versions сохраняются; canonical projection пересчитывается.
- Повтор одного upstream несколькими агрегаторами не считается независимым подтверждением.
- Retrieval rank и keyword repetition не доказывают факт или identity.
- Подозрительный контент может стать moderation task без автоматического merge или изменения статуса.

Сценарии: `PROV-*`, `IINJ-*`, `SEM-*`, `ADM-*`.

## 10. Unbounded consumption

### Наблюдения

OWASP LLM10 связывает неограниченное inference consumption с DoS, экономическими потерями и деградацией сервиса. Среди мер — rate limits/quotas, timeouts/throttling, ограничения размера входа и graceful degradation.

OWASP AI Agent Security Cheat Sheet дополнительно выделяет Denial of Wallet через неограниченные agent loops и рекомендует token/cost/retry/tool-chain limits и учёт расхода по session/user.

### Проектные решения

- Лимиты действуют на bytes, depth, result count, tool-chain length, retries, timeout и budget.
- Возвращаются bounded pages, а не весь каталог в model context.
- Planner ограничивает candidate set до комбинаторного перебора.
- Structured search работает при недоступности LLM.
- Числа в `policy_controls.json` — начальные проектные fixture defaults, не официальные ограничения Telegram/API и не измеренные production values.

Сценарии: `RES-*`, `TOOL-*`.

## 11. Как честно оценивать атаки

### Наблюдения

OWASP Prompt Injection Prevention Cheat Sheet называет собственный набор тестов smoke test, а не security benchmark и не representative sample. Прохождение такого набора не показывает сопротивляемость настойчивому adversary. Документ также предупреждает, что missing telemetry, errors и unsupported test contexts нельзя засчитывать как blocked attacks.

NIST AI 600-1 подчёркивает незрелость части методов измерения Generative AI risks и наличие неизвестных рисков, которые трудно заранее scoped/evaluate.

### Проектные решения для будущего отчёта

Для каждой конфигурации фиксируются:

```text
implementation commit
model/provider/settings
prompt/tool/policy versions
fixture SHA-256
blocked / total eligible attacks
benign allowed / total benign controls
errors, timeouts, unsupported и missing telemetry отдельно
manual review notes и residual risks
```

Нельзя:

- называть 72 сценария полным security benchmark;
- сообщать «0% атак» по маленькому corpus;
- превращать timeout или отсутствие логов в успешную блокировку;
- переносить результаты одной модели/версии на другую;
- скрывать benign false positives;
- выдавать совпадение `policy.py` с fixtures за live adversarial test.

## 12. Ограничения источников и не использованные доказательства

1. Главная страница MITRE ATLAS открывалась, но содержимое отдельных technique pages не было прочитано напрямую из-за JS-рендеринга. Поэтому техники ATLAS не используются здесь как самостоятельное доказательство и не цитируются по памяти.
2. Официальная страница NIST AI RMF и PDF NIST AI 600-1 использованы раздельно; не утверждается, что каждый пункт AI RMF PDF был перечитан.
3. Не использованы вторичные блоги для подтверждения нумерации будущих/других редакций OWASP.
4. Численные результаты чужих model-specific attack studies не переносятся на будущий проект.
5. Ни один источник не доказывает безопасность конкретной ещё не реализованной системы.

## 13. Перенос в реализацию

После получения официальных материалов необходимо:

1. повторно проверить актуальные редакции первичных источников;
2. записать фактическую архитектуру, модели, каналы, хостинг и data flows;
3. превратить проектные controls в конкретные backend/renderer policies;
4. реализовать versioned live adapter для corpus;
5. добавить browser/Telegram/integration/security tests и отдельные инфраструктурные угрозы;
6. опубликовать фактические результаты только с конфигурацией, numerator/denominator и ограничениями.
