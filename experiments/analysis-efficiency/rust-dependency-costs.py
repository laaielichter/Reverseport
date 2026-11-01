"""Count completed Rust questions; tokenizer estimates are not model usage."""
import argparse
import hashlib
import json
from pathlib import Path

import tiktoken


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def inspect(path, encoding):
    report = json.loads((path / "report.json").read_text())
    catalog = json.loads((path / "catalog.json").read_text())
    transcript = json.loads((path / "transcript.json").read_text())
    log = path.with_suffix(".log")
    scope = next(json.loads(line) for line in reversed(log.read_text().splitlines())
                 if line.startswith('{"resource_scope":'))
    observed = scope.get("payload_resource_observation") or {}
    events = observed.get("resource_events", {})
    memory = events.get("memory.events", {})
    assert (report["status"] == "passed" and not report["cleanup_failures"]
            and not report["receipt_failures"] and scope["abort"] is None
            and scope.get("payload_resource_observation_verified") is True
            and observed.get("payload_cleanup_verified") is True
            and observed.get("payload_exit_code") == 0
            and all(memory.get(key) == 0 for key in ["high", "max", "oom", "oom_kill"])
            and events.get("pids.events", {}).get("max") == 0), path
    assert [event["name"] for event in transcript] == [
        "inspect_rust_binary", "export_evidence_bundle"]
    count = lambda value: len(encoding.encode(value, disallowed_special=()))
    schema_fields = ["name", "description", "inputSchema"]
    tool_tokens = lambda tools: count(compact([
        {key: tool[key] for key in schema_fields} for tool in tools]))
    inputs = tool_tokens(catalog["tools"])
    selected = tool_tokens([tool for tool in catalog["tools"] if tool["name"] in [
        "inspect_rust_binary", "export_evidence_bundle"]])
    arguments = sum(count(compact({"name": event["name"], "arguments": event["input"]}))
                    for event in transcript)
    replies = sum(count(block["text"]) for event in transcript
                  for block in event["reply"]["content"] if block["type"] == "text")
    return {"case": path.name, "lane": report["lane"],
            "answer": report["answer"], "parent_evidence_id": report["parent_evidence_id"],
            "artifact_sha256": report["artifact_sha256"],
            "complete_result_sha256": report["normalized_sha256"],
            "catalog_sha256": report["catalog_sha256"],
            "catalog_tools": report["catalog_tools"], "calls": report["calls"],
            "wall_seconds": scope["elapsed_seconds"],
            "cpu_seconds": observed["cpu_stat"]["usage_usec"] / 1e6,
            "kernel_family_peak_bytes": observed["memory_peak_bytes"],
            "events_at_payload_exit": events,
            "final_whole_scope_events": scope.get("resource_events_final"),
            "completed_with_verified_cleanup": True,
            "token_proxy": {"input_catalog_once": inputs, "arguments": arguments,
                            "text_replies": replies, "combined": inputs + arguments + replies,
                            "only_two_selected_tools": selected + arguments + replies,
                            "complete_transport_catalog": count(compact(catalog))},
            "sha256": {file.name: hashlib.sha256(file.read_bytes()).hexdigest()
                       for file in [path / "report.json", path / "catalog.json",
                                    path / "transcript.json", log]}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("cases", type=Path, nargs="+")
    args = parser.parse_args()
    encoding = tiktoken.get_encoding("cl100k_base")
    receipt = {"tiktoken": tiktoken.__version__, "encoding": encoding.name,
               "actual_model_usage": None,
               "projection": "All discovered tool descriptions/input schemas once, plus every call argument and text reply including export. Selected-two-tool and complete transport catalog costs are separate. No model, host injection, history replay or retry observed.",
               "recordings": [inspect(path, encoding) for path in args.cases]}
    args.output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
