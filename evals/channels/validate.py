#!/usr/bin/env python3
"""Validate synthetic channel contracts; stdlib-first with optional jsonschema.

Exit codes: 0 = valid, 1 = validation failure, 2 = usage/environment failure.
This is a project validator, not an official OpenAPI validator or a live channel test.
"""
from __future__ import annotations

import argparse
import copy
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCENARIOS_PATH = ROOT / "evals/channels/scenarios.jsonl"
SCHEMA_PATH = ROOT / "evals/channels/scenarios.schema.json"
OPENAPI_PATH = ROOT / "contracts/public_api.openapi.json"
WIDGET_PATH = ROOT / "contracts/widget_protocol.schema.json"

PREFIX_CATEGORY = {
    "INT": "intake_revisions",
    "SRC": "search_allowlists",
    "PLN": "planning",
    "CHG": "plan_changes",
    "TGR": "telegram_callbacks",
    "DLV": "telegram_delivery",
    "WDG": "widget_protocol",
    "API": "api_semantics",
    "XCH": "cross_channel_identity",
    "SEC": "security_fallback",
}
EXPECTED_PATHS = {
    "/v1/sessions": {"post"},
    "/v1/sessions/{session_id}": {"get"},
    "/v1/sessions/{session_id}/patches": {"post"},
    "/v1/sessions/{session_id}/search-previews": {"post"},
    "/v1/occurrences/{occurrence_id}": {"get"},
    "/v1/sessions/{session_id}/comparison-previews": {"post"},
    "/v1/sessions/{session_id}/plan-previews": {"post"},
    "/v1/sessions/{session_id}/replacement-previews": {"post"},
    "/v1/sessions/{session_id}/plan-accepts": {"post"},
    "/v1/sessions/{session_id}/plan-rejections": {"post"},
    "/v1/sessions/{session_id}/plan-rechecks": {"post"},
}
INVARIANTS = {
    "no_fabricated_events", "occurrence_specific", "unknown_not_satisfied",
    "hard_constraints_backend", "soft_ranking_only", "max_three_occurrences",
    "session_patch_increments_revision", "stale_response_discarded",
    "stale_results_read_only", "result_allowlist_only", "plan_allowlist_only",
    "replacement_allowlist_only", "preview_revision_bound", "plan_revision_bound",
    "ordered_occurrence_ids_match", "original_plan_retained",
    "unaffected_plan_items_preserved", "user_confirms_plan_revision",
    "attention_until_valid_accept", "no_silent_hard_relaxation",
    "critical_constraints_not_relaxed", "callback_acknowledged",
    "opaque_callback_token", "stale_callback_no_mutation",
    "edit_failure_new_message", "text_equivalent", "idempotent_retry",
    "no_duplicate_effect", "problem_details", "sanitized_error",
    "retry_after_present", "foreign_session_not_leaked", "no_account_auto_link",
    "same_backend_contract", "widget_origin_exact", "widget_source_checked",
    "widget_schema_validated", "no_wildcard_target_origin", "no_top_navigation",
    "no_arbitrary_url", "widget_read_only", "read_only", "no_unrequested_write",
    "untrusted_content_not_executed", "no_sensitive_data",
    "llm_not_required_for_basic_search", "no_dead_controls",
    "durable_inbox_before_ack", "duplicate_update_deduplicated",
    "ordered_update_not_trusted", "slot_mapping_match", "preview_expiry_checked",
    "immutable_saved_plan", "plan_recheck_no_snapshot_mutation",
    "no_widget_session_mutation",
}
ACTIONS = {
    "create_session", "read_session", "apply_patch", "reject_patch",
    "search_preview", "discard_stale_response", "open_occurrence",
    "comparison_preview", "plan_preview", "replacement_preview", "accept_plan",
    "reject_replacement", "recheck_plan", "callback_acknowledge", "resolve_callback",
    "recover_message", "receive_webhook", "deduplicate_update", "widget_handshake",
    "widget_reject", "widget_open", "api_replay", "api_error", "api_reject",
    "channel_isolate", "structured_fallback", "refuse_action",
}
SURFACES = {"web", "telegram", "widget", "api", "all"}
EFFECTS = {
    "none", "session_updated", "preview_created", "plan_saved", "attention_set",
    "attention_retained", "message_recovered", "rejected",
}
ACKS = {"not_applicable", "required", "sent"}
PLAN_STATES = {"none", "saved", "attention"}
DATA_STATES = {"current", "stale", "partially_unknown"}
CALLBACK_SCENARIO_IDS = {f"TGR-{number:03d}" for number in range(1, 7)} | {
    "CHG-006", "DLV-004", "DLV-005",
}
HTTP_ERROR_ACTIONS = {"reject_patch", "api_reject", "api_error"}
NULLABLE_HTTP_ERROR_ACTIONS = {"widget_reject", "refuse_action"}
NON_ERROR_ACTIONS = ACTIONS - HTTP_ERROR_ACTIONS - NULLABLE_HTTP_ERROR_ACTIONS - {"recover_message", "channel_isolate"}
REJECT_STATE_ACTIONS = HTTP_ERROR_ACTIONS | NULLABLE_HTTP_ERROR_ACTIONS | {"channel_isolate"}
UNKNOWN_CONVERSIONS = {"0", "false", "free", "scheduled", "satisfied", "verified", "suitable"}


