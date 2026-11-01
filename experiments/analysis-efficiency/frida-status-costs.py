"""Count complete actual-client requests, not only smaller tool-reply bytes."""
import argparse
import hashlib
import json
from pathlib import Path
import tiktoken

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--lab', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
enc = tiktoken.get_encoding('cl100k_base')


def tokens(value):
    return len(enc.encode(json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False), disallowed_special=()))


def resources(root):
    receipt = json.loads(Path(str(root) + '.log').read_text().splitlines()[-1])
    payload = receipt['payload_resource_observation']
    assert receipt['abort'] is None and receipt['payload_resource_observation_verified']
    assert payload['payload_exit_code'] == 0 and payload['payload_cleanup_verified']
    for events in payload['resource_events'].values():
        assert not any(events.values())
    return {'wall_seconds': receipt['elapsed_seconds'], 'cpu_seconds': payload['cpu_stat']['usage_usec'] / 1e6,
            'family_peak_mib': payload['memory_peak_bytes'] / 1048576,
            'payload_cleanup_verified': True, 'final_whole_scope_counters_verified': receipt['resource_counters_verified']}


wire, sdk = [], []
for root in sorted(args.lab.glob('wire-v2-*')):
    if not root.is_dir():
        continue
    report = json.loads((root / 'report.json').read_text())
    assert report['status'] in ['passed', 'expected-incomplete-task'] and not report['cleanup_failures']
    assert report['appserver_exit_code'] == 0 and report['owned_scope_drain']['remaining_processes'] == []
    requests = json.loads((root / 'model-requests.json').read_text())
    details = []
    for captured in requests:
        body = captured['body']
        namespace = [n for n in body.get('tools', []) if n.get('type') == 'namespace' and n.get('name') == 'mcp__rea_audit']
        assert len(namespace) == 1 and len(namespace[0]['tools']) == 211, 'Unexpected compaction/catalog: audit before comparing'
        details.append({'whole_json_tokens_proxy': tokens(body), 'rea_namespace_tokens_proxy': tokens(namespace[0]), 'rea_functions': 211})
    wire.append({'case': root.name, 'task_completed': report['task_completed'], 'mode': report['mode'],
                 'budget': report['observations']['tool_output_budget'], 'requests': len(details), 'compactions': report['compaction_requests'],
                 'whole_json_tokens_proxy': sum(r['whole_json_tokens_proxy'] for r in details), 'request_details': details, **resources(root)})
for root in sorted(args.lab.glob('sdk-*')):
    if not root.is_dir():
        continue
    report = json.loads((root / 'report.json').read_text())
    assert report['status'] == 'passed' and not report['cleanup_failures'] and not report['receipt_failures']
    transcript = json.loads((root / 'transcript.json').read_text())
    catalog = json.loads((root / 'catalog.json').read_text())
    assert len(catalog['tools']) == 211 and report['original_target_exited']
    sdk.append({'case': root.name, 'detail': report['detail'], 'capture': report['capture'], 'tool_calls': len(report['calls']),
                'exported_bundle_bytes': report['exported_bundle_bytes'], 'answer': report['answer'],
                'status_calls': [c for c in report['calls'] if c['name'] == 'frida_session_status'],
                'one_catalog_plus_all_sdk_calls_tokens_proxy': tokens(catalog) + sum(tokens({'name': t['name'], 'input': t['input'], 'reply': t['reply']}) for t in transcript), **resources(root)})
assert len(sdk) == len(wire) == 4, 'A partial cohort cannot qualify a comparison'
for capture in ['small', 'libc']:
    pair = [r for r in sdk if r['capture'] == capture]
    assert len(pair) == 2 and {r['detail'] for r in pair} == {'complete', 'summary'}
    assert {k: v for k, v in pair[0]['answer'].items() if k != 'pid'} == {k: v for k, v in pair[1]['answer'].items() if k != 'pid'}
    reports = [json.loads((args.lab / r['case'] / 'report.json').read_text()) for r in pair]
    assert reports[0]['load']['source_sha256'] == reports[1]['load']['source_sha256']
completed = [r for r in wire if r['budget'] == 300000]
assert len(completed) == 2 and all(r['task_completed'] for r in completed)
answers = [json.loads((args.lab / r['case'] / 'report.json').read_text())['observations']['answers'] for r in completed]
comparable_answers = [[{k: v for k, v in a.items() if k != 'parent_evidence_id'} for a in run] for run in answers]
assert comparable_answers[0] == comparable_answers[1]
result = {
    'scope': 'Real local Frida binding with controlled sleep target and caller-authored libc export inventory. Actual Codex0.163 app-server uses a deterministic local SSE fixture: no AI inference, model usage, quality or billing claim. Whole compact JSON token estimates include all 211 schemas and every request replay. Incomplete default baseline is excluded from completed-task gains. SDK exchange estimates are not model-input measurements. Fresh processes have unflushed OS caches; both status reads query live session observations. Timings include the eight-second target lifetime and cleanup; single pairs establish no general speedup. Payload-exit cgroup counters are verified; final whole-scope counters may be unavailable.',
    'tokenizer': {'package': tiktoken.__version__, 'encoding': enc.name},
    'runtime_pins': {v: {k: x for k, x in json.loads((args.lab / (v + '-manifest.json')).read_text()).items() if k != 'files'} for v in ['baseline', 'candidate']},
    'native': json.loads((args.lab / 'native-prerequisite-manifest.json').read_text()),
    'script_pins': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.glob('frida*') if p.suffix in ['.py', '.mjs']},
    'wire': wire, 'sdk': sdk,
}
args.output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'wire': [{k: v for k, v in r.items() if k != 'request_details'} for r in wire], 'sdk': [{k: v for k, v in r.items() if k not in ['status_calls', 'answer']} for r in sdk]}, indent=2))
