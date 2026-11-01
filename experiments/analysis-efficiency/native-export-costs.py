"""Check equivalent export questions and count explicitly projected tokenizer costs."""
import argparse
import hashlib
import json
from pathlib import Path
import statistics

import tiktoken


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def inspect(path, encoding):
    report = json.loads((path / "report.json").read_text())
    catalog = json.loads((path / "catalog.json").read_text())
    transcript = json.loads((path / "transcript.json").read_text())
    scope = next(json.loads(line) for line in reversed(path.with_suffix(".log").read_text().splitlines())
                 if line.startswith('{"resource_scope":'))
    observed = scope.get("payload_resource_observation") or {}
    events = observed.get("resource_events", {})
    assert report["status"] == "passed" and report.get("runtime_identity_sha256")
    assert not report["cleanup_failures"] and not report["receipt_failures"]
    assert scope["abort"] is None and scope.get("payload_resource_observation_verified") is True
    assert observed.get("payload_exit_code") == 0 and observed.get("payload_cleanup_verified") is True
    assert all(events.get("memory.events", {}).get(key) == 0 for key in ["high", "max", "oom", "oom_kill"])
    assert events.get("pids.events", {}).get("max") == 0
    assert len(catalog["tools"]) == 220
    count = lambda text: len(encoding.encode(text, disallowed_special=()))
    directory = [{key: tool[key] for key in ["name", "description", "inputSchema"]} for tool in catalog["tools"]]
    question = (f"For {report['artifact']['path']}, report the export count and every version/alias of "
                f"{', '.join(dict.fromkeys(row['name'] for row in report['answer']['rows']))}, including addresses, "
                "sizes, types, binding and symbol-version facts. Check that __rea_export_oracle_missing__ "
                "has no recorded match, preserve source coverage and export the complete Evidence. "
                "Report static declarations without claiming runtime execution.")
    arguments = sum(count(compact({"name": event["name"], "arguments": event["input"]})) for event in transcript)
    replies = sum(count(block["text"]) for event in transcript for block in event["reply"]["content"] if block["type"] == "text")
    inputs = count(compact(directory))
    raw_catalog = count(compact(catalog))
    task_directory = [tool for tool in directory if tool["name"] in ["inspect_native_exports", "inspect_analysis_view", "export_evidence_bundle"]]
    return {"case": path.name, "lane": report["lane"], "artifact": report["artifact"],
            "answer": report["answer"], "parent_evidence_id": report["parent_evidence_id"],
            "source_report_sha256": report["source_report_sha256"],
            "runtime_identity_sha256": report["runtime_identity_sha256"],
            "catalog_sha256": report["catalog_sha256"], "catalog_tools": len(catalog["tools"]),
            "buffer_bytes": report["buffer_bytes"], "calls": report["calls"], "phases": report["phases"],
            "wall_seconds": scope["elapsed_seconds"], "cpu_seconds": observed["cpu_stat"]["usage_usec"] / 1e6,
            "kernel_family_peak_bytes": observed["memory_peak_bytes"],
            "events_at_payload_exit": events, "payload_cleanup_verified": True,
            "final_whole_scope_events": scope.get("resource_events_final"),
            "token_proxy": {"question": count(question), "input_catalog_once": inputs, "arguments": arguments,
                            "text_replies": replies, "combined": count(question) + inputs + arguments + replies,
                            "only_three_task_tools": count(question) + count(compact(task_directory)) + arguments + replies,
                            "complete_transport_catalog": raw_catalog},
            "receipt_sha256": {file.name: hashlib.sha256(file.read_bytes()).hexdigest() for file in
                               [path / "report.json", path / "catalog.json", path / "transcript.json", path / "evidence.json", path.with_suffix(".log")]}}


def summarize(rows):
    result = {}
    for artifact in sorted({row["artifact"]["sha256"] for row in rows}):
        selected = [row for row in rows if row["artifact"]["sha256"] == artifact]
        assert len({row["parent_evidence_id"] for row in selected}) == 1
        assert len({row["source_report_sha256"] for row in selected}) == 1
        assert all(row["answer"] == selected[0]["answer"] for row in selected)
        result[artifact] = {}
        for lane in ["complete", "selected"]:
            samples = [row for row in selected if row["lane"] == lane]
            assert len(samples) == 3
            metrics = {key: [row[key] for row in samples] for key in ["wall_seconds", "cpu_seconds", "kernel_family_peak_bytes"]}
            metrics["projected_tokens"] = [row["token_proxy"]["combined"] for row in samples]
            metrics["mcp_call_count"] = [len(row["calls"]) for row in samples]
            metrics["mcp_reply_bytes"] = [sum(call["reply_bytes"] for call in row["calls"]) for row in samples]
            result[artifact][lane] = {metric: {"median": statistics.median(values), "minimum": min(values), "maximum": max(values)} for metric, values in metrics.items()}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cohort", type=Path, required=True)
    parser.add_argument("cases", type=Path, nargs="+")
    args = parser.parse_args()
    manifest = json.loads((args.cohort / "manifest.json").read_text())
    index = json.loads((args.cohort / "index.json").read_text())
    assert len(index) == 12 and all(case["exit"] == 0 and case["status"] == "passed" for case in index)
    assert {path.resolve() for path in args.cases} == {(args.cohort / case["name"]).resolve() for case in index}
    assert len(args.cases) == len(index)
    for file, digest in manifest["driver_files"].items():
        assert hashlib.sha256(Path(file).read_bytes()).hexdigest() == digest, file
    runtimes = {}
    for case in index:
        path = Path(case["runtime"]) / "runtime-identity.json"
        data = path.read_bytes()
        identity = json.loads(data)
        assert identity["source_clean"] is True
        runtimes[hashlib.sha256(data).hexdigest()] = {
            "source_revision": identity["source_revision"],
            "compiled_files": len(identity["compiled_files"]),
            "entrypoints": len(identity["entrypoints"]),
        }
    encoding = tiktoken.get_encoding("cl100k_base")
    rows = [inspect(path, encoding) for path in args.cases]
    assert all(row["runtime_identity_sha256"] in runtimes for row in rows)
    receipt = {"tiktoken": tiktoken.__version__, "encoding": encoding.name, "actual_model_usage": None,
               "cohort": manifest, "commands": index, "runtime_identities": runtimes,
               "projection": "Scripted SDK tasks, not an actual model run. The estimate includes a fixed task description, every discovered tool name/description/input schema once, every tool argument and text reply, including Evidence export. Complete raw SDK directory token costs and a three-tool-only alternative are reported separately; output schemas are not included in the primary model-context projection. Host injection, history replay, inference quality and billable usage are unmeasured.",
               "resources": "CPU quota 100%; launcher binds clients/servers to CPUs 0-1 (the outer observer starts on CPU15). The guard receipt affinity is initial placement, not child affinity; a live cohort observation records the override. 3 GiB early stop/4 GiB hard/no swap. Fresh client/server/HOME per task, Node compile cache disabled, OS caches unflushed. Later retained pages are warm queries; no separate warm-server cohort. Whole-family costs include client/oracle comparisons, source hashing, runtime binding, serialization and receipts. Tokenizer processing itself is outside these measured tasks. Verified counters are at payload exit while the observer remains alive; unavailable final whole-scope counters remain null.",
               "summary": summarize(rows), "recordings": rows}
    args.output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
