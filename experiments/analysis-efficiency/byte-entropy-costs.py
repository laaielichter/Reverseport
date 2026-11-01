"""Verify 18 completed entropy tasks and report whole-task resource/token costs."""
import argparse
from pathlib import Path
import hashlib, json, statistics
import tiktoken
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--receipts', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
options = parser.parse_args()
b = options.receipts
cohort = b / 'cohort'
index = json.loads((cohort / 'index.json').read_text())
assert len(index) == 18 and all((r['exit'] == 0 for r in index))
assert len({item['name'] for item in index}) == 18
enc = tiktoken.get_encoding('cl100k_base')
compact = lambda d: json.dumps(d, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
count = lambda s: len(enc.encode(s, disallowed_special=()))
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
rows = []
for item in index:
    p = cohort / item['name']
    r = json.loads((p / 'report.json').read_text())
    catalog = json.loads((p / 'catalog.json').read_text())
    tx = json.loads((p / 'transcript.json').read_text())
    scope = next((json.loads(l) for l in reversed((cohort / (item['name'] + '.log')).read_text().splitlines()) if l.startswith('{"resource_scope":')))
    obs = scope['payload_resource_observation']
    events = obs['resource_events']
    assert r['oracle_sha256'] == digest(b / f"{item['case']}-oracle.json")
    assert item['exit'] == 0 and r['status'] == 'passed' and r['complete_source_export_verified'] and (not r['cleanup_failures']) and (not r['receipt_failures'])
    assert scope['abort'] is None and scope['payload_resource_observation_verified'] and (obs['payload_exit_code'] == 0) and obs['payload_cleanup_verified']
    assert all((events['memory.events'][k] == 0 for k in ['high', 'max', 'oom', 'oom_kill'])) and events['pids.events']['max'] == 0
    assert [e['name'] for e in tx] == ['inspect_byte_entropy', 'export_evidence_bundle']
    assert all((not e['reply'].get('isError', False) for e in tx))
    inp = count(compact([{k: t[k] for k in ['name', 'description', 'inputSchema']} for t in catalog['tools']]))
    args = sum((count(compact({'name': e['name'], 'arguments': e['input']})) for e in tx))
    replies = sum((count(c['text']) for e in tx for c in e['reply']['content'] if c['type'] == 'text'))
    prompt = count(r['question'])
    instructions = count(r['server_instructions'])
    rows.append({
        **item,
        'catalog_tools': len(catalog['tools']),
        'catalog_sha256': digest(p / 'catalog.json'),
        'parent_evidence_id': r['parent_evidence_id'],
        'source_report_sha256': r['source_report_sha256'],
        'runtime_identity_sha256': r['runtime_identity_sha256'],
        'wall_seconds': scope['elapsed_seconds'],
        'cpu_seconds': obs['cpu_stat']['usage_usec'] / 1000000.0,
        'kernel_family_peak_bytes': obs['memory_peak_bytes'],
        'inspection_ms': r['calls'][0]['elapsed_ms'],
        'discovery_ms': r['phases']['discovery_ms'],
        'token_estimate': {
            'question': prompt,
            'instructions': instructions,
            'directory_once': inp,
            'arguments': args,
            'text_replies': replies,
            'whole_task': prompt + instructions + inp + args + replies,
            'raw_catalog': count(compact(catalog)),
        },
        'receipt_sha256': {n: digest(p / n) for n in ['report.json', 'transcript.json', 'catalog.json', 'source.evidence.json']},
        'payload_exit_events': events,
        'payload_cleanup_verified': True,
        'whole_scope_events_final': scope['resource_events_final'],
    })
summary = {}
for case in ['llvm-small-block', 'llvm-large-block', 'ls']:
    rs = [r for r in rows if r['case'] == case]
    for k in ['catalog_sha256', 'source_report_sha256', 'parent_evidence_id']:
        assert len({r[k] for r in rs}) == 1, (case, k)
    summary[case] = {}
    for lane in ['before', 'after']:
        ls = [r for r in rs if r['lane'] == lane]
        assert len(ls) == 3
        assert {r['repeat'] for r in ls} == {1, 2, 3}
        metrics = {k: [r[k] for r in ls] for k in ['wall_seconds', 'cpu_seconds', 'kernel_family_peak_bytes', 'inspection_ms', 'discovery_ms']}
        metrics['whole_task_tokens'] = [r['token_estimate']['whole_task'] for r in ls]
        summary[case][lane] = {k: {'median': statistics.median(v), 'min': min(v), 'max': max(v)} for k, v in metrics.items()}
identities = {lane: json.loads((b / f'{lane}-runtime-identity.json').read_text()) for lane in ['before', 'after']}
assert all(identity['source_clean'] for identity in identities.values())
for row in rows:
    assert row['runtime_identity_sha256'] == digest(b / f"{row['lane']}-runtime-identity.json")
result = {
    'tiktoken': tiktoken.__version__,
    'encoding': enc.name,
    'actual_model_usage': None,
    'revisions': {l: i['source_revision'] for l, i in identities.items()},
    'identity_receipts': {l: digest(b / f'{l}-runtime-identity.json') for l in identities},
    'oracles': {c: {'sha256': digest(b / f'{c}-oracle.json'), 'artifact': json.loads((b / f'{c}-oracle.json').read_text())['expected']['artifact']} for c in summary},
    'summary': summary,
    'recordings': rows,
    'measurement': 'Three alternating fresh production stdio SDK sessions per lane/case; exact discovered toolDefinition/default validator, fresh HOME, Node compile cache disabled, OS caches unflushed. Each task discovers complete catalog, inspects bytes and exports/compares full source Evidence; all oracle facts checked. Whole process-family CPU and kernel peak include client/server, runtime fingerprint verification, serialization, export and cleanup. Oracle generation and tokenization outside measured tasks. One-CPU quota, 3GiB early stop/4GiB hard/no swap; payload exit/cleanup/events verified, final whole-scope counters unavailable. Token serialization estimate includes question/instructions/all input name+description+schema once/all arguments/all text replies, raw catalog separately. Host framing, replay, model inference quality and billing unmeasured.',
}
options.output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(summary, indent=2))