def is_json_integer(value):
    """JSON Schema integer semantics: booleans are not integers."""
    return isinstance(value, int) and not isinstance(value, bool)


def load_json(path: Path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def load_jsonl_text(text: str):
    rows, errors = [], []
    for number, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            errors.append(f"JSONL line {number}: blank lines are not allowed")
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            errors.append(f"JSONL line {number}: {exc.msg}")
            continue
        if not isinstance(row, dict):
            errors.append(f"JSONL line {number}: expected object")
        else:
            rows.append(row)
    return rows, errors


def resolve_local(document, node):
    if isinstance(node, dict) and set(node) == {"$ref"}:
        ref = node["$ref"]
        if not ref.startswith("#/"):
            raise ValueError(f"non-local ref: {ref}")
        current = document
        for part in ref[2:].split("/"):
            current = current[part.replace("~1", "/").replace("~0", "~")]
        return current
    return node


def validate_scenarios(rows, schema, jsonschema_module=None):
    errors = []
    if not isinstance(rows, list):
        return ["scenarios: expected list"]
    if len(rows) != 60:
        errors.append(f"scenarios: expected 60, got {len(rows)}")
    ids = []
    used_invariants = set()
    used_actions = set()
    required_top = {"id", "category", "surface", "given", "trigger", "expected", "forbidden", "notes"}
    required_given = {"session_revision", "result_revision", "plan_revision", "plan_state", "data_state", "backend"}
    required_expected = {"action", "http_status", "state_effect", "callback_ack", "visible", "preserved", "invariants"}
    for index, row in enumerate(rows):
        label = row.get("id", f"row[{index}]") if isinstance(row, dict) else f"row[{index}]"
        if not isinstance(row, dict):
            errors.append(f"{label}: expected object")
            continue
        if set(row) != required_top:
            errors.append(f"{label}: top-level keys differ from required contract")
        rid = row.get("id")
        if not isinstance(rid, str) or not re.fullmatch(r"(INT|SRC|PLN|CHG|TGR|DLV|WDG|API|XCH|SEC)-00[1-6]", rid):
            errors.append(f"{label}: invalid id")
            continue
        ids.append(rid)
        prefix = rid.split("-")[0]
        if row.get("category") != PREFIX_CATEGORY[prefix]:
            errors.append(f"{rid}: category/prefix mismatch")
        surface = row.get("surface")
        if not isinstance(surface, str) or surface not in SURFACES:
            errors.append(f"{rid}: invalid surface")
        trigger = row.get("trigger")
        if not isinstance(trigger, str) or not trigger:
            errors.append(f"{rid}: trigger must be a non-empty string")
        notes = row.get("notes")
        if not isinstance(notes, str) or not notes:
            errors.append(f"{rid}: notes must be a non-empty string")
        given, expected = row.get("given"), row.get("expected")
        if not isinstance(given, dict) or not isinstance(expected, dict):
            errors.append(f"{rid}: given/expected must be objects")
            continue
        if set(given) != required_given:
            errors.append(f"{rid}: given keys differ from required contract")
        if set(expected) != required_expected:
            errors.append(f"{rid}: expected keys differ from required contract")
        if given.get("backend") != "synthetic_contract":
            errors.append(f"{rid}: backend must be synthetic_contract")
        session_revision = given.get("session_revision")
        if not is_json_integer(session_revision) or session_revision < 0:
            errors.append(f"{rid}: session_revision must be an integer >= 0")
        for field in ("result_revision", "plan_revision"):
            value = given.get(field)
            if value is not None and (not is_json_integer(value) or value < 1):
                errors.append(f"{rid}: {field} must be null or an integer >= 1")
        plan_state = given.get("plan_state")
        if not isinstance(plan_state, str) or plan_state not in PLAN_STATES:
            errors.append(f"{rid}: invalid durable plan_state; draft is only a UI projection")
        data_state = given.get("data_state")
        if not isinstance(data_state, str) or data_state not in DATA_STATES:
            errors.append(f"{rid}: invalid data_state")
        plan_revision = given.get("plan_revision")
        if plan_state == "none" and plan_revision is not None:
            errors.append(f"{rid}: plan_state=none requires plan_revision=null")
        if isinstance(plan_state, str) and plan_state in {"saved", "attention"} and (not is_json_integer(plan_revision) or plan_revision < 1):
            errors.append(f"{rid}: {plan_state} requires plan_revision>=1")
        action = expected.get("action")
        action_valid = isinstance(action, str) and action in ACTIONS
        if not action_valid:
            errors.append(f"{rid}: invalid action")
        else:
            used_actions.add(action)
        state_effect = expected.get("state_effect")
        if not isinstance(state_effect, str) or state_effect not in EFFECTS:
            errors.append(f"{rid}: invalid state_effect")
        callback_ack = expected.get("callback_ack")
        if not isinstance(callback_ack, str) or callback_ack not in ACKS:
            errors.append(f"{rid}: invalid callback_ack")
        status = expected.get("http_status")
        status_valid = status is None or (is_json_integer(status) and 100 <= status <= 599)
        if not status_valid:
            errors.append(f"{rid}: http_status must be null or an integer from 100 to 599")
        inv = expected.get("invariants")
        visible = expected.get("visible")
        preserved = expected.get("preserved")
        forbidden = row.get("forbidden")
        arrays = {"invariants": inv, "visible": visible, "preserved": preserved, "forbidden": forbidden}
        arrays_valid = True
        for field, values in arrays.items():
            if not isinstance(values, list):
                errors.append(f"{rid}: {field} must be an array")
                arrays_valid = False
                continue
            if any(not isinstance(value, str) or not value for value in values):
                errors.append(f"{rid}: {field} items must be non-empty strings")
                arrays_valid = False
                continue
            if len(set(values)) != len(values):
                errors.append(f"{rid}: {field} items must be unique")
        if not arrays_valid:
            continue
        if not inv:
            errors.append(f"{rid}: invariants must contain at least one controlled value")
        unknown = set(inv) - INVARIANTS
        if unknown:
            errors.append(f"{rid}: uncontrolled invariants {sorted(unknown)}")
        used_invariants.update(inv)

        # Callback semantics are bound to controlled scenario IDs, never trigger wording.
        if rid in CALLBACK_SCENARIO_IDS:
            if callback_ack not in {"required", "sent"}:
                errors.append(f"{rid}: callback requires acknowledgement")
            if not any(value.startswith("callback_ack:") for value in visible):
                errors.append(f"{rid}: callback acknowledgement must be visible")
            if "callback_acknowledged" not in inv:
                errors.append(f"{rid}: callback requires callback_acknowledged invariant")

        # HTTP rejection/success and state-effect coupling is independent of free-form text.
        if status_valid and action_valid:
            if status is not None and action in NON_ERROR_ACTIONS and not 200 <= status < 300:
                errors.append(f"{rid}: successful action {action} requires 2xx or null HTTP status")
            if action in HTTP_ERROR_ACTIONS and (status is None or not 400 <= status <= 599):
                errors.append(f"{rid}: rejected API action {action} requires a concrete 4xx/5xx HTTP status")
            if status is not None and action in NULLABLE_HTTP_ERROR_ACTIONS and not 400 <= status <= 599:
                errors.append(f"{rid}: refused action {action} requires 4xx/5xx or null HTTP status")
            if status is not None and action == "recover_message" and not (200 <= status < 300 or status == 429):
                errors.append(f"{rid}: recover_message allows only 2xx, 429 or null HTTP status")
            if status is not None and state_effect == "rejected" and not 400 <= status <= 599:
                errors.append(f"{rid}: rejected state effect requires 4xx/5xx or null HTTP status")
            if action in REJECT_STATE_ACTIONS and state_effect != "rejected":
                errors.append(f"{rid}: rejected action {action} cannot claim a durable or recovery state effect")
            if state_effect == "rejected" and action not in REJECT_STATE_ACTIONS:
                errors.append(f"{rid}: successful action {action} cannot use rejected state effect")
        if action_valid and action == "recover_message" and state_effect not in {"message_recovered", "none"}:
            errors.append(f"{rid}: recover_message cannot claim durable session/plan mutation")

        if action == "reject_replacement":
            if state_effect != "attention_retained":
                errors.append(f"{rid}: reject must retain attention")
            for required_inv in ("original_plan_retained", "user_confirms_plan_revision", "attention_until_valid_accept"):
                if required_inv not in inv:
                    errors.append(f"{rid}: reject missing {required_inv}")
            if "plan_state: saved" not in forbidden:
                errors.append(f"{rid}: reject must forbid silent saved")
        if "stale_response_discarded" in inv and state_effect != "none":
            errors.append(f"{rid}: stale response cannot mutate state")
        if "unknown_not_satisfied" in inv:
            explicit_unknown_conversion = False
            for value in forbidden:
                match = re.fullmatch(r"unknown_rendered_as:\s*(\S+)", value, re.IGNORECASE)
                if match and match.group(1).lower() in UNKNOWN_CONVERSIONS:
                    explicit_unknown_conversion = True
                    break
            if not explicit_unknown_conversion:
                errors.append(f"{rid}: unknown scenario needs exact forbidden marker unknown_rendered_as: <conversion>")
        if action == "apply_patch" and "session_patch_increments_revision" in inv:
            if state_effect != "session_updated":
                errors.append(f"{rid}: accepted patch must update session state")
        if "no_widget_session_mutation" in inv and state_effect in {"session_updated", "plan_saved"}:
            errors.append(f"{rid}: widget cannot mutate a session/plan")
        if status == 429:
            retry_marker = any(
                re.fullmatch(r"retry[-_]after\s*:\s*(present|honored|scheduled|\d+)", value.strip(), re.IGNORECASE)
                for value in visible
            )
            if "retry_after_present" not in inv or not retry_marker:
                errors.append(f"{rid}: 429 requires retry_after invariant and exact Retry-After/retry_after marker")
        if rid == "API-004" and status != 404:
            errors.append("API-004: foreign session must return 404")
        if action == "widget_handshake":
            for required_inv in ("widget_origin_exact", "widget_source_checked", "widget_schema_validated", "widget_read_only", "no_widget_session_mutation"):
                if required_inv not in inv:
                    errors.append(f"{rid}: valid widget handshake missing {required_inv}")
        if action == "widget_open":
            for required_inv in ("widget_origin_exact", "widget_source_checked", "widget_schema_validated", "widget_read_only", "no_arbitrary_url"):
                if required_inv not in inv:
                    errors.append(f"{rid}: valid widget open missing {required_inv}")
        if "no_wildcard_target_origin" in inv and rid == "WDG-002":
            if "targetOrigin: *" not in forbidden:
                errors.append("WDG-002: wildcard must be explicitly forbidden")
        if "ordered_occurrence_ids_match" in inv and rid.startswith("CHG") and "slot_mapping_match" not in inv:
            errors.append(f"{rid}: ordered IDs require slot mapping validation")
    duplicates = [value for value, count in Counter(ids).items() if count > 1]
    if duplicates:
        errors.append(f"duplicate scenario IDs: {duplicates}")
    counts = Counter(rid.split("-")[0] for rid in ids)
    for prefix in PREFIX_CATEGORY:
        if counts[prefix] != 6:
            errors.append(f"{prefix}: expected 6 scenarios, got {counts[prefix]}")
        expected_ids = {f"{prefix}-{number:03d}" for number in range(1, 7)}
        if not expected_ids.issubset(set(ids)):
            errors.append(f"{prefix}: missing IDs {sorted(expected_ids - set(ids))}")
    missing_invariants = INVARIANTS - used_invariants
    if missing_invariants:
        errors.append(f"controlled invariants not exercised: {sorted(missing_invariants)}")
    missing_actions = ACTIONS - used_actions
    if missing_actions:
        errors.append(f"controlled actions not exercised: {sorted(missing_actions)}")
    if jsonschema_module is not None:
        validator = jsonschema_module.Draft202012Validator(schema, format_checker=jsonschema_module.FormatChecker())
        for error in validator.iter_errors(rows):
            path = "/".join(str(part) for part in error.absolute_path)
            errors.append(f"schema {path}: {error.message}")
    return errors

def validate_openapi(document, jsonschema_module=None, deep=False):
    errors = []
    if not isinstance(document, dict):
        return ["OpenAPI: expected object"]
    if document.get("openapi") != "3.1.0":
        errors.append("OpenAPI: version must be 3.1.0")

    def object_field(container, key, label):
        value = container.get(key, {})
        if not isinstance(value, dict):
            errors.append(f"{label}: expected object")
            return {}
        return value

    paths = object_field(document, "paths", "OpenAPI paths")
    actual_paths = {}
    for path, methods in paths.items():
        if isinstance(methods, dict):
            actual_paths[path] = set(methods)
        else:
            errors.append(f"OpenAPI path {path}: expected path-item object")
    if actual_paths != EXPECTED_PATHS:
        errors.append(f"OpenAPI: path/method surface mismatch: {actual_paths}")
    forbidden_path = re.compile(r"admin|purchase|booking|payment|account-link|merge|split|/chat", re.I)
    for path in paths:
        if forbidden_path.search(path):
            errors.append(f"OpenAPI: forbidden path {path}")
    components = object_field(document, "components", "OpenAPI components")
    schemas = object_field(components, "schemas", "OpenAPI component schemas")
    operation_ids = []
    for path, methods in paths.items():
        if not isinstance(methods, dict):
            continue
        for method, operation in methods.items():
            label = f"{method.upper()} {path}"
            if not isinstance(operation, dict):
                errors.append(f"{label}: expected operation object")
                continue
            operation_ids.append(operation.get("operationId"))
            if method == "post":
                raw_params = operation.get("parameters", [])
                if not isinstance(raw_params, list):
                    errors.append(f"{label}: parameters must be an array")
                    raw_params = []
                params = []
                for index, item in enumerate(raw_params):
                    try:
                        resolved = resolve_local(document, item)
                    except (ValueError, KeyError, TypeError) as exc:
                        errors.append(f"{label}: parameter {index} cannot be resolved: {exc}")
                        continue
                    if not isinstance(resolved, dict):
                        errors.append(f"{label}: parameter {index} must resolve to an object")
                        continue
                    params.append(resolved)
                idem = [item for item in params if item.get("name") == "Idempotency-Key"]
                if len(idem) != 1 or idem[0].get("required") is not True:
                    errors.append(f"{label}: required Idempotency-Key missing")
                if "requestBody" not in operation:
                    errors.append(f"{label}: requestBody missing")
            responses = operation.get("responses", {})
            if not isinstance(responses, dict):
                errors.append(f"{label}: responses must be an object")
                responses = {}
            for status, response in responses.items():
                if not isinstance(status, str) or not status.isdigit():
                    continue
                if not isinstance(response, dict):
                    errors.append(f"{label} {status}: expected response object")
                    continue
                code = int(status)
                if code == 412:
                    errors.append(f"{label}: 412 is not part of body-revision contract")
                if code >= 400:
                    content = response.get("content", {})
                    if not isinstance(content, dict) or "application/problem+json" not in content:
                        errors.append(f"{label} {status}: application/problem+json missing")
                    else:
                        media = content["application/problem+json"]
                        if not isinstance(media, dict):
                            errors.append(f"{label} {status}: Problem media type must be an object")
                        else:
                            example = media.get("example")
                            if isinstance(example, dict) and example.get("status") != code:
                                errors.append(f"{label} {status}: Problem.status differs from HTTP status")
                if code == 422 and response.get("description") != "Unprocessable Content":
                    errors.append(f"{label}: 422 must be named Unprocessable Content")
                headers = response.get("headers", {})
                retry_after = headers.get("Retry-After", {}) if isinstance(headers, dict) else {}
                if code == 429 and (not isinstance(retry_after, dict) or retry_after.get("required") is not True):
                    errors.append(f"{label}: 429 requires Retry-After")
            security = operation.get("security", [])
            if not isinstance(security, list):
                errors.append(f"{label}: security must be an array")
                security = []
            uses_widget = any(isinstance(rule, dict) and "WidgetCapability" in rule for rule in security)
            if uses_widget and not (path == "/v1/occurrences/{occurrence_id}" and method == "get"):
                errors.append(f"{label}: WidgetCapability allowed outside public occurrence GET")
    if any(not isinstance(value, str) or not value for value in operation_ids) or len(operation_ids) != len(set(operation_ids)):
        errors.append("OpenAPI: operationId values must be present, unique strings")

    comparison_schema = schemas.get("ComparisonPreviewRequest", {})
    if not isinstance(comparison_schema, dict):
        comparison_schema = {}
    comparison_properties = comparison_schema.get("properties", {})
    if not isinstance(comparison_properties, dict):
        comparison_properties = {}
    comparison = comparison_properties.get("occurrence_ids", {})
    if not isinstance(comparison, dict) or comparison.get("minItems") != 2 or comparison.get("maxItems") != 3:
        errors.append("OpenAPI: comparison occurrence_ids must have minItems=2/maxItems=3")
    accept = schemas.get("PlanAcceptRequest", {})
    if not isinstance(accept, dict):
        accept = {}
    accept_required = accept.get("required", [])
    if not isinstance(accept_required, list):
        accept_required = []
    accept_properties = accept.get("properties", {})
    if not isinstance(accept_properties, dict):
        accept_properties = {}
    for field in ("occurrence_ids", "slot_mapping", "preview_revision", "expected_session_revision", "base_plan_revision"):
        if field not in accept_required or field not in accept_properties:
            errors.append(f"OpenAPI: PlanAcceptRequest missing {field}")
    snapshot = schemas.get("SessionSnapshot", {})
    snapshot_properties = snapshot.get("properties", {}) if isinstance(snapshot, dict) else {}
    plan_state = snapshot_properties.get("plan_state", {}) if isinstance(snapshot_properties, dict) else {}
    durable_states = plan_state.get("enum", []) if isinstance(plan_state, dict) else []
    if durable_states != ["none", "saved", "attention"]:
        errors.append("OpenAPI: durable plan_state must be none/saved/attention; draft is UI projection")
    for name, schema in schemas.items():
        if not isinstance(schema, dict):
            errors.append(f"OpenAPI schema {name}: expected object")
            continue
        if schema.get("type") == "object" and schema.get("additionalProperties") is not False:
            errors.append(f"OpenAPI schema {name}: additionalProperties must be false")
    if jsonschema_module is not None:
        for name, schema in schemas.items():
            try:
                jsonschema_module.Draft202012Validator.check_schema(schema)
            except Exception as exc:
                errors.append(f"OpenAPI schema {name}: {exc}")
        if deep:
            try:
                errors.extend(validate_inline_examples(document, jsonschema_module))
            except (ValueError, KeyError, TypeError, AttributeError) as exc:
                errors.append(f"OpenAPI inline examples cannot be validated: {exc}")
    return errors

def count_inline_examples(document):
    count = 0
    def walk(node):
        nonlocal count
        if isinstance(node, dict):
            if "example" in node and isinstance(node.get("schema"), dict):
                count += 1
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)
    walk(document)
    return count


