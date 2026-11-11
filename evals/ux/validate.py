#!/usr/bin/env python3
"""Валидатор UX regression suite (scenarios.jsonl) для research Issue #9.

Проверяет текстовые/структурные контрактные fixtures поведения UI
(Web + Telegram, общий backend). Не запускает UI и не измеряет usability.

Использование:
    python3 validate.py [--file PATH] [--schema PATH]
                        [--require-jsonschema] [--self-test]

Зависимости: только stdlib; jsonschema опциональна
(--require-jsonschema делает её обязательной).
Коды выхода: 0 — всё валидно (и self-test прошёл, если запрошен);
             1 — ошибки валидации / self-test;
             2 — ошибка ввода-вывода или конфигурации.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_FILE = BASE_DIR / "scenarios.jsonl"
DEFAULT_SCHEMA = BASE_DIR / "scenarios.schema.json"

# ---------------------------------------------------------------------------
# Controlled vocabulary (единственный источник истины; schema-файл
# сверяется с ним на согласованность).
# ---------------------------------------------------------------------------

CATEGORIES = {
    "intake_editing": "INT",
    "clarification": "CLR",
    "results_cards": "RES",
    "empty_relaxation": "EMP",
    "comparison": "CMP",
    "planning": "PLN",
    "plan_changes": "CHG",
    "errors_fallback": "ERR",
    "accessibility": "ACC",
    "safety_trust": "SEC",
}

SURFACES = {"web", "telegram", "both"}

STATES = {
    "new", "editing", "clarifying", "loading", "results", "empty",
    "comparing", "plan", "plan_attention", "error", "fallback",
}

ACTIONS = {
    "render_input", "ask_clarification", "update_constraints", "render_loading",
    "render_results", "render_empty", "preview_relaxation", "render_comparison",
    "render_plan", "show_plan_revision", "show_error", "render_fallback",
    "render_source_details", "reject_untrusted_action",
}

INVARIANTS = {
    # обязательный набор (см. README)
    "no_fabricated_events", "no_silent_hard_relaxation",
    "preserve_unmentioned_constraints", "backend_counts_only",
    "unknown_not_satisfied", "source_and_freshness_visible",
    "occurrence_specific", "no_overlap", "budget_rechecked", "age_rechecked",
    "unaffected_plan_items_preserved", "user_confirms_plan_revision",
    "original_plan_retained", "read_only", "untrusted_content_not_executed",
    "keyboard_operable", "focus_managed", "status_announcement",
    "text_equivalent", "no_color_only_status", "no_dead_controls",
    "llm_not_required_for_basic_search", "no_unrequested_write",
    "no_sensitive_data",
    # дополнительные
    "buffers_marked_as_assumptions", "no_invented_winner",
    "unknown_rendered_as_unspecified", "idempotent_retry",
    "stale_output_marked", "callback_expiry_graceful",
    "critical_constraints_not_relaxed", "callback_acknowledged",
}

A11Y_INVARIANTS = {
    "keyboard_operable", "focus_managed", "status_announcement",
    "text_equivalent", "no_color_only_status",
}

SAFETY_INVARIANTS = {
    "read_only", "untrusted_content_not_executed",
    "no_unrequested_write", "no_sensitive_data",
}

EXPECTED_COUNT = 60
EXPECTED_PER_CATEGORY = 6

ID_RE = re.compile(r"^(INT|CLR|RES|EMP|CMP|PLN|CHG|ERR|ACC|SEC)-(\d{3})$")

# Строковые конвенции (задокументированы в README.md).
MARKER_REASON = "reason:"
MARKER_CONSTRAINTS = "constraints:"
MARKER_CONFIRM = "confirm:"
MARKER_ALT = ("alt:", "label:")
MARKER_STATUS = "status:"
MARKER_CALLBACK_ACK = "callback_ack:"
UNKNOWN_TEXT = "не указано"


# ---------------------------------------------------------------------------
# Загрузка
# ---------------------------------------------------------------------------

def load_jsonl_text(text):
    """Парсит JSONL; возвращает (items, errors). Ошибки — graceful."""
    items, errors = [], []
    for lineno, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as exc:
            errors.append(f"строка {lineno}: невалидный JSON ({exc.msg})")
            continue
        if not isinstance(obj, dict):
            errors.append(f"строка {lineno}: ожидался JSON-объект, получен {type(obj).__name__}")
            continue
        items.append((lineno, obj))
    return items, errors


# ---------------------------------------------------------------------------
# Структурные проверки (работают и без jsonschema)
# ---------------------------------------------------------------------------

def _is_nonempty_str(value):
    return isinstance(value, str) and bool(value.strip())


def _check_str_list(value, *, min_items, unique, label, sid, errors):
    if not isinstance(value, list):
        errors.append(f"{sid}: поле {label} должно быть массивом строк")
        return
    if len(value) < min_items:
        errors.append(f"{sid}: поле {label} должно содержать минимум {min_items} элем.")
    for item in value:
        if not _is_nonempty_str(item):
            errors.append(f"{sid}: поле {label} содержит пустую или нестроковую запись")
            break
    if unique and len(value) != len(set(map(str, value))):
        errors.append(f"{sid}: поле {label} содержит дубликаты")


def structural_item_errors(obj, sid):
    """Ручной аналог JSON Schema: типы, обязательные поля, controlled enums."""
    errors = []
    required = ["id", "category", "surface", "given", "trigger",
                "expected", "forbidden", "notes"]
    for key in required:
        if key not in obj:
            errors.append(f"{sid}: отсутствует обязательное поле «{key}»")
    if errors:
        return errors  # дальнейшие проверки бессмысленны

    if not isinstance(obj["id"], str) or not ID_RE.match(obj["id"]):
        errors.append(f"{sid}: id не соответствует шаблону PREFIX-NNN")
    if obj["category"] not in CATEGORIES:
        errors.append(f"{sid}: неизвестная category «{obj['category']}»")
    if obj["surface"] not in SURFACES:
        errors.append(f"{sid}: неизвестный surface «{obj['surface']}»")
    if not _is_nonempty_str(obj["trigger"]):
        errors.append(f"{sid}: trigger должен быть непустой строкой")
    if not isinstance(obj["notes"], str):
        errors.append(f"{sid}: notes должен быть строкой")

    given = obj["given"]
    if not isinstance(given, dict) or "state" not in given or "backend" not in given:
        errors.append(f"{sid}: given должен содержать state и backend")
    else:
        if given["state"] not in STATES:
            errors.append(f"{sid}: неизвестный given.state «{given['state']}»")
        if not _is_nonempty_str(given["backend"]):
            errors.append(f"{sid}: given.backend должен быть непустой строкой")

    exp = obj["expected"]
    exp_required = ["action", "visible", "preserved", "focus", "announcement", "invariants"]
    if not isinstance(exp, dict) or any(k not in exp for k in exp_required):
        errors.append(f"{sid}: expected должен содержать поля {exp_required}")
    else:
        if exp["action"] not in ACTIONS:
            errors.append(f"{sid}: неизвестный expected.action «{exp['action']}»")
        _check_str_list(exp["visible"], min_items=1, unique=True,
                        label="expected.visible", sid=sid, errors=errors)
        _check_str_list(exp["preserved"], min_items=0, unique=True,
                        label="expected.preserved", sid=sid, errors=errors)
        _check_str_list(exp["invariants"], min_items=1, unique=True,
                        label="expected.invariants", sid=sid, errors=errors)
        if isinstance(exp["invariants"], list):
            for inv in exp["invariants"]:
                if inv not in INVARIANTS:
                    errors.append(f"{sid}: неизвестный invariant «{inv}» "
                                  f"(допустимые перечислены в README)")
        if exp["focus"] is not None and not isinstance(exp["focus"], str):
            errors.append(f"{sid}: expected.focus должен быть строкой или null")
        if exp["announcement"] is not None and not isinstance(exp["announcement"], str):
            errors.append(f"{sid}: expected.announcement должен быть строкой или null")

    _check_str_list(obj["forbidden"], min_items=1, unique=True,
                    label="forbidden", sid=sid, errors=errors)
    return errors


def collection_errors(items):
    """Счётчики, уникальность id, покрытие категорий и surfaces."""
    errors = []
    objs = [obj for _, obj in items]

    if len(objs) != EXPECTED_COUNT:
        errors.append(f"ожидается ровно {EXPECTED_COUNT} сценариев, найдено {len(objs)}")

    seen_ids = {}
    for lineno, obj in items:
        sid = obj.get("id", f"строка {lineno}")
        if not isinstance(sid, str):
            continue
        if sid in seen_ids:
            errors.append(f"{sid}: дубликат id (первая строка {seen_ids[sid]})")
        else:
            seen_ids[sid] = lineno
        match = ID_RE.match(sid)
        if match and obj.get("category") in CATEGORIES:
            if match.group(1) != CATEGORIES[obj["category"]]:
                errors.append(f"{sid}: префикс id не соответствует category "
                              f"«{obj['category']}»")

    for category, prefix in CATEGORIES.items():
        group = [o for o in objs if o.get("category") == category]
        if len(group) != EXPECTED_PER_CATEGORY:
            errors.append(f"категория {category}: ожидается {EXPECTED_PER_CATEGORY} "
                          f"сценариев, найдено {len(group)}")
        surfaces = {o.get("surface") for o in group}
        for surface in SURFACES - surfaces:
            errors.append(f"категория {category}: нет ни одного сценария "
                          f"с surface «{surface}»")
        nums = set()
        for o in group:
            m = ID_RE.match(o.get("id", ""))
            if m and m.group(1) == prefix:
                nums.add(int(m.group(2)))
        if len(group) == EXPECTED_PER_CATEGORY and nums != set(range(1, EXPECTED_PER_CATEGORY + 1)):
            errors.append(f"категория {category}: id должны быть "
                          f"{prefix}-001..{prefix}-00{EXPECTED_PER_CATEGORY} без пропусков")
    return errors


# ---------------------------------------------------------------------------
# Семантические проверки (action/category-специфичные, без механического
# требования неприменимых инвариантов ко всем строкам)
# ---------------------------------------------------------------------------

def semantic_errors(obj, sid):
    errors = []
    exp = obj["expected"]
    action = exp["action"]
    visible = exp["visible"]
    preserved = exp["preserved"]
    invariants = set(exp["invariants"])
    category = obj["category"]

    def require_invariant(inv, why):
        if inv not in invariants:
            errors.append(f"{sid}: {why} требует invariant «{inv}»")

    if action == "ask_clarification":
        if not any(v.rstrip().endswith("?") for v in visible):
            errors.append(f"{sid}: ask_clarification — в visible должен быть "
                          f"явный вопрос (строка, оканчивающаяся на «?»)")
        if not any(v.startswith(MARKER_REASON) for v in visible):
            errors.append(f"{sid}: ask_clarification — в visible должна быть "
                          f"причина уточнения (строка «{MARKER_REASON} ...»)")
        if not preserved:
            errors.append(f"{sid}: ask_clarification — preserved должен "
                          f"перечислять уже собранные условия")

    if action == "render_empty":
        require_invariant("no_silent_hard_relaxation", "render_empty")
        require_invariant("critical_constraints_not_relaxed", "render_empty")
        if not any(v.startswith(MARKER_CONSTRAINTS) for v in visible):
            errors.append(f"{sid}: render_empty — в visible должны быть исходные "
                          f"условия (строка «{MARKER_CONSTRAINTS} ...»)")

    if action == "preview_relaxation":
        require_invariant("no_silent_hard_relaxation", "preview_relaxation")
        require_invariant("backend_counts_only", "preview_relaxation")
        require_invariant("critical_constraints_not_relaxed", "preview_relaxation")
        if not any(v.startswith(MARKER_CONFIRM) for v in visible):
            errors.append(f"{sid}: preview_relaxation — нужен явный элемент "
                          f"подтверждения (строка «{MARKER_CONFIRM} ...»)")

    if action == "render_plan":
        require_invariant("no_overlap", "render_plan")
        # Сканируем только смысловые входы и ожидания, но не forbidden/notes:
        # запрет «не превышать бюджет» сам по себе не создаёт бюджетное условие.
        blob = json.dumps({
            "backend": obj["given"]["backend"],
            "trigger": obj["trigger"],
            "visible": visible,
            "preserved": preserved,
        }, ensure_ascii=False).lower()
        if "бюджет" in blob or "budget" in blob:
            require_invariant("budget_rechecked", "render_plan с упоминанием бюджета")
        if "возраст" in blob or "age" in blob:
            require_invariant("age_rechecked", "render_plan с упоминанием возраста")

    if action == "show_plan_revision":
        for inv in ("original_plan_retained", "unaffected_plan_items_preserved",
                    "user_confirms_plan_revision"):
            require_invariant(inv, "show_plan_revision")

    if action == "render_comparison":
        require_invariant("unknown_rendered_as_unspecified", "render_comparison")
        require_invariant("no_invented_winner", "render_comparison")

    if action == "render_source_details":
        require_invariant("source_and_freshness_visible", "render_source_details")

    if action == "reject_untrusted_action":
        if not invariants & {"untrusted_content_not_executed", "no_unrequested_write"}:
            errors.append(f"{sid}: reject_untrusted_action требует invariant "
                          f"«untrusted_content_not_executed» или «no_unrequested_write»")

    callback_blob = f"{obj['given']['backend']} {obj['trigger']}".lower()
    if obj["surface"] == "telegram" and "callback" in callback_blob:
        require_invariant("callback_acknowledged", "Telegram callback")
    if "callback_acknowledged" in invariants:
        if not any(v.startswith(MARKER_CALLBACK_ACK) for v in visible):
            errors.append(f"{sid}: invariant callback_acknowledged требует строку "
                          f"«{MARKER_CALLBACK_ACK} ...» в visible")

    if category == "results_cards" and action == "render_results":
        for inv in ("occurrence_specific", "source_and_freshness_visible",
                    "no_fabricated_events"):
            require_invariant(inv, "карточки результатов (RES)")

    if any(UNKNOWN_TEXT in v for v in visible):
        if not invariants & {"unknown_not_satisfied", "unknown_rendered_as_unspecified"}:
            errors.append(f"{sid}: «{UNKNOWN_TEXT}» в visible требует invariant "
                          f"«unknown_not_satisfied» или «unknown_rendered_as_unspecified»")

    if category == "accessibility" and not invariants & A11Y_INVARIANTS:
        errors.append(f"{sid}: категория accessibility требует хотя бы один "
                      f"инвариант из {sorted(A11Y_INVARIANTS)}")

    if category == "safety_trust" and not invariants & SAFETY_INVARIANTS:
        errors.append(f"{sid}: категория safety_trust требует хотя бы один "
                      f"инвариант из {sorted(SAFETY_INVARIANTS)}")

    if "focus_managed" in invariants and not _is_nonempty_str(exp["focus"]):
        errors.append(f"{sid}: invariant focus_managed требует непустой expected.focus")
    if "status_announcement" in invariants and not _is_nonempty_str(exp["announcement"]):
        errors.append(f"{sid}: invariant status_announcement требует "
                      f"непустой expected.announcement")
    if "text_equivalent" in invariants:
        if not any(v.startswith(MARKER_ALT) for v in visible):
            errors.append(f"{sid}: invariant text_equivalent требует строку "
                          f"«alt: ...» или «label: ...» в visible")
    if "no_color_only_status" in invariants:
        if not any(v.startswith(MARKER_STATUS) for v in visible):
            errors.append(f"{sid}: invariant no_color_only_status требует "
                          f"текстовый статус (строка «{MARKER_STATUS} ...») в visible")
    return errors


# ---------------------------------------------------------------------------
# JSON Schema
# ---------------------------------------------------------------------------

def schema_errors(items, schema_path, require_jsonschema):
    """Возвращает (errors, schema_active). None в errors[?] не используется."""
    try:
        import jsonschema  # noqa: PLC0415
    except ImportError:
        if require_jsonschema:
            return (["jsonschema не установлен, а задан --require-jsonschema"], False)
        return ([], False)

    try:
        schema = json.loads(Path(schema_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return ([f"не удалось прочитать schema-файл {schema_path}: {exc}"], True)

    errors = []
    # согласованность controlled vocabulary схемы и валидатора
    props = schema.get("properties", {})
    exp_props = props.get("expected", {}).get("properties", {})
    inv_enum = set(exp_props.get("invariants", {}).get("items", {}).get("enum", []))
    if inv_enum != INVARIANTS:
        errors.append("schema: enum invariants не совпадает с controlled vocabulary "
                      f"валидатора (лишние: {sorted(inv_enum - INVARIANTS)}, "
                      f"отсутствуют: {sorted(INVARIANTS - inv_enum)})")
    act_enum = set(exp_props.get("action", {}).get("enum", []))
    if act_enum != ACTIONS:
        errors.append("schema: enum action не совпадает с controlled vocabulary валидатора")
    cat_enum = set(props.get("category", {}).get("enum", []))
    if cat_enum != set(CATEGORIES):
        errors.append("schema: enum category не совпадает с controlled vocabulary валидатора")
    state_enum = set(props.get("given", {}).get("properties", {})
                     .get("state", {}).get("enum", []))
    if state_enum != STATES:
        errors.append("schema: enum given.state не совпадает с controlled vocabulary валидатора")
    surf_enum = set(props.get("surface", {}).get("enum", []))
    if surf_enum != SURFACES:
        errors.append("schema: enum surface не совпадает с controlled vocabulary валидатора")
    if errors:
        return (errors, True)

    validator = jsonschema.Draft202012Validator(schema)
    for lineno, obj in items:
        sid = obj.get("id", f"строка {lineno}") if isinstance(obj, dict) else f"строка {lineno}"
        for err in sorted(validator.iter_errors(obj), key=lambda e: list(e.absolute_path)):
            path = ".".join(map(str, err.absolute_path)) or "(корень)"
            errors.append(f"{sid}: schema: {path}: {err.message}")
    return (errors, True)


# ---------------------------------------------------------------------------
# Общий прогон
# ---------------------------------------------------------------------------

def validate_items(items, schema_path=None, require_jsonschema=False):
    """Полный набор проверок. Возвращает (errors, schema_active)."""
    errors = []
    for lineno, obj in items:
        sid = obj.get("id", f"строка {lineno}") if isinstance(obj, dict) else f"строка {lineno}"
        item_errors = structural_item_errors(obj, sid)
        errors.extend(item_errors)
        if not item_errors:
            errors.extend(semantic_errors(obj, sid))
    errors.extend(collection_errors(items))
    schema_active = False
    if schema_path is not None:
        sch_errors, schema_active = schema_errors(items, schema_path, require_jsonschema)
        errors.extend(sch_errors)
    return errors, schema_active


# ---------------------------------------------------------------------------
# Self-test: намеренные повреждения должны ловиться без traceback
# ---------------------------------------------------------------------------

def _mutate(items, func):
    data = copy.deepcopy([obj for _, obj in items])
    func(data)
    return [(i + 1, obj) for i, obj in enumerate(data)]


def _first(data, predicate):
    for obj in data:
        if predicate(obj):
            return obj
    raise AssertionError("self-test: не найден сценарий для мутации")


def self_test(items, schema_path, require_jsonschema):
    """Проверяет, что каждое повреждение ловится. Возвращает (ok, report)."""
    corruptions = []

    def drop_one(data):
        data.pop()
    corruptions.append(("удалён один сценарий (59 вместо 60)", drop_one))

    def duplicate_id(data):
        data[1]["id"] = data[0]["id"]
    corruptions.append(("дубликат id", duplicate_id))

    def bad_action(data):
        data[0]["expected"]["action"] = "teleport_user"
    corruptions.append(("недопустимый action (enum)", bad_action))

    def bad_invariant(data):
        data[0]["expected"]["invariants"] = ["invented_invariant"]
    corruptions.append(("неизвестный invariant", bad_invariant))

    def clarification_no_question(data):
        target = _first(data, lambda o: o["expected"]["action"] == "ask_clarification")
        target["expected"]["visible"] = [
            v.replace("?", ".") for v in target["expected"]["visible"]
        ]
    corruptions.append(("ask_clarification без вопроса «?»", clarification_no_question))

    def empty_no_invariant(data):
        target = next(o for o in data if o["expected"]["action"] == "render_empty")
        target["expected"]["invariants"] = [
            i for i in target["expected"]["invariants"]
            if i != "no_silent_hard_relaxation"
        ] or ["no_fabricated_events"]
    corruptions.append(("render_empty без no_silent_hard_relaxation", empty_no_invariant))

    def critical_relaxation_allowed(data):
        target = next(o for o in data if o["id"] == "EMP-002")
        target["expected"]["invariants"] = [
            i for i in target["expected"]["invariants"]
            if i != "critical_constraints_not_relaxed"
        ]
    corruptions.append(("preview_relaxation без защиты критичных ограничений",
                        critical_relaxation_allowed))

    def relaxation_no_confirm(data):
        target = next(o for o in data if o["expected"]["action"] == "preview_relaxation")
        target["expected"]["visible"] = [
            v for v in target["expected"]["visible"]
            if not v.startswith(MARKER_CONFIRM)
        ] or ["Предпросмотр ослабления"]
    corruptions.append(("preview_relaxation без явного confirm", relaxation_no_confirm))

    def revision_no_confirm(data):
        target = next(o for o in data if o["expected"]["action"] == "show_plan_revision")
        target["expected"]["invariants"] = [
            i for i in target["expected"]["invariants"]
            if i != "user_confirms_plan_revision"
        ]
    corruptions.append(("show_plan_revision без user_confirms_plan_revision",
                        revision_no_confirm))

    def surfaces_collapsed(data):
        for o in data:
            if o["category"] == "accessibility":
                o["surface"] = "web"
    corruptions.append(("в категории ACC все surface = web", surfaces_collapsed))

    def prefix_mismatch(data):
        data[0]["category"] = "clarification"
    corruptions.append(("префикс id не совпадает с category", prefix_mismatch))

    def focus_managed_null(data):
        target = next(o for o in data
                      if "focus_managed" in o["expected"]["invariants"])
        target["expected"]["focus"] = None
    corruptions.append(("focus_managed при focus=null", focus_managed_null))

    def focus_managed_empty(data):
        target = next(o for o in data
                      if "focus_managed" in o["expected"]["invariants"])
        target["expected"]["focus"] = "   "
    corruptions.append(("focus_managed при пустом focus", focus_managed_empty))

    def status_announcement_empty(data):
        target = next(o for o in data
                      if "status_announcement" in o["expected"]["invariants"])
        target["expected"]["announcement"] = ""
    corruptions.append(("status_announcement при пустом announcement",
                        status_announcement_empty))

    def callback_without_ack(data):
        target = next(o for o in data
                      if "callback_acknowledged" in o["expected"]["invariants"])
        target["expected"]["visible"] = [
            v for v in target["expected"]["visible"]
            if not v.startswith(MARKER_CALLBACK_ACK)
        ]
    corruptions.append(("Telegram callback без видимого acknowledgement",
                        callback_without_ack))

    def sec_without_safety(data):
        target = next(o for o in data if o["category"] == "safety_trust")
        target["expected"]["invariants"] = [
            i for i in target["expected"]["invariants"]
            if i not in SAFETY_INVARIANTS
        ] or ["no_fabricated_events"]
    corruptions.append(("сценарий SEC без safety-инвариантов", sec_without_safety))

    def missing_field(data):
        del data[0]["expected"]
    corruptions.append(("отсутствует поле expected", missing_field))

    def empty_visible(data):
        data[0]["expected"]["visible"] = []
    corruptions.append(("пустой массив visible", empty_visible))

    report = []
    all_caught = True
    for name, func in corruptions:
        try:
            mutated = _mutate(items, func)
            errors, _ = validate_items(mutated, schema_path, require_jsonschema)
            caught = bool(errors)
        except Exception as exc:  # noqa: BLE001 — traceback недопустим
            caught = False
            errors = [f"НЕОБРАБОТАННОЕ ИСКЛЮЧЕНИЕ: {exc!r}"]
        all_caught = all_caught and caught
        report.append((name, caught, len(errors)))

    # отдельно: битый JSONL как сырой текст
    try:
        raw_items, raw_errors = load_jsonl_text('{"id": "INT-001"\nэто не json\n[]')
        caught = bool(raw_errors)
    except Exception as exc:  # noqa: BLE001
        caught = False
        raw_errors = [f"НЕОБРАБОТАННОЕ ИСКЛЮЧЕНИЕ: {exc!r}"]
    all_caught = all_caught and caught
    report.append(("malformed JSONL (битая строка и не-объект)", caught, len(raw_errors)))

    # контроль: неповреждённый набор обязан проходить
    clean_errors, _ = validate_items(items, schema_path, require_jsonschema)
    clean_ok = not clean_errors
    all_caught = all_caught and clean_ok
    report.append(("контроль: исходный файл валиден", clean_ok, len(clean_errors)))

    return all_caught, report


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Валидация UX regression suite (контрактные fixtures, "
                    "без реального UI и без UX-метрик).")
    parser.add_argument("--file", default=str(DEFAULT_FILE),
                        help="путь к scenarios.jsonl (по умолчанию рядом со скриптом)")
    parser.add_argument("--schema", default=str(DEFAULT_SCHEMA),
                        help="путь к scenarios.schema.json")
    parser.add_argument("--require-jsonschema", action="store_true",
                        help="требовать пакет jsonschema (иначе schema-проверка "
                             "пропускается с предупреждением)")
    parser.add_argument("--self-test", action="store_true",
                        help="прогнать self-test: намеренные повреждения должны "
                             "ловиться без traceback")
    args = parser.parse_args(argv)

    path = Path(args.file)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"ОШИБКА: не удалось прочитать {path}: {exc}", file=sys.stderr)
        return 2

    items, parse_errors = load_jsonl_text(text)
    errors = list(parse_errors)
    schema_active = False
    if items:
        errors_from_validation, schema_active = validate_items(
            items, args.schema, args.require_jsonschema)
        errors.extend(errors_from_validation)
    elif not parse_errors:
        errors.append("файл пуст: нет ни одного сценария")

    if errors:
        print(f"НАЙДЕНО ОШИБОК: {len(errors)}")
        for err in errors:
            print(f"  - {err}")
        return 1

    # успешный вывод с числами
    objs = [obj for _, obj in items]
    surface_counts = {s: sum(1 for o in objs if o["surface"] == s)
                      for s in sorted(SURFACES)}
    used_invariants = sorted({i for o in objs for i in o["expected"]["invariants"]})
    print(f"OK: {len(objs)} сценариев валидны")
    print(f"Категории: {len(CATEGORIES)} x {EXPECTED_PER_CATEGORY}")
    print("Surfaces: " + ", ".join(f"{k}={v}" for k, v in surface_counts.items()))
    print(f"Инварианты: использовано {len(used_invariants)} из {len(INVARIANTS)} controlled")
    print(f"JSON Schema: {'проверена' if schema_active else 'ПРОПУЩЕНА (jsonschema не установлен)'}")
    print("UX usability не измерялось: suite проверяет контракты поведения, "
          "а не удобство интерфейса.")

    if args.self_test:
        print("\nSELF-TEST:")
        ok, report = self_test(items, args.schema, args.require_jsonschema)
        for name, caught, n_errors in report:
            if name.startswith("контроль:"):
                mark = "валиден" if caught else "НЕ ВАЛИДЕН"
            else:
                mark = "поймано" if caught else "НЕ ПОЙМАНО"
            print(f"  [{'OK' if caught else 'FAIL'}] {name}: {mark} ({n_errors} ошибок)")
        if not ok:
            print("SELF-TEST ПРОВАЛЕН", file=sys.stderr)
            return 1
        print("SELF-TEST OK: все повреждения пойманы без traceback")

    return 0


if __name__ == "__main__":
    sys.exit(main())
