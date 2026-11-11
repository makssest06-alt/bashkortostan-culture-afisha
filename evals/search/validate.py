#!/usr/bin/env python3
"""Validate the query-understanding benchmark without a catalogue or model calls."""
from __future__ import annotations

import copy
import hashlib
import json
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "queries.jsonl"
SCHEMA = ROOT / "constraints.schema.json"
EXPECTED_CATEGORIES = {
    "absolute_dates", "relative_dates", "time_windows", "budget",
    "participants_age", "categories", "semantic_soft", "geo_venue",
    "typos_language", "ambiguity", "followups", "safety_invariants",
}


def parse_time(value: str) -> int:
    hours, minutes = map(int, value.split(":"))
    if not (0 <= hours <= 23 and 0 <= minutes <= 59):
        raise ValueError(value)
    return hours * 60 + minutes


def apply_patch(previous: dict, patch: dict) -> dict:
    """Patch fields are replaced atomically; unmentioned fields are preserved."""
    result = {"hard": {}, "soft": {}} if patch["reset"] else copy.deepcopy(previous)
    for path in patch["unset"]:
        section, field = path.split(".", 1)
        result.setdefault(section, {}).pop(field, None)
    for section in ("hard", "soft"):
        for field, value in patch["set"].get(section, {}).items():
            result.setdefault(section, {})[field] = copy.deepcopy(value)
    return result


def validate_constraints(constraints: dict, case_id: str, errors: list[str]) -> None:
    hard = constraints["hard"]
    if "date" in hard:
        try:
            start = date.fromisoformat(hard["date"]["from"])
            end = date.fromisoformat(hard["date"]["to"])
            if start > end:
                errors.append(f"{case_id}: date.from is after date.to")
        except (KeyError, TypeError, ValueError) as exc:
            errors.append(f"{case_id}: invalid date range: {exc}")
    if "time" in hard:
        value = hard["time"]
        try:
            if "start_from" in value and "start_to" in value:
                if parse_time(value["start_from"]) >= parse_time(value["start_to"]):
                    errors.append(f"{case_id}: empty start-time range")
            if "fits_from" in value and "fits_to" in value:
                if parse_time(value["fits_from"]) >= parse_time(value["fits_to"]):
                    errors.append(f"{case_id}: empty availability range")
            if set(value) & {"start_from", "start_to"} and set(value) & {"fits_from", "fits_to"}:
                errors.append(f"{case_id}: mixes start-time and availability semantics")
        except (TypeError, ValueError) as exc:
            errors.append(f"{case_id}: invalid time range: {exc}")
    participants = hard.get("participants", {})
    ages = participants.get("children_ages")
    count = participants.get("children_count")
    if ages is not None and count is not None and len(ages) != count:
        errors.append(f"{case_id}: children_count does not match children_ages")
    if all(key in participants for key in ("total", "adults", "children_count")):
        if participants["adults"] + participants["children_count"] != participants["total"]:
            errors.append(f"{case_id}: participant total is inconsistent")
    if ("max_total_price" in hard or "max_price_per_person" in hard) and "currency" not in hard:
        errors.append(f"{case_id}: price limit without currency")
    if hard.get("free_only") and (hard.get("max_total_price", 0) > 0 or hard.get("max_price_per_person", 0) > 0):
        errors.append(f"{case_id}: free_only conflicts with a positive price limit")