def validate_inline_examples(document, jsonschema_module):
    errors = []
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        resolver = jsonschema_module.RefResolver.from_schema(document)
    def walk(node, path="$"):
        if isinstance(node, dict):
            if "example" in node and isinstance(node.get("schema"), dict):
                validator = jsonschema_module.Draft202012Validator(
                    node["schema"], resolver=resolver,
                    format_checker=jsonschema_module.FormatChecker(),
                )
                for error in validator.iter_errors(node["example"]):
                    errors.append(f"example {path}: {error.message}")
            for key, value in node.items():
                walk(value, f"{path}/{key}")
        elif isinstance(node, list):
            for index, value in enumerate(node):
                walk(value, f"{path}/{index}")
    walk(document)
    return errors


def validate_widget(schema, jsonschema_module=None):
    errors = []
    if not isinstance(schema, dict):
        return ["widget: expected schema object"]

    def object_field(container, key, label):
        value = container.get(key, {})
        if not isinstance(value, dict):
            errors.append(f"{label}: expected object")
            return {}
        return value

    if schema.get("additionalProperties") is not False:
        errors.append("widget: root additionalProperties must be false")
    properties = object_field(schema, "properties", "widget properties")
    protocol = properties.get("protocol", {})
    if not isinstance(protocol, dict) or protocol.get("const") != "afisha-curator-widget":
        errors.append("widget: wrong protocol const")
    version = properties.get("version", {})
    if not isinstance(version, dict) or version.get("const") != 1:
        errors.append("widget: wrong version const")
    allowed = {"init", "ping", "ready", "request_resize", "open_occurrence", "error"}
    type_schema = properties.get("type", {})
    raw_types = type_schema.get("enum", []) if isinstance(type_schema, dict) else []
    if not isinstance(raw_types, list) or any(not isinstance(value, str) for value in raw_types):
        errors.append("widget: message type enum must be an array of strings")
        raw_types = []
    types = set(raw_types)
    if types != allowed:
        errors.append(f"widget: message type surface mismatch {sorted(types)}")
    forbidden_types = {"acceptPlan", "purchase", "booking", "patch", "merge", "split", "telemetry", "top_navigation"}
    if types & forbidden_types:
        errors.append(f"widget: forbidden message types {sorted(types & forbidden_types)}")
    definitions = object_field(schema, "$defs", "widget $defs")
    for name, definition in definitions.items():
        if not isinstance(definition, dict):
            errors.append(f"widget $defs/{name}: expected object")
            continue
        if definition.get("type") == "object" and definition.get("additionalProperties") is not False:
            errors.append(f"widget $defs/{name}: additionalProperties must be false")
    ready = definitions.get("ready", {})
    if not isinstance(ready, dict):
        errors.append("widget: ready definition must be an object")
        ready = {}
    ready_properties = ready.get("properties", {})
    if not isinstance(ready_properties, dict):
        ready_properties = {}
    occurrence_ids = ready_properties.get("occurrence_ids", {})
    if not isinstance(occurrence_ids, dict):
        occurrence_ids = {}
    ready_required = ready.get("required", [])
    if not isinstance(ready_required, list):
        ready_required = []
    if "occurrence_ids" not in ready_required or occurrence_ids.get("uniqueItems") is not True:
        errors.append("widget: ready must expose unique occurrence_ids")
    open_payload = definitions.get("open", {})
    if not isinstance(open_payload, dict):
        errors.append("widget: open definition must be an object")
        open_payload = {}
    open_properties = open_payload.get("properties", {})
    if not isinstance(open_properties, dict) or set(open_properties) != {"occurrence_id"}:
        errors.append("widget: open_occurrence payload must contain only occurrence_id")

    def inspect_keys(node, path="$"):
        if isinstance(node, dict):
            for key, value in node.items():
                if key in {"properties", "$defs"} and isinstance(value, dict):
                    for field, child in value.items():
                        if field.lower() in {"token", "access_token", "url", "session_id", "admin_token", "targetorigin"}:
                            errors.append(f"widget: forbidden payload/property field {field} at {path}")
                        inspect_keys(child, f"{path}/{field}")
                else:
                    inspect_keys(value, f"{path}/{key}")
        elif isinstance(node, list):
            for index, value in enumerate(node):
                inspect_keys(value, f"{path}/{index}")
    inspect_keys(schema)
    if jsonschema_module is not None:
        try:
            jsonschema_module.Draft202012Validator.check_schema(schema)
        except Exception as exc:
            errors.append(f"widget schema: {exc}")
    return errors

