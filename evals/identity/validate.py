#!/usr/bin/env python3
"""Validate synthetic identity fixtures and a conservative cluster-commit oracle.

This script does not run a production matcher and does not compute real-world
precision/recall. Standard-library checks always run; full JSON Schema checks
run when jsonschema is installed.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import itertools
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from datetime import datetime

CATEGORIES = ("EXT", "TXT", "OCC", "TIM", "VEN", "WRK", "SER", "STS", "PRC", "SPR", "CFG", "SEC")
EVENT_STRONG = {
    "same_source_event_key", "same_source_occurrence_key", "same_shared_event_id",
    "same_shared_occurrence_id", "same_ical_uid_recurrence_id",
}
OCC_STRONG = {
    "same_source_occurrence_key", "same_shared_occurrence_id", "same_ical_uid_recurrence_id",
}
EVENT_VETOES = {
    "conflicting_shared_event_ids", "conflicting_productions", "conflicting_works",
    "conflicting_cities", "conflicting_canonical_venues", "parent_child_relation",
    "different_series_members", "strong_identity_conflict",
}
OCC_VETOES = EVENT_VETOES | {
    "conflicting_shared_occurrence_ids", "different_stable_occurrence_keys",
    "different_recurrence_ids", "distinct_languages", "distinct_halls",
    "time_precision_mismatch", "timezone_missing",
}


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def read_jsonl(path: Path):
    result = []
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            raise ValueError(f"{path}:{lineno}: empty JSONL line")
        value = json.loads(line)
        if not isinstance(value, dict):
            raise ValueError(f"{path}:{lineno}: pair must be an object")
        value["_lineno"] = lineno
        result.append(value)
    return result


def read_pairs(paths):
    result = []
    for path in paths:
        result.extend(read_jsonl(path))
    return result


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_partition(groups):
    return tuple(sorted(tuple(sorted(group)) for group in groups))


def pair_key(a, b):
    return tuple(sorted((a, b)))


def group_of(partition, record):
    for index, group in enumerate(partition):
        if record in group:
            return index
    return None


def same_group(partition, a, b):
    ga, gb = group_of(partition, a), group_of(partition, b)
    return ga is not None and ga == gb


def validate_json_schema(pairs, clusters_doc, schema, require_jsonschema, errors):
    try:
        import jsonschema
    except ImportError:
        message = "jsonschema не установлен: полная JSON Schema validation пропущена"
        if require_jsonschema:
            errors.append(message + "; запущен --require-jsonschema")
        return "пропущена (jsonschema не установлен)"

    try:
        jsonschema.Draft202012Validator.check_schema(schema)
        format_checker = jsonschema.FormatChecker()
        root_validator = jsonschema.Draft202012Validator(schema, format_checker=format_checker)
        # Pair JSONL uses the pair definition without the clusters root constraints.
        pair_schema = {
            "$schema": schema["$schema"],
            "$ref": "#/$defs/pairCase",
            "$defs": schema["$defs"],
        }
        pair_validator = jsonschema.Draft202012Validator(pair_schema, format_checker=format_checker)
        for error in root_validator.iter_errors(clusters_doc):
            errors.append("JSON Schema clusters: " + error.message)
        for pair in pairs:
            clean = {k: v for k, v in pair.items() if k != "_lineno"}
            for error in pair_validator.iter_errors(clean):
                errors.append(f"JSON Schema {pair.get('case_id', '?')}: {error.message}")
        from importlib.metadata import PackageNotFoundError, version
        try:
            package_version = version("jsonschema")
        except PackageNotFoundError:
            package_version = "unknown"
        return f"проверена (jsonschema {package_version})"
    except Exception as exc:  # Schema failures must be reported, not hidden.
        errors.append(f"JSON Schema validation failed to execute: {exc}")
        return "ошибка выполнения"


def check_required_object(value, required, allowed, label, errors):
    if not isinstance(value, dict):
        errors.append(f"{label}: expected object")
        return False
    for key in required:
        if key not in value:
            errors.append(f"{label}: missing {key}")
    for key in set(value) - set(allowed) - {"_lineno"}:
        errors.append(f"{label}: unexpected property {key}")
    return not any(key not in value for key in required)


def check_observation(obs, side, case_id, schema, errors):
    definition = schema["$defs"]["observation"]
    label = f"{case_id}.{side}"
    if not check_required_object(obs, definition["required"], definition["properties"], label, errors):
        return False
    valid = True
    for field in ("record_id", "source_id", "namespace", "precision", "status"):
        if not isinstance(obs[field], str):
            errors.append(f"{label}: {field} must be a string")
            valid = False
    if not valid:
        return False
    expected_record = f"{case_id}-{'L' if side == 'left' else 'R'}"
    if obs["record_id"] != expected_record:
        errors.append(f"{label}: record_id must be {expected_record}")
    if not re.fullmatch(r"syn_src_[a-z0-9_]+", obs["source_id"]):
        errors.append(f"{label}: non-synthetic source_id")
    if not re.fullmatch(r"syn_ns_[a-z0-9_]+", obs["namespace"]):
        errors.append(f"{label}: non-synthetic namespace")
    if obs["precision"] not in schema["$defs"]["observation"]["properties"]["precision"]["enum"]:
        errors.append(f"{label}: invalid precision")
    if obs["status"] not in schema["$defs"]["observation"]["properties"]["status"]["enum"]:
        errors.append(f"{label}: invalid status")
    if not isinstance(obs["offers"], list):
        errors.append(f"{label}: offers must be an array")
        valid = False
    else:
        offer_def = schema["$defs"]["offer"]
        for index, item in enumerate(obs["offers"]):
            if not check_required_object(item, offer_def["required"], offer_def["properties"], f"{label}.offers[{index}]", errors):
                valid = False
    for prefix in ("start", "end"):
        raw = obs.get(f"{prefix}_local_raw")
        utc = obs.get(f"{prefix}_utc")
        raw_instant = parse_aware_instant(raw)
        utc_instant = parse_aware_instant(utc)
        if utc is not None and utc_instant is None:
            errors.append(f"{label}: {prefix}_utc must be an aware ISO datetime")
            valid = False
        if raw_instant is not None and utc_instant is not None and raw_instant != utc_instant:
            errors.append(f"{label}: {prefix}_local_raw does not reproduce {prefix}_utc")
            valid = False
    if (obs.get("end_utc") is None) != (obs.get("end_local_raw") is None):
        errors.append(f"{label}: end_utc and end_local_raw must be present or absent together")
        valid = False
    start_instant = parse_aware_instant(obs.get("start_utc"))
    end_instant = parse_aware_instant(obs.get("end_utc"))
    if start_instant is not None and end_instant is not None and end_instant < start_instant:
        errors.append(f"{label}: end_utc precedes start_utc")
        valid = False
    return valid


def parse_aware_instant(value):
    """Return an aware datetime, or None for naive/date-only/non-string values."""
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.utcoffset() is not None else None


def has_occurrence_identity(record):
    return bool(
        record.get("external_occurrence_id")
        or record.get("shared_occurrence_id")
        or (record.get("ical_uid") and record.get("recurrence_id"))
    )


def check_evidence_values(case, errors):
    left, right = case["left"], case["right"]
    evidence = set(case["evidence"])
    vetoes = set(case["vetoes"])

    def equal_nonnull(field):
        return left.get(field) is not None and left.get(field) == right.get(field)

    def different_nonnull(field):
        return (
            left.get(field) is not None and right.get(field) is not None
            and left.get(field) != right.get(field)
        )

    equal_rules = {
        "same_source_event_key": ("source_id", "namespace", "external_event_id"),
        "same_source_occurrence_key": ("source_id", "namespace", "external_occurrence_id"),
        "same_shared_event_id": ("namespace", "shared_event_id"),
        "same_shared_occurrence_id": ("namespace", "shared_occurrence_id"),
        "same_ical_uid": ("ical_uid",),
        "same_ical_uid_recurrence_id": ("ical_uid", "recurrence_id"),
        "same_production": ("production_id",),
        "same_work": ("work_id",),
        "same_canonical_venue": ("venue_id",),
        "same_instant": ("start_utc",),
        "same_series": ("series_id",),
    }
    for item, fields in equal_rules.items():
        if item in evidence and not all(equal_nonnull(field) for field in fields):
            errors.append(f"{case['case_id']}: evidence {item} is not reproduced by observations")
    if "source_absence_context" in evidence and not any(
        side.get("presence") is not None and side.get("presence") != "present"
        for side in (left, right)
    ):
        errors.append(f"{case['case_id']}: source_absence_context requires a non-present observation")

    conflict_rules = {
        "conflicting_shared_event_ids": "shared_event_id",
        "conflicting_shared_occurrence_ids": "shared_occurrence_id",
        "conflicting_productions": "production_id",
        "conflicting_works": "work_id",
        "conflicting_cities": "city",
        "conflicting_canonical_venues": "venue_id",
        "distinct_languages": "language",
        "distinct_halls": "hall",
    }
    for item, field in conflict_rules.items():
        if item in vetoes and not different_nonnull(field):
            errors.append(f"{case['case_id']}: veto {item} is not reproduced by observations")
    for item in ("conflicting_shared_event_ids", "conflicting_shared_occurrence_ids"):
        if item in vetoes and left.get("namespace") != right.get("namespace"):
            errors.append(f"{case['case_id']}: conflicting shared IDs must be in one namespace")

    # Hard conflicts are derived from facts, not trusted merely because a label is present.
    derived_rules = {
        "conflicting_productions": "production_id",
        "conflicting_works": "work_id",
        "conflicting_cities": "city",
    }
    for item, field in derived_rules.items():
        if item == "conflicting_cities" and all(
            side.get("event_kind") == "online_run" for side in (left, right)
        ):
            continue
        if different_nonnull(field) and item not in vetoes:
            errors.append(f"{case['case_id']}: unclaimed veto {item} derived from observations")
    if (
        different_nonnull("venue_id") and equal_nonnull("city")
        and not all(side.get("event_kind") == "online_run" for side in (left, right))
        and "conflicting_canonical_venues" not in vetoes
    ):
        errors.append(f"{case['case_id']}: unclaimed veto conflicting_canonical_venues derived from observations")
    for item, field in (
        ("conflicting_shared_event_ids", "shared_event_id"),
        ("conflicting_shared_occurrence_ids", "shared_occurrence_id"),
    ):
        if (
            left.get("namespace") == right.get("namespace")
            and different_nonnull(field) and item not in vetoes
        ):
            errors.append(f"{case['case_id']}: unclaimed veto {item} derived from observations")

    if "different_stable_occurrence_keys" in vetoes and not (
        equal_nonnull("source_id") and equal_nonnull("namespace")
        and equal_nonnull("external_event_id")
        and different_nonnull("external_occurrence_id")
    ):
        errors.append(f"{case['case_id']}: different_stable_occurrence_keys is not reproduced")
    if "different_recurrence_ids" in vetoes and not (
        equal_nonnull("ical_uid") and different_nonnull("recurrence_id")
    ):
        errors.append(f"{case['case_id']}: different_recurrence_ids requires same UID and distinct recurrence IDs")
    if "time_precision_mismatch" in vetoes and left.get("precision") == right.get("precision"):
        errors.append(f"{case['case_id']}: time_precision_mismatch is not reproduced")
    if "timezone_missing" in vetoes and left.get("timezone") is not None and right.get("timezone") is not None:
        errors.append(f"{case['case_id']}: timezone_missing is not reproduced")
    if "parent_child_relation" in vetoes and "part_of" not in {
        left.get("relation_to_other"), right.get("relation_to_other")
    }:
        errors.append(f"{case['case_id']}: parent_child_relation requires part_of")
    if "different_series_members" in vetoes and not (
        equal_nonnull("series_id") and all(
            side.get("event_kind") == "series_member" or side.get("relation_to_other") == "series_member"
            for side in (left, right)
        )
    ):
        errors.append(f"{case['case_id']}: different_series_members requires one series and two members")
    if "strong_identity_conflict" in vetoes:
        strong_positive = evidence & (EVENT_STRONG | OCC_STRONG)
        concrete_conflict = vetoes & {
            "conflicting_shared_event_ids", "conflicting_shared_occurrence_ids",
            "conflicting_productions", "conflicting_works", "conflicting_canonical_venues",
        }
        if not strong_positive or not concrete_conflict:
            errors.append(f"{case['case_id']}: strong_identity_conflict needs strong positive evidence and a concrete conflict")


def check_pair_semantics(case, errors):
    cid = case["case_id"]
    gold, expected = case["gold"], case["expected"]
    evidence, vetoes = set(case["evidence"]), set(case["vetoes"])
    ge, go = gold["event"], gold["occurrence"]
    ee, eo = expected["event_action"], expected["occurrence_action"]

    if go == "same" and ge != "same":
        errors.append(f"{cid}: same gold Occurrence implies same gold Event")
    if ge == "different" and go == "same":
        errors.append(f"{cid}: different gold Event cannot contain same gold Occurrence")
    if eo == "merge" and ee != "merge":
        errors.append(f"{cid}: occurrence merge implies event merge")
    if ee == "merge" and ge != "same":
        errors.append(f"{cid}: event merge contradicts gold")
    if eo == "merge" and go != "same":
        errors.append(f"{cid}: occurrence merge contradicts gold")
    if ee == "separate" and ge == "same":
        errors.append(f"{cid}: known same Event must be review, not evidence-based separate")
    if eo == "separate" and go == "same":
        errors.append(f"{cid}: known same Occurrence must be review, not evidence-based separate")
    if ee == "separate" and not (vetoes & EVENT_VETOES):
        errors.append(f"{cid}: event separate requires an event veto")
    if eo == "separate" and go == "different" and not (vetoes & OCC_VETOES):
        errors.append(f"{cid}: occurrence separate requires an occurrence/event veto")
    if (ee in {"merge", "review"} or eo in {"merge", "review"}) and not expected["candidate"]:
        errors.append(f"{cid}: merge/review requires candidate=true")
    if not expected["candidate"] and (ee != "separate" or eo not in {"separate", "not_applicable"}):
        errors.append(f"{cid}: candidate=false permits only separate/not_applicable")

    recurrence_event_evidence = "same_ical_uid" in evidence and "same_production" in evidence
    if ee == "merge" and not (evidence & EVENT_STRONG or recurrence_event_evidence):
        errors.append(f"{cid}: event auto-merge lacks strong identity evidence")
    if eo == "merge" and not (evidence & OCC_STRONG):
        errors.append(f"{cid}: occurrence auto-merge lacks strong identity evidence")
    if ee == "merge" and vetoes & EVENT_VETOES:
        errors.append(f"{cid}: event auto-merge conflicts with veto")
    if eo == "merge" and vetoes & OCC_VETOES:
        errors.append(f"{cid}: occurrence auto-merge conflicts with veto")
    if eo == "merge" and not all(has_occurrence_identity(side) for side in (case["left"], case["right"])):
        errors.append(f"{cid}: occurrence merge requires occurrence identity on both records")
    if ee == "review" and (evidence & EVENT_STRONG or recurrence_event_evidence) and not (vetoes & EVENT_VETOES):
        errors.append(f"{cid}: unmotivated event review despite strong evidence and no event veto")
    if eo == "review" and evidence & OCC_STRONG and not (vetoes & OCC_VETOES):
        errors.append(f"{cid}: unmotivated occurrence review despite strong evidence and no occurrence veto")

    notes = set(expected["projection_notes"])
    for side in (case["left"], case["right"]):
        if side["presence"] != "present" and "no_cancellation_inference" not in notes:
            errors.append(f"{cid}: non-present observation requires no_cancellation_inference")
        description = side.get("description") or ""
        if not isinstance(description, str):
            errors.append(f"{cid}: description must be a string or null")
            description = ""
        if ("<script" in description.lower() or "ignore previous instructions" in description.lower()
                or any(ord(char) < 32 and char not in "\n\r\t" for char in description)):
            if "sanitize_description" not in notes:
                errors.append(f"{cid}: untrusted description requires sanitize_description")
        for item in side.get("offers", []):
            if item.get("amount_minor") is None and "unknown_not_free" not in notes:
                errors.append(f"{cid}: unknown price requires unknown_not_free")
    left, right = case["left"], case["right"]
    if left.get("age_rating") and right.get("age_rating") and left["age_rating"] != right["age_rating"]:
        if "age_conflict_review" not in notes:
            errors.append(f"{cid}: conflicting age ratings require age_conflict_review")
    known_statuses = {"tentative", "scheduled", "postponed", "rescheduled", "cancelled", "moved_online"}
    if left["status"] in known_statuses and right["status"] in known_statuses and left["status"] != right["status"]:
        explained_reschedule = any(
            side["status"] == "rescheduled"
            and side.get("previous_start_local_raw") is not None
            and side.get("previous_start_local_raw") == other.get("start_local_raw")
            for side, other in ((left, right), (right, left))
        )
        if not explained_reschedule and "status_conflict_review" not in notes:
            errors.append(f"{cid}: conflicting known statuses require status_conflict_review")


def validate_pairs(pairs, schema, errors):
    pair_def = schema["$defs"]["pairCase"]
    seen_ids, seen_records = set(), set()
    families = defaultdict(set)
    family_categories = defaultdict(set)
    for case in pairs:
        cid = case.get("case_id", f"line {case.get('_lineno', '?')}")
        if not check_required_object(case, pair_def["required"], pair_def["properties"], str(cid), errors):
            continue
        if not all(isinstance(case[field], str) for field in ("case_id", "category", "split", "family_id")):
            errors.append(f"{cid}: case_id/category/split/family_id must be strings")
            continue
        if cid in seen_ids:
            errors.append(f"{cid}: duplicate case_id")
        seen_ids.add(cid)
        if not re.fullmatch(r"[A-Z]{3}-[0-9]{3}", cid):
            errors.append(f"{cid}: invalid case_id")
        elif not cid.startswith(case["category"] + "-"):
            errors.append(f"{cid}: category prefix mismatch")
        if case["synthetic"] is not True:
            errors.append(f"{cid}: synthetic must be true")
        if case["split"] not in {"dev", "test"}:
            errors.append(f"{cid}: invalid split")
        families[case["family_id"]].add(case["split"])
        family_categories[case["family_id"]].add(case["category"])

        observations_ok = True
        for side in ("left", "right"):
            observations_ok = check_observation(case[side], side, cid, schema, errors) and observations_ok
            record = case[side].get("record_id") if isinstance(case[side], dict) else None
            if isinstance(record, str):
                if record in seen_records:
                    errors.append(f"{cid}: duplicate record {record}")
                seen_records.add(record)

        lists_ok = True
        for field, definition_name in (("evidence", "evidence"), ("vetoes", "veto")):
            value = case[field]
            if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
                errors.append(f"{cid}: {field} must be an array of strings")
                lists_ok = False
            else:
                allowed = set(schema["$defs"][definition_name]["enum"])
                unknown = set(value) - allowed
                if unknown:
                    errors.append(f"{cid}: unknown {field}: {sorted(unknown)}")
                    lists_ok = False

        gold_ok = check_required_object(
            case["gold"], schema["$defs"]["gold"]["required"],
            schema["$defs"]["gold"]["properties"], cid + ".gold", errors,
        )
        expected_ok = check_required_object(
            case["expected"], schema["$defs"]["expected"]["required"],
            schema["$defs"]["expected"]["properties"], cid + ".expected", errors,
        )
        if gold_ok:
            if case["gold"]["event"] not in {"same", "different"}:
                errors.append(f"{cid}: invalid gold.event")
                gold_ok = False
            if case["gold"]["occurrence"] not in {"same", "different", "not_applicable"}:
                errors.append(f"{cid}: invalid gold.occurrence")
                gold_ok = False
        if expected_ok:
            if not isinstance(expected_notes := case["expected"]["projection_notes"], list) or not all(isinstance(note, str) for note in expected_notes):
                errors.append(f"{cid}: projection_notes must be an array of strings")
                expected_ok = False
            if case["expected"]["event_action"] not in {"merge", "separate", "review"}:
                errors.append(f"{cid}: invalid expected.event_action")
                expected_ok = False
            if case["expected"]["occurrence_action"] not in {"merge", "separate", "review", "not_applicable"}:
                errors.append(f"{cid}: invalid expected.occurrence_action")
                expected_ok = False
            if not isinstance(case["expected"]["candidate"], bool):
                errors.append(f"{cid}: expected.candidate must be boolean")
                expected_ok = False
        if observations_ok and lists_ok:
            check_evidence_values(case, errors)
        if observations_ok and lists_ok and gold_ok and expected_ok:
            check_pair_semantics(case, errors)

    if len(pairs) != 72:
        errors.append(f"pairs: expected 72, got {len(pairs)}")
    counts = Counter(case.get("category") if isinstance(case.get("category"), str) else "<invalid>" for case in pairs)
    for category in CATEGORIES:
        if counts[category] != 6:
            errors.append(f"pairs: {category} expected 6, got {counts[category]}")
        for split in ("dev", "test"):
            actual = sum(1 for case in pairs if case.get("category") == category and case.get("split") == split)
            if actual != 3:
                errors.append(f"pairs: {category}/{split} expected 3, got {actual}")
    splits = Counter(case.get("split") if isinstance(case.get("split"), str) else "<invalid>" for case in pairs)
    if splits != Counter({"dev": 36, "test": 36}):
        errors.append(f"pairs: expected dev=36/test=36, got {dict(splits)}")
    if len(families) != 48:
        errors.append(f"pairs: expected 48 families, got {len(families)}")
    for family, family_splits in families.items():
        if len(family_splits) != 1:
            errors.append(f"pairs: family {family} crosses split: {sorted(family_splits)}")
        if len(family_categories[family]) != 1:
            errors.append(f"pairs: family {family} crosses categories")


class DisjointSet:
    def __init__(self, items):
        self.parent = {item: item for item in items}

    def find(self, item):
        parent = self.parent[item]
        if parent != item:
            self.parent[item] = self.find(parent)
        return self.parent[item]

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            # Membership is canonicalized later; root choice never affects output.
            self.parent[rb] = ra


def conservative_partition(records, pairs, level, order):
    """All-or-nothing commit for positive components on a frozen snapshot."""
    action_key = "event_action" if level == "event" else "occurrence_action"
    vetoes = EVENT_VETOES if level == "event" else OCC_VETOES
    by_pair = {pair_key(pair["left"], pair["right"]): pair for pair in pairs}
    dsu = DisjointSet(order)
    for pair in pairs:
        if pair[action_key] == "merge":
            dsu.union(pair["left"], pair["right"])
    components = defaultdict(list)
    for record in order:
        components[dsu.find(record)].append(record)

    output, held = [], False
    for members in components.values():
        members = sorted(members)
        if len(members) == 1:
            output.append(members)
            continue
        safe = True
        for a, b in itertools.combinations(members, 2):
            pair = by_pair.get(pair_key(a, b))
            if pair is None or pair[action_key] != "merge" or set(pair["vetoes"]) & vetoes:
                safe = False
                break
        if safe:
            output.append(members)
        else:
            held = True
            output.extend([[record] for record in members])
    return canonical_partition(output), held


def cluster_oracle(case, order):
    records = {record["record_id"]: record for record in case["records"]}
    occurrence_order = [r for r in order if has_occurrence_identity(records[r])]
    event_partition, event_held = conservative_partition(records, case["pairs"], "event", order)
    occurrence_partition, occurrence_held = conservative_partition(records, case["pairs"], "occurrence", occurrence_order)
    review = any(
        pair["event_action"] == "review" or pair["occurrence_action"] == "review"
        for pair in case["pairs"]
    )
    resolution = "review" if review or event_held or occurrence_held else "commit"
    return {
        "resolution": resolution,
        "public_clusters": event_partition,
        "public_occurrence_clusters": occurrence_partition,
    }


def check_constraint_partition(partition, required, forbidden, label, errors):
    for a, b in required:
        if not same_group(partition, a, b):
            errors.append(f"{label}: required pair {a}-{b} is separated")
    for a, b in forbidden:
        if same_group(partition, a, b):
            errors.append(f"{label}: forbidden pair {a}-{b} is merged")


def validate_history(case, errors):
    cid = case["case_id"]
    history = case.get("history")
    expectations = case["expected"].get("redirect_resolution", [])
    if history is None:
        if expectations:
            errors.append(f"{cid}: redirect expectations require history")
        return
    if not isinstance(history, dict) or not isinstance(history.get("operations"), list) or not isinstance(history.get("redirects"), list):
        errors.append(f"{cid}: history operations/redirects must be arrays")
        return
    operations, redirects = history["operations"], history["redirects"]
    op_required = {
        "operation_id", "type", "level", "input_entity_ids", "output_entity_ids",
        "memberships_before", "memberships_after", "created_at",
    }
    for op in operations:
        if not isinstance(op, dict) or not op_required.issubset(op):
            errors.append(f"{cid}: malformed history operation")
            return
        if not all(isinstance(op.get(field), list) for field in (
            "input_entity_ids", "output_entity_ids", "memberships_before", "memberships_after"
        )):
            errors.append(f"{cid}/{op.get('operation_id', '?')}: operation ID/membership fields must be arrays")
            return
        if not all(isinstance(m, dict) and isinstance(m.get("record_ids"), list) for field in (
            "memberships_before", "memberships_after"
        ) for m in op[field]):
            errors.append(f"{cid}/{op.get('operation_id', '?')}: malformed membership")
            return
    for redirect in redirects:
        if not isinstance(redirect, dict) or not {"from_id", "to_id", "replacement_ids"}.issubset(redirect):
            errors.append(f"{cid}: malformed redirect")
            return
        if not isinstance(redirect["replacement_ids"], list):
            errors.append(f"{cid}: redirect replacements must be an array")
            return
    if not isinstance(expectations, list) or not all(
        isinstance(item, dict) and {"from_id", "terminal_id", "replacement_ids"}.issubset(item)
        for item in expectations
    ):
        errors.append(f"{cid}: malformed redirect expectations")
        return

    cluster_record_ids = {record["record_id"] for record in case["records"]}
    op_ids, prior_outputs, prior_memberships = set(), set(), []
    live_memberships = {}
    retired_ids = set()
    known_entity_ids = set()
    previous_time = ""
    for op in operations:
        oid = op.get("operation_id", "?")
        if oid in op_ids:
            errors.append(f"{cid}: duplicate operation {oid}")
        op_ids.add(oid)
        if op.get("created_at", "") < previous_time:
            errors.append(f"{cid}: operations are not chronological")
        previous_time = op.get("created_at", "")
        inputs, outputs = op.get("input_entity_ids", []), op.get("output_entity_ids", [])
        before, after = op.get("memberships_before", []), op.get("memberships_after", [])
        if op.get("type") == "merge" and not (len(inputs) >= 2 and len(outputs) == 1):
            errors.append(f"{cid}/{oid}: merge arity is invalid")
        if op.get("type") == "split" and not (len(inputs) == 1 and len(outputs) >= 2):
            errors.append(f"{cid}/{oid}: split arity is invalid")
        if set(outputs) & set(inputs):
            errors.append(f"{cid}/{oid}: output entity IDs must be new and distinct from inputs")
        if set(outputs) & known_entity_ids:
            errors.append(f"{cid}/{oid}: output entity ID is reused")
        if set(inputs) & retired_ids:
            errors.append(f"{cid}/{oid}: retired entity ID is reused as an operation input")
        if {m.get("entity_id") for m in before} != set(inputs):
            errors.append(f"{cid}/{oid}: memberships_before do not match inputs")
        if {m.get("entity_id") for m in after} != set(outputs):
            errors.append(f"{cid}/{oid}: memberships_after do not match outputs")

        def membership_records(items):
            return [record for membership in items for record in membership.get("record_ids", [])]

        before_records, after_records = membership_records(before), membership_records(after)
        if len(before_records) != len(set(before_records)) or len(after_records) != len(set(after_records)):
            errors.append(f"{cid}/{oid}: duplicate record in memberships")
        if set(before_records) != set(after_records):
            errors.append(f"{cid}/{oid}: operation lost or gained records")
        if not set(before_records).issubset(cluster_record_ids):
            errors.append(f"{cid}/{oid}: membership references a record outside the cluster fixture")
        for membership in before:
            entity_id = membership.get("entity_id")
            current = set(membership.get("record_ids", []))
            if entity_id in live_memberships and current != live_memberships[entity_id]:
                errors.append(f"{cid}/{oid}: existing entity membership mutated before {entity_id}")
        if op.get("type") == "split":
            for membership in after:
                restored = set(membership.get("record_ids", []))
                if not any(restored == old for old in prior_memberships):
                    errors.append(f"{cid}/{oid}: split membership {sorted(restored)} is not restored from history")
        prior_memberships.extend(set(m.get("record_ids", [])) for m in before)
        known_entity_ids |= set(inputs) | set(outputs)
        retired_ids |= set(inputs)
        prior_outputs = (prior_outputs - set(inputs)) | set(outputs)
        for entity_id in inputs:
            live_memberships.pop(entity_id, None)
        for membership in after:
            live_memberships[membership.get("entity_id")] = set(membership.get("record_ids", []))

    redirect_map = {}
    all_entity_ids = set(known_entity_ids) | set(prior_outputs)
    for redirect in redirects:
        source = redirect.get("from_id")
        if source in redirect_map:
            errors.append(f"{cid}: duplicate redirect from {source}")
        if source not in all_entity_ids:
            errors.append(f"{cid}: redirect from unknown ID {source}")
        elif source not in retired_ids:
            errors.append(f"{cid}: redirect source is not retired: {source}")
        target = redirect.get("to_id")
        replacements = redirect.get("replacement_ids", [])
        if target == source:
            errors.append(f"{cid}: self redirect {source}")
        if target is not None and target not in all_entity_ids:
            errors.append(f"{cid}: redirect to unknown ID {target}")
        if target is None and len(replacements) < 2:
            errors.append(f"{cid}: split tombstone {source} requires at least two replacements")
        if target is not None and replacements:
            errors.append(f"{cid}: ordinary redirect {source} cannot have replacements")
        if not set(replacements).issubset(all_entity_ids):
            errors.append(f"{cid}: redirect {source} has unknown replacements")
        redirect_map[source] = redirect

    for retired in sorted(retired_ids):
        if retired not in redirect_map:
            errors.append(f"{cid}: retired input has no redirect: {retired}")

    for source in redirect_map:
        seen, current = set(), source
        while current in redirect_map and redirect_map[current].get("to_id") is not None:
            if current in seen:
                errors.append(f"{cid}: redirect cycle from {source}")
                break
            seen.add(current)
            current = redirect_map[current]["to_id"]

    def resolve(source):
        seen, current = set(), source
        while current in redirect_map:
            if current in seen:
                return None, []
            seen.add(current)
            redirect = redirect_map[current]
            if redirect.get("to_id") is None:
                return current, redirect.get("replacement_ids", [])
            current = redirect["to_id"]
        return current, []

    for source in redirect_map:
        terminal, _ = resolve(source)
        if terminal is None:
            continue
        if terminal in redirect_map and redirect_map[terminal].get("to_id") is None:
            continue
        if terminal not in prior_outputs:
            errors.append(f"{cid}: redirect {source} terminal is retired or inactive: {terminal}")

    for expected in expectations:
        terminal, replacements = resolve(expected["from_id"])
        expected_terminal = expected.get("terminal_id")
        if expected_terminal is None:
            if terminal not in redirect_map or redirect_map[terminal].get("to_id") is not None:
                errors.append(f"{cid}: {expected['from_id']} does not end at a split tombstone")
        elif terminal != expected_terminal:
            errors.append(f"{cid}: redirect {expected['from_id']} ends at {terminal}, expected {expected_terminal}")
        if set(replacements) != set(expected.get("replacement_ids", [])):
            errors.append(f"{cid}: redirect replacements mismatch for {expected['from_id']}")


def validate_cluster(case, schema, errors):
    cid = case.get("case_id", "?")
    definition = schema["$defs"]["clusterCase"]
    if not check_required_object(case, definition["required"], definition["properties"], str(cid), errors):
        return
    if not isinstance(cid, str):
        errors.append("cluster: case_id must be a string")
        return
    expected_definition = schema["$defs"]["clusterExpected"]
    if not check_required_object(case["expected"], expected_definition["required"], expected_definition["properties"], cid + ".expected", errors):
        return
    expected = case["expected"]
    if expected["resolution"] not in {"commit", "review"}:
        errors.append(f"{cid}: invalid expected resolution")
        return
    for field in ("public_clusters", "public_occurrence_clusters"):
        value = expected[field]
        if not isinstance(value, list) or not all(
            isinstance(group, list) and group and all(isinstance(record, str) for record in group)
            for group in value
        ):
            errors.append(f"{cid}: {field} must contain non-empty arrays of record strings")
            return
    for field in ("required_pairs", "forbidden_pairs", "required_occurrence_pairs", "forbidden_occurrence_pairs"):
        value = expected[field]
        if not isinstance(value, list) or not all(
            isinstance(pair, list) and len(pair) == 2 and all(isinstance(record, str) for record in pair)
            for pair in value
        ):
            errors.append(f"{cid}: {field} must contain pair arrays")
            return
    if case["synthetic"] is not True:
        errors.append(f"{cid}: synthetic must be true")
    record_definition = schema["$defs"]["clusterRecord"]
    if not isinstance(case["records"], list):
        errors.append(f"{cid}: records must be an array")
        return
    for index, record in enumerate(case["records"]):
        if not check_required_object(record, record_definition["required"], record_definition["properties"], f"{cid}.records[{index}]", errors):
            return
        if not isinstance(record["record_id"], str):
            errors.append(f"{cid}: record_id must be a string")
            return
    records = {record["record_id"]: record for record in case["records"]}
    if len(records) != len(case["records"]):
        errors.append(f"{cid}: duplicate record IDs")
        return
    record_ids = set(records)
    for record_id in record_ids:
        if not re.fullmatch(r"[a-z][a-z0-9_]*", record_id):
            errors.append(f"{cid}: invalid record ID {record_id}")
    if not isinstance(case["input_order"], list) or not all(isinstance(record, str) for record in case["input_order"]):
        errors.append(f"{cid}: input_order must be an array of strings")
        return
    if set(case["input_order"]) != record_ids or len(case["input_order"]) != len(record_ids):
        errors.append(f"{cid}: input_order is not a record permutation")
        return
    if not isinstance(case["permutations"], list):
        errors.append(f"{cid}: permutations must be an array")
        return
    valid_permutations = []
    for permutation in case["permutations"]:
        if not isinstance(permutation, list) or not all(isinstance(record, str) for record in permutation):
            errors.append(f"{cid}: permutation must be an array of strings")
        elif set(permutation) != record_ids or len(permutation) != len(record_ids):
            errors.append(f"{cid}: invalid input permutation {permutation}")
        else:
            valid_permutations.append(permutation)
    pair_definition = schema["$defs"]["clusterPair"]
    if not isinstance(case["pairs"], list):
        errors.append(f"{cid}: pairs must be an array")
        return
    for index, pair in enumerate(case["pairs"]):
        if not check_required_object(pair, pair_definition["required"], pair_definition["properties"], f"{cid}.pairs[{index}]", errors):
            return
        if not all(isinstance(pair[field], str) for field in ("left", "right", "event_action", "occurrence_action")):
            errors.append(f"{cid}: pair actions and record IDs must be strings")
            return
        if not all(isinstance(pair[field], list) and all(isinstance(item, str) for item in pair[field]) for field in ("evidence", "vetoes")):
            errors.append(f"{cid}: pair evidence/vetoes must be arrays of strings")
            return
    seen_pairs = set()
    pairs_valid = True
    for pair in case["pairs"]:
        key = pair_key(pair["left"], pair["right"])
        if pair["left"] == pair["right"] or not {pair["left"], pair["right"]}.issubset(record_ids):
            errors.append(f"{cid}: invalid pair {key}")
            pairs_valid = False
            continue
        if key in seen_pairs:
            errors.append(f"{cid}: duplicate pair {key}")
            pairs_valid = False
        seen_pairs.add(key)
        evidence, vetoes = set(pair["evidence"]), set(pair["vetoes"])
        ee, eo = pair["event_action"], pair["occurrence_action"]
        if ee not in {"merge", "separate", "review"} or eo not in {"merge", "separate", "review", "not_applicable"}:
            errors.append(f"{cid}/{key}: invalid pair action")
            pairs_valid = False
            continue
        left_record, right_record = records[pair["left"]], records[pair["right"]]
        check_evidence_values({
            "case_id": f"{cid}/{key}", "left": left_record, "right": right_record,
            "evidence": pair["evidence"], "vetoes": pair["vetoes"],
        }, errors)
        if eo == "merge" and ee != "merge":
            errors.append(f"{cid}/{key}: occurrence merge implies event merge")
        recurrence_event_evidence = "same_ical_uid" in evidence and "same_production" in evidence
        if ee == "merge" and not (evidence & EVENT_STRONG or recurrence_event_evidence):
            errors.append(f"{cid}/{key}: event merge lacks strong evidence")
        if eo == "merge" and not (evidence & OCC_STRONG):
            errors.append(f"{cid}/{key}: occurrence merge lacks strong evidence")
        if ee == "merge" and vetoes & EVENT_VETOES:
            errors.append(f"{cid}/{key}: event merge conflicts with veto")
        if eo == "merge" and vetoes & OCC_VETOES:
            errors.append(f"{cid}/{key}: occurrence merge conflicts with veto")
        if eo == "merge" and not all(has_occurrence_identity(record) for record in (left_record, right_record)):
            errors.append(f"{cid}/{key}: occurrence merge requires occurrence identity on both records")
        if ee == "separate" and not (vetoes & EVENT_VETOES):
            errors.append(f"{cid}/{key}: event separate requires an event veto")
        if eo == "separate" and not (vetoes & OCC_VETOES):
            errors.append(f"{cid}/{key}: occurrence separate requires an occurrence/event veto")
        if ee == "review" and (evidence & EVENT_STRONG or recurrence_event_evidence) and not (vetoes & EVENT_VETOES):
            errors.append(f"{cid}/{key}: unmotivated event review despite strong evidence and no event veto")
        if eo == "review" and evidence & OCC_STRONG and not (vetoes & OCC_VETOES):
            errors.append(f"{cid}/{key}: unmotivated occurrence review despite strong evidence and no occurrence veto")

    if not pairs_valid:
        validate_history(case, errors)
        return
    expected = case["expected"]
    baseline = cluster_oracle(case, case["input_order"])
    for level in ("public_clusters", "public_occurrence_clusters"):
        actual = canonical_partition(expected[level])
        if actual != baseline[level]:
            errors.append(f"{cid}: {level}={actual} != conservative oracle {baseline[level]}")
    if expected["resolution"] != baseline["resolution"]:
        errors.append(f"{cid}: resolution={expected['resolution']} != oracle {baseline['resolution']}")

    for permutation in valid_permutations:
        reordered = cluster_oracle(case, permutation)
        if reordered != baseline:
            errors.append(f"{cid}: order-dependent result for {permutation}")

    expected_events = canonical_partition(expected["public_clusters"])
    expected_occurrences = canonical_partition(expected["public_occurrence_clusters"])
    all_event_records = [r for group in expected_events for r in group]
    all_occ_records = [r for group in expected_occurrences for r in group]
    if set(all_event_records) != record_ids or len(all_event_records) != len(record_ids):
        errors.append(f"{cid}: expected Event clusters are not a partition")
    occurrence_record_ids = {r for r in record_ids if has_occurrence_identity(records[r])}
    if set(all_occ_records) != occurrence_record_ids or len(all_occ_records) != len(occurrence_record_ids):
        errors.append(f"{cid}: expected Occurrence clusters are not a partition")
    for occurrence_group in expected_occurrences:
        if not any(set(occurrence_group).issubset(event_group) for event_group in expected_events):
            errors.append(f"{cid}: Occurrence cluster {occurrence_group} crosses Event clusters")
    for pair in case["pairs"]:
        a, b = pair["left"], pair["right"]
        if pair["event_action"] in {"review", "separate"} and same_group(expected_events, a, b):
            errors.append(f"{cid}: {a}-{b} is publicly merged despite {pair['event_action']}")
        if pair["occurrence_action"] in {"review", "separate"} and same_group(expected_occurrences, a, b):
            errors.append(f"{cid}: occurrence {a}-{b} is publicly merged despite {pair['occurrence_action']}")

    check_constraint_partition(expected_events, expected["required_pairs"], expected["forbidden_pairs"], cid + "/event", errors)
    check_constraint_partition(expected_occurrences, expected["required_occurrence_pairs"], expected["forbidden_occurrence_pairs"], cid + "/occurrence", errors)
    if expected["order_invariant"] is not True:
        errors.append(f"{cid}: order_invariant must be true")
    validate_history(case, errors)


def validate_clusters(doc, schema, errors):
    if not isinstance(doc, dict) or not isinstance(doc.get("scenarios"), list):
        errors.append("clusters: root/scenarios are invalid")
        return
    if doc.get("schema_version") != "1.0.0" or doc.get("synthetic") is not True:
        errors.append("clusters: schema_version/synthetic are invalid")
    scenarios = doc["scenarios"]
    if len(scenarios) != 12:
        errors.append(f"clusters: expected 12, got {len(scenarios)}")
    seen = set()
    for case in scenarios:
        cid = case.get("case_id", "?")
        if cid in seen:
            errors.append(f"clusters: duplicate {cid}")
        seen.add(cid)
        try:
            validate_cluster(case, schema, errors)
        except Exception as exc:
            errors.append(f"{cid}: cluster case validation aborted safely: {type(exc).__name__}: {exc}")


def validate_all(pairs, clusters_doc, schema, require_jsonschema=False):
    errors = []
    schema_status = validate_json_schema(pairs, clusters_doc, schema, require_jsonschema, errors)
    try:
        validate_pairs(pairs, schema, errors)
    except Exception as exc:
        errors.append(f"pair validation aborted safely: {type(exc).__name__}: {exc}")
    try:
        validate_clusters(clusters_doc, schema, errors)
    except Exception as exc:
        errors.append(f"cluster validation aborted safely: {type(exc).__name__}: {exc}")
    return errors, schema_status



def print_summary(pairs, clusters_doc, pairs_paths, clusters_path, schema_status):
    print(
        f"Fixtures валидны: {len(pairs)} пары; "
        + ", ".join(f"{category}=6" for category in CATEGORIES)
    )
    splits = Counter(case["split"] for case in pairs)
    families = {case["family_id"] for case in pairs}
    family_splits = defaultdict(set)
    for case in pairs:
        family_splits[case["family_id"]].add(case["split"])
    leakage = sum(1 for splits_for_family in family_splits.values() if len(splits_for_family) > 1)
    print(
        f"Split: dev={splits['dev']}, test={splits['test']}; "
        f"families={len(families)}; leakage={leakage}."
    )
    print("Event actions:", dict(sorted(Counter(case["expected"]["event_action"] for case in pairs).items())))
    print("Occurrence actions:", dict(sorted(Counter(case["expected"]["occurrence_action"] for case in pairs).items())))
    print(f"Cluster scenarios: {len(clusters_doc['scenarios'])}; заявленные order permutations проверены.")
    print(f"JSON Schema: {schema_status}.")
    for pairs_path in pairs_paths:
        print(f"{pairs_path.name} SHA-256: {sha256(pairs_path)}")
    print(f"clusters.json SHA-256: {sha256(clusters_path)}")
    print("Production precision/recall и duplicate rate не вычислялись: реальный каталог и независимая разметка отсутствуют.")


def run_self_test(pairs, clusters_doc, schema, require_jsonschema):
    mutations = []

    bad_pairs = copy.deepcopy(pairs)
    target = next(case for case in bad_pairs if case["case_id"] == "OCC-001")
    target["expected"]["occurrence_action"] = "merge"
    mutations.append(("pair gold/invariant corruption", bad_pairs, clusters_doc, "occurrence merge contradicts gold"))

    bad_clusters = copy.deepcopy(clusters_doc)
    target_cluster = next(case for case in bad_clusters["scenarios"] if case["case_id"] == "CL-002")
    target_cluster["expected"]["public_clusters"] = [["a", "b", "c"]]
    target_cluster["expected"]["public_occurrence_clusters"] = [["a", "b", "c"]]
    mutations.append(("cluster cannot-link corruption", pairs, bad_clusters, "forbidden pair a-c is merged"))

    bad_order = copy.deepcopy(clusters_doc)
    target_order = next(case for case in bad_order["scenarios"] if case["case_id"] == "CL-006")
    target_order["permutations"][0] = ["a", "b", "c"]
    mutations.append(("permutation coverage corruption", pairs, bad_order, "invalid input permutation"))

    bad_nested = copy.deepcopy(pairs)
    target_nested = next(case for case in bad_nested if case["case_id"] == "EXT-001")
    del target_nested["expected"]["event_action"]
    mutations.append(("nested required field corruption", bad_nested, clusters_doc, "missing event_action"))

    bad_history = copy.deepcopy(clusters_doc)
    target_history = next(case for case in bad_history["scenarios"] if case["case_id"] == "CL-008")
    split_operation = next(op for op in target_history["history"]["operations"] if op["type"] == "split")
    split_operation["memberships_after"][0]["record_ids"] = ["a", "c"]
    split_operation["memberships_after"][1]["record_ids"] = ["b"]
    mutations.append(("split membership history corruption", pairs, bad_history, "is not restored from history"))

    bad_live_redirect = copy.deepcopy(clusters_doc)
    target_history = next(case for case in bad_live_redirect["scenarios"] if case["case_id"] == "CL-008")
    target_history["history"]["redirects"].append({
        "from_id": "syn_split_ab", "to_id": "syn_split_c", "replacement_ids": [],
    })
    mutations.append(("live entity redirect corruption", pairs, bad_live_redirect, "redirect source is not retired"))

    bad_retired_terminal = copy.deepcopy(clusters_doc)
    target_history = next(case for case in bad_retired_terminal["scenarios"] if case["case_id"] == "CL-008")
    target_history["history"]["redirects"] = [
        redirect for redirect in target_history["history"]["redirects"]
        if redirect["from_id"] != "syn_original_ab"
    ]
    mutations.append(("retired redirect terminal corruption", pairs, bad_retired_terminal, "terminal is retired or inactive"))

    bad_missing_redirect = copy.deepcopy(clusters_doc)
    target_history = next(case for case in bad_missing_redirect["scenarios"] if case["case_id"] == "CL-008")
    target_history["history"]["redirects"] = [
        redirect for redirect in target_history["history"]["redirects"]
        if redirect["from_id"] != "syn_original_a"
    ]
    mutations.append(("missing retired redirect corruption", pairs, bad_missing_redirect, "retired input has no redirect"))

    derived_mutations = (
        ("city", "city", "syn_city_unclaimed", "conflicting_cities"),
        ("Production", "production_id", "syn_prod_unclaimed", "conflicting_productions"),
        ("Work", "work_id", "syn_work_unclaimed", "conflicting_works"),
        ("canonical Venue", "venue_id", "syn_venue_unclaimed", "conflicting_canonical_venues"),
        ("shared Event ID", "shared_event_id", "syn_shared_event_unclaimed", "conflicting_shared_event_ids"),
        ("shared Occurrence ID", "shared_occurrence_id", "syn_shared_occ_unclaimed", "conflicting_shared_occurrence_ids"),
    )
    for label, field, value, veto in derived_mutations:
        mutated = copy.deepcopy(pairs)
        target = next(case for case in mutated if case["case_id"] == "EXT-001")
        if field.startswith("shared_"):
            target["left"][field] = "syn_shared_original"
        target["right"][field] = value
        mutations.append((f"unclaimed {label} conflict", mutated, clusters_doc, f"unclaimed veto {veto}"))

    bad_cluster_conflict = copy.deepcopy(clusters_doc)
    target_cluster = next(case for case in bad_cluster_conflict["scenarios"] if case["case_id"] == "CL-001")
    target_cluster["records"][2]["city"] = "syn_city_unclaimed"
    mutations.append(("cluster unclaimed city conflict", pairs, bad_cluster_conflict, "unclaimed veto conflicting_cities"))

    bad_cluster_evidence = copy.deepcopy(clusters_doc)
    target_cluster = next(case for case in bad_cluster_evidence["scenarios"] if case["case_id"] == "CL-001")
    target_cluster["records"][2]["shared_occurrence_id"] = "syn_shared_occ_broken"
    mutations.append(("cluster evidence reproduction corruption", pairs, bad_cluster_evidence, "evidence same_shared_occurrence_id is not reproduced"))

    bad_occurrence_identity = copy.deepcopy(pairs)
    target = next(case for case in bad_occurrence_identity if case["case_id"] == "EXT-001")
    target["right"]["external_occurrence_id"] = None
    mutations.append(("missing Occurrence identity corruption", bad_occurrence_identity, clusters_doc, "occurrence merge requires occurrence identity"))

    failed = False
    for name, mutated_pairs, mutated_clusters, expected_error in mutations:
        errors, _ = validate_all(mutated_pairs, mutated_clusters, schema, require_jsonschema)
        if any(expected_error in error for error in errors):
            print(f"SELF-TEST OK: {name}: поймано: {expected_error}")
        else:
            failed = True
            print(f"SELF-TEST FAIL: {name}: ожидалось: {expected_error}; errors={errors[:10]}")
    permutation_count = 0
    exhaustive_order_ok = True
    for case in clusters_doc["scenarios"]:
        baseline = cluster_oracle(case, case["input_order"])
        for order in itertools.permutations(case["input_order"]):
            permutation_count += 1
            if cluster_oracle(case, list(order)) != baseline:
                exhaustive_order_ok = False
                failed = True
                print(f"SELF-TEST FAIL: exhaustive order invariance: {case['case_id']} {order}")
                break
    if exhaustive_order_ok:
        print(f"SELF-TEST OK: exhaustive order invariance: {permutation_count} permutations")
    return not failed


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    base = Path(__file__).resolve().parent
    parser.add_argument(
        "--pairs", type=Path, nargs="+",
        default=[base / "pairs.jsonl", base / "pairs.test.jsonl", base / "pairs.test-extra.jsonl"],
        help="dev/test JSONL files; defaults load all physical split files",
    )
    parser.add_argument("--clusters", type=Path, default=base / "clusters.json")
    parser.add_argument("--schema", type=Path, default=base / "fixtures.schema.json")
    parser.add_argument("--require-jsonschema", action="store_true")
    parser.add_argument("--self-test", action="store_true", help="also validate intentionally corrupted in-memory copies")
    args = parser.parse_args(argv)

    try:
        pairs = read_pairs(args.pairs)
        clusters_doc = read_json(args.clusters)
        schema = read_json(args.schema)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"Не удалось загрузить fixtures: {exc}", file=sys.stderr)
        return 2

    errors, schema_status = validate_all(pairs, clusters_doc, schema, args.require_jsonschema)
    if errors:
        print(f"Обнаружены ошибки: {len(errors)}", file=sys.stderr)
        for error in errors[:80]:
            print(f"- {error}", file=sys.stderr)
        if len(errors) > 80:
            print(f"... ещё {len(errors) - 80}", file=sys.stderr)
        return 1

    print_summary(pairs, clusters_doc, args.pairs, args.clusters, schema_status)
    if args.self_test and not run_self_test(pairs, clusters_doc, schema, args.require_jsonschema):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