def main() -> int:
    errors: list[str] = []
    raw = DATA.read_bytes()
    rows = [json.loads(line) for line in raw.decode("utf-8").splitlines() if line.strip()]

    try:
        import jsonschema
    except ImportError:
        print("Предупреждение: пакет jsonschema не установлен; выполняются только встроенные проверки.")
    else:
        schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        validator = jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker())
        for index, row in enumerate(rows, start=1):
            for error in sorted(validator.iter_errors(row), key=lambda item: list(item.path)):
                errors.append(f"line {index} ({row.get('id', '?')}): {error.message}")

    if len(rows) != 120:
        errors.append(f"expected 120 cases, found {len(rows)}")
    ids = [row["id"] for row in rows]
    if len(ids) != len(set(ids)):
        errors.append("duplicate case ids")
    normalized_queries = [row["query"].strip().casefold() for row in rows]
    if len(normalized_queries) != len(set(normalized_queries)):
        errors.append("duplicate normalized query text")

    categories = Counter(row["category"] for row in rows)
    if set(categories) != EXPECTED_CATEGORIES:
        errors.append(f"unexpected category set: {sorted(categories)}")
    for category in sorted(EXPECTED_CATEGORIES):
        if categories[category] != 10:
            errors.append(f"{category}: expected 10 cases, found {categories[category]}")
        per_split = Counter(row["split"] for row in rows if row["category"] == category)
        if per_split != Counter({"dev": 6, "test": 4}):
            errors.append(f"{category}: expected 6 dev / 4 test, found {dict(per_split)}")
    split_totals = Counter(row["split"] for row in rows)
    if split_totals != Counter({"dev": 72, "test": 48}):
        errors.append(f"expected 72 dev / 48 test, found {dict(split_totals)}")

    family_splits: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        family_splits[row["family"]].add(row["split"])
        case_id = row["id"]
        expected = row["expected"]
        action = expected["action"]
        clarify = expected.get("clarify", [])
        if action == "clarify" and not clarify:
            errors.append(f"{case_id}: clarify action without fields")
        if action != "clarify" and clarify:
            errors.append(f"{case_id}: clarification fields with action={action}")
        if action == "out_of_scope" and (expected["hard"] or expected["soft"]):
            errors.append(f"{case_id}: out_of_scope case has search constraints")
        try:
            datetime.fromisoformat(row["reference_now"])
        except (TypeError, ValueError) as exc:
            errors.append(f"{case_id}: invalid reference_now: {exc}")
        if row["timezone"] != "Asia/Yekaterinburg":
            errors.append(f"{case_id}: unexpected timezone {row['timezone']}")
        validate_constraints(expected, case_id, errors)
        if "previous" in row:
            validate_constraints(row["previous"], case_id + "/previous", errors)

        has_patch = "patch" in expected
        has_previous = "previous" in row
        if row["category"] == "followups":
            if not (has_patch and has_previous):
                errors.append(f"{case_id}: follow-up requires previous state and patch")
            else:
                actual = apply_patch(row["previous"], expected["patch"])
                wanted = {"hard": expected["hard"], "soft": expected["soft"]}
                if actual != wanted:
                    errors.append(f"{case_id}: patch does not reproduce expected effective state")
        elif has_patch or has_previous:
            errors.append(f"{case_id}: previous/patch is allowed only in followups")
        forbidden_fields = {"occurrence_id", "event_id", "relevance", "grade", "expected_events"}
        if forbidden_fields & set(row):
            errors.append(f"{case_id}: catalogue/qrels fields are not allowed in this benchmark")

    for family, splits in sorted(family_splits.items()):
        if len(splits) != 1:
            errors.append(f"family {family} leaks across splits: {sorted(splits)}")

    if errors:
        print(f"Найдено ошибок: {len(errors)}", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    actions = Counter(row["expected"]["action"] for row in rows)
    splits = Counter(row["split"] for row in rows)
    print("Benchmark валиден: 120 запросов, 12 категорий по 10 случаев.")
    print(f"Split: {dict(sorted(splits.items()))}; families: {len(family_splits)}; leakage: 0.")
    print(f"Actions: {dict(sorted(actions.items()))}; SessionPatch: 10/10 воспроизводят effective state.")
    print(f"SHA-256: {hashlib.sha256(raw).hexdigest()}")
    print("Retrieval-метрики не вычислялись: каталог и qrels отсутствуют.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