def validate_all(rows, schema, openapi, widget, jsonschema_module=None, deep=False):
    errors = []
    errors.extend(validate_scenarios(rows, schema, jsonschema_module))
    errors.extend(validate_openapi(openapi, jsonschema_module, deep=deep))
    errors.extend(validate_widget(widget, jsonschema_module))
    return errors


def self_tests(rows, schema, openapi, widget, jsonschema_module):
    results = []
    clean_errors = validate_all(rows, schema, openapi, widget, jsonschema_module, deep=False)
    results.append(("clean control", not clean_errors, clean_errors[:2]))
    malformed_rows, malformed_errors = load_jsonl_text('{"id":"INT-001"}\nnot-json\n')
    results.append(("malformed JSONL", bool(malformed_errors), malformed_errors[:2]))
    cases = []
    def scenario_case(name, rid, mutate):
        def apply(data):
            row = next(item for item in data["rows"] if item["id"] == rid)
            mutate(row)
        cases.append((name, "rows", apply))
    def openapi_case(name, mutate):
        cases.append((name, "openapi", lambda data: mutate(data["openapi"])))
    def widget_case(name, mutate):
        cases.append((name, "widget", lambda data: mutate(data["widget"])))
    scenario_case("duplicate scenario ID", "INT-001", lambda row: row.update(id="INT-002"))
    scenario_case("wrong category count", "INT-001", lambda row: row.update(id="SRC-001"))
    scenario_case("none with plan revision", "INT-001", lambda row: row["given"].update(plan_revision=1))
    scenario_case("attention without revision", "CHG-001", lambda row: row["given"].update(plan_state="attention", plan_revision=None))
    scenario_case("callback without ack", "TGR-001", lambda row: row["expected"].update(callback_ack="not_applicable"))
    scenario_case("callback without visible ack", "TGR-001", lambda row: row["expected"].update(visible=[]))
    scenario_case("reject returns saved", "CHG-006", lambda row: row["expected"].update(state_effect="plan_saved"))
    scenario_case("reject loses attention invariant", "CHG-006", lambda row: row["expected"]["invariants"].remove("attention_until_valid_accept"))
    scenario_case("uncontrolled invariant", "INT-001", lambda row: row["expected"]["invariants"].append("invented_invariant"))
    scenario_case("stale response mutates", "SRC-003", lambda row: row["expected"].update(state_effect="preview_created"))
    scenario_case("wildcard no longer forbidden", "WDG-002", lambda row: row["forbidden"].remove("targetOrigin: *"))
    scenario_case("valid widget loses source check", "WDG-001", lambda row: row["expected"]["invariants"].remove("widget_source_checked"))
    scenario_case("429 loses retry metadata", "API-006", lambda row: row["expected"].update(visible=[]))
    scenario_case("foreign session becomes visible", "API-004", lambda row: row["expected"].update(http_status=200))
    scenario_case("accepted patch has no effect", "INT-001", lambda row: row["expected"].update(state_effect="none"))

    def conceal_callback(row):
        row["trigger"] = "Button press is valid but editing the original summary fails"
        row["expected"].update(
            callback_ack="not_applicable",
            visible=[value for value in row["expected"]["visible"] if not value.startswith("callback_ack:")],
        )
        row["expected"]["invariants"].remove("callback_acknowledged")

    scenario_case("reworded callback loses acknowledgement", "DLV-004", conceal_callback)
    scenario_case("unknown conversion uses lookalike marker", "PLN-006", lambda row: row.update(forbidden=["occ_100_treated_as_unknown_ok"]))
    scenario_case("rejected patch returns HTTP 200", "INT-002", lambda row: row["expected"].update(http_status=200))
    scenario_case("accepted patch returns HTTP 409", "INT-001", lambda row: row["expected"].update(http_status=409))
    scenario_case("429 has misleading retry metadata", "API-006", lambda row: row["expected"].update(visible=["retry: never"]))
    scenario_case("draft treated as durable state", "INT-001", lambda row: row["given"].update(plan_state="draft", plan_revision=99))
    scenario_case("empty invariant list", "INT-001", lambda row: row["expected"].update(invariants=[]))
    scenario_case("duplicate visible marker", "INT-001", lambda row: row["expected"]["visible"].append(row["expected"]["visible"][0]))
    scenario_case("extra given key", "INT-001", lambda row: row["given"].update(unexpected=True))
    scenario_case("empty trigger", "INT-001", lambda row: row.update(trigger=""))
    scenario_case("out of range HTTP status", "INT-001", lambda row: row["expected"].update(http_status=999))
    scenario_case("string HTTP status", "INT-001", lambda row: row["expected"].update(http_status="200"))
    scenario_case("boolean session revision", "INT-001", lambda row: row["given"].update(session_revision=True))
    scenario_case("non-string plan state does not crash", "INT-001", lambda row: row["given"].update(plan_state=[]))
    scenario_case("API rejection loses concrete HTTP status", "INT-002", lambda row: row["expected"].update(http_status=None))
    scenario_case("rejected API action claims mutation", "API-002", lambda row: row["expected"].update(state_effect="session_updated"))
    scenario_case("successful action claims rejection", "SRC-004", lambda row: row["expected"].update(state_effect="rejected"))
    scenario_case("message recovery has unbounded error status", "DLV-004", lambda row: row["expected"].update(http_status=500))
    scenario_case("message recovery claims durable mutation", "DLV-004", lambda row: row["expected"].update(state_effect="session_updated"))
    openapi_case("non-local OpenAPI parameter ref", lambda doc: doc["paths"]["/v1/sessions/{session_id}/patches"]["post"]["parameters"].append({"$ref": "https://example.com/parameter"}))
    openapi_case("non-object OpenAPI parameter", lambda doc: doc["paths"]["/v1/sessions/{session_id}/patches"]["post"]["parameters"].append("broken"))
    widget_case("non-object widget definition", lambda doc: doc["$defs"].update(ready=None))
    openapi_case("comparison allows four", lambda doc: doc["components"]["schemas"]["ComparisonPreviewRequest"]["properties"]["occurrence_ids"].update(maxItems=4))
    openapi_case("POST loses idempotency", lambda doc: doc["paths"]["/v1/sessions/{session_id}/patches"]["post"].update(parameters=[{"$ref": "#/components/parameters/SessionId"}]))
    openapi_case("forbidden admin path", lambda doc: doc["paths"].update({"/v1/admin/merge": {"post": copy.deepcopy(doc["paths"]["/v1/sessions"]["post"])}}))
    openapi_case("Problem status mismatch", lambda doc: doc["paths"]["/v1/sessions"]["post"]["responses"]["409"]["content"]["application/problem+json"]["example"].update(status=200))
    openapi_case("widget can accept plan", lambda doc: doc["paths"]["/v1/sessions/{session_id}/plan-accepts"]["post"].update(security=[{"WidgetCapability": []}]))
    widget_case("widget write type", lambda doc: doc["properties"]["type"]["enum"].append("acceptPlan"))
    widget_case("widget ready loses allowlist", lambda doc: doc["$defs"]["ready"]["required"].remove("occurrence_ids"))
    for name, target, mutate in cases:
        data = {"rows": copy.deepcopy(rows), "openapi": copy.deepcopy(openapi), "widget": copy.deepcopy(widget)}
        try:
            mutate(data)
            errors = validate_all(data["rows"], schema, data["openapi"], data["widget"], jsonschema_module, deep=False)
            results.append((name, bool(errors), errors[:2]))
        except Exception as exc:
            results.append((name, False, [f"self-test harness exception: {exc}"]))
    return results


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--require-jsonschema", action="store_true", help="Fail if jsonschema is unavailable")
    parser.add_argument("--self-test", action="store_true", help="Run clean control, malformed JSONL and controlled corruptions")
    args = parser.parse_args(argv)
    try:
        import jsonschema as jsonschema_module
    except ImportError:
        jsonschema_module = None
    if args.require_jsonschema and jsonschema_module is None:
        print("ERROR: --require-jsonschema requested but jsonschema is unavailable", file=sys.stderr)
        return 2
    try:
        schema = load_json(SCHEMA_PATH)
        openapi = load_json(OPENAPI_PATH)
        widget = load_json(WIDGET_PATH)
        text = SCENARIOS_PATH.read_text(encoding="utf-8")
    except (OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: cannot load contracts: {exc}", file=sys.stderr)
        return 2
    rows, errors = load_jsonl_text(text)
    try:
        errors.extend(validate_all(rows, schema, openapi, widget, jsonschema_module, deep=True))
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        errors.append(f"malformed contract caused a validation exception: {exc}")
    if errors:
        print(f"FAIL: {len(errors)} validation errors")
        for error in errors[:80]:
            print(f"- {error}")
        if len(errors) > 80:
            print(f"- … {len(errors) - 80} more")
        return 1
    print("OK: 60 scenarios; 10 categories × 6; 55 controlled invariants; 11 API operations; widget protocol v1")
    if jsonschema_module is None:
        print("INFO: jsonschema unavailable; external JSON Schema/example validation skipped (stdlib structural and project semantic checks passed)")
    else:
        print(f"OK: JSON Schema and {count_inline_examples(openapi)} inline OpenAPI examples validated")
    if args.self_test:
        results = self_tests(rows, schema, openapi, widget, jsonschema_module)
        failed = [(name, details) for name, passed, details in results if not passed]
        for name, passed, details in results:
            print(f"{'PASS' if passed else 'FAIL'}: {name}" + ("" if passed else f" — {details}"))
        if failed:
            print(f"SELF-TEST FAIL: {len(results) - len(failed)}/{len(results)} checks passed")
            return 1
        print(f"SELF-TEST OK: {len(results)}/{len(results)} checks passed ({len(results) - 2} corruptions + malformed JSONL + clean control)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(2)
