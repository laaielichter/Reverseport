"""Verify published source/map facts independently of REA's parsers."""
import argparse
import collections
import hashlib
import json
from pathlib import Path, PurePosixPath

parser = argparse.ArgumentParser()
parser.add_argument("case", type=Path)
parser.add_argument("reference", type=Path)
args = parser.parse_args()
root = args.case.parent
bundle = json.loads((args.case / "evidence.json").read_text())
reference = json.loads(args.reference.read_text())
oracle = json.loads((root / "oracle.json").read_text())
application = next(r for r in bundle["records"] if r["operation"] == "analyze_javascript_application")
comparison = next(r for r in bundle["records"] if r["operation"] == "compare_source_to_bundle")["normalized_result"]
expected = {(r["map"], r["source_index"]): r for r in oracle["rows"]}
nodes = [n for n in application["normalized_result"]["graph"]["nodes"] if n["kind"] == "source-module"]
assert len(nodes) == len(expected) == 99
by_path = collections.defaultdict(set)
by_basename = collections.defaultdict(set)
seen = set()
for node in nodes:
    observation = node["observations"][0]
    location = observation["source_map_reference"]
    key = (PurePosixPath(location["map_path"]).name, observation["properties"]["source_index"])
    row = expected[key]
    assert key not in seen
    seen.add(key)
    assert node["identity"]["original_source"] == row["map_source"] == location["source_name"]
    assert node["identity"]["source_sha256"] == row["content_sha256"] == observation["properties"]["content_sha256"]
    assert node["identity"]["source_map_sha256"] == hashlib.sha256((root / "artifact/package/dist" / row["map"]).read_bytes()).hexdigest()
    path = "src/" + row["source_path"]
    by_path[path].add(node["node_id"])
    by_basename[PurePosixPath(path).name].add(node["node_id"])
actual_files = {p.relative_to(root / "reference").as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in (root / "reference/src").rglob("*") if p.is_file()}
entries = {e["path"]: e for e in reference["entries"] if e["kind"] == "file"}
assert set(entries) == set(actual_files)
assert all(entries[p]["sha256"] == sha for p, sha in actual_files.items())
items = {item["source_path"]: item for item in comparison["items"]}
assert set(items) == set(actual_files)
candidate_count = 0
for path, item in items.items():
    assert item["source_sha256"] == actual_files[path]
    candidates = {candidate["current_node_id"] for candidate in item["candidates"]}
    assert candidates == by_basename[PurePosixPath(path).name], path
    candidate_count += len(candidates)
    assert set(item["current_node_ids"]) == by_path[path]
    assert item["status"] == ("split" if by_path[path] else "unknown")
    assert all(signal["kind"] != "exact-source-digest"
               for candidate in item["candidates"] for signal in candidate["signals"])
assert candidate_count == comparison["coverage"]["candidate_evaluations"] == 210
assert comparison["coverage"]["status"] == "partial"
proof = {"status": "passed", "method": "Independent Python JSON/SHA-256/POSIX path and basename joins; no REA parser or matcher.",
         "source_files": len(actual_files), "embedded_nodes": len(nodes), "candidate_relations": candidate_count,
         "strong_location_rows": sum(bool(by_path[p]) for p in actual_files),
         "limitation": "Static multiple-location projections; no semantic-equivalence or removal claim."}
with (args.case / "independent-proof.json").open("x") as output:
    json.dump(proof, output, indent=2)
    output.write("\n")
print(json.dumps(proof))
