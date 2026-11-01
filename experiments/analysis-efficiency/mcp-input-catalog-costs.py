"""Account for catalog, complete SDK tasks and separately recorded model trials."""
import argparse
import hashlib
import json
from pathlib import Path

import tiktoken


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def resource(case):
    path = case.with_name(case.name + ".log")
    scope = next(json.loads(line) for line in reversed(path.read_text().splitlines())
                 if line.startswith('{"resource_scope":'))
    observation = scope["payload_resource_observation"]
    assert scope["abort"] is None and scope["payload_resource_observation_verified"]
    assert observation["payload_cleanup_verified"] and observation["payload_exit_code"] == 0
    assert all(observation["resource_events"]["memory.events"][key] == 0
               for key in ["high", "max", "oom", "oom_kill"])
    return {"wall_seconds": scope["elapsed_seconds"],
            "cpu_seconds": observation["cpu_stat"]["usage_usec"] / 1e6,
            "kernel_family_peak_bytes_including_page_cache": observation["memory_peak_bytes"],
            "resource_stop": scope["abort"], "cleanup_verified": True,
            "final_whole_scope_counters": scope["resource_events_final"],
            "guard_sources_sha256": scope["payload_observer_sources_sha256"],
            "log_sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def sdk(case, count):
    report = json.loads((case / "report.json").read_text())
    assert report["status"] == "passed" and report["cleanup_verified"]
    catalog = json.loads((case / "catalog.json").read_text())
    calls = json.loads((case / "transcript.json").read_text())
    inputs = [{key: tool[key] for key in ["name", "description", "inputSchema"]}
              for tool in catalog["tools"]]
    arguments = sum(count(compact({"name": call["name"], "arguments": call["arguments"]}))
                    for call in calls)
    text = sum(count(block["text"]) for call in calls for block in call["reply"]["content"]
               if block["type"] == "text")
    return {"case": case.name, "kind": "SDK", "profile": report["profile"],
            "artifact_sha256": report["artifact_sha256"],
            "tool_count": len(catalog["tools"]), "calls": report["calls"],
            "parent_evidence_id": report["parent_evidence_id"],
            "parent_semantic_sha256": report["parent_semantic_sha256"],
            "token_estimates": {"input_catalog_once": count(compact(inputs)),
                                "arguments": arguments, "text_replies": text,
                                "whole_task": count(compact(inputs)) + arguments + text,
                                "raw_catalog_including_output_schemas": count(compact(catalog))},
            "actual_model_usage": None, **resource(case),
            "receipt_sha256": {name: hashlib.sha256((case / name).read_bytes()).hexdigest()
                               for name in ["report.json", "catalog.json", "transcript.json"]}}


def model(case):
    summary = json.loads((case / "summary.json").read_text())
    assert summary["exit_code"] == 0 and not summary["timeout"]
    assert summary["selected_artifact_bytes_unchanged"]
    assert json.loads((case / "cleanup.json").read_text())["profile_removed"]
    return {"case": case.name, "kind": "model", "client": summary["codex_version"],
            "requested_model": summary["requested_model"], "reasoning": summary["reasoning"],
            "model_identity_scope": summary["model_identity_scope"],
            "actual_model_usage": summary["usage"],
            "artifact_sha256": summary["selected_artifact_sha256_before"],
            "calls": summary["completed_mcp_calls"],
            "factual_correctness": "requires independent oracle and answer review",
            **resource(case),
            "receipt_sha256": {name: hashlib.sha256((case / name).read_bytes()).hexdigest()
                               for name in ["summary.json", "answer.txt", "events.jsonl",
                                            "trial-settings.json", "context-receipt.json"]}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("cases", type=Path, nargs="+")
    args = parser.parse_args()
    encoding = tiktoken.get_encoding("cl100k_base")
    count = lambda value: len(encoding.encode(value, disallowed_special=()))
    result = {"tokenizer": f"tiktoken {tiktoken.__version__}", "encoding": encoding.name,
              "estimate_scope": "One complete name/description/input-schema catalog, every RPC argument and text reply; raw output-schema transport counted separately. Model usage is separate and is not inferred from estimates.",
              "records": [sdk(case, count) if (case / "report.json").exists() else model(case)
                          for case in args.cases]}
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
