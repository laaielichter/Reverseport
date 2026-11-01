"""Verify fixed real ELF/BEAM tasks and their whole-task resource/token costs."""
import argparse
from pathlib import Path
import hashlib
import json
import statistics
import tiktoken

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--receipts', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
options = parser.parse_args()
receipts = options.receipts
cohort = receipts / 'cohort'
index = json.loads((cohort / 'index.json').read_text())
assert len(index) == 18 and all((record['exit'] == 0 for record in index))
assert len({record['name'] for record in index}) == 18
encoding = tiktoken.get_encoding('cl100k_base')
compact = lambda d: json.dumps(d, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
count = lambda s: len(encoding.encode(s, disallowed_special=()))
digest = lambda task: hashlib.sha256(task.read_bytes()).hexdigest()
rows = []
for item in index:
    task = cohort / item['name']
    record = json.loads((task / 'report.json').read_text())
    catalog = json.loads((task / 'catalog.json').read_text())
    transcript = json.loads((task / 'transcript.json').read_text())
    scope = next((json.loads(l) for l in reversed((cohort / (item['name'] + '.log')).read_text().splitlines()) if l.startswith('{"resource_scope":')))
    observed = scope['payload_resource_observation']
    events = observed['resource_events']
    assert record['oracle_sha256'] == digest(receipts / f"{item['case']}-oracle.json")
    assert item['exit'] == 0 and record['status'] == 'passed' and record['complete_source_export_verified'] and (not record['cleanup_failures']) and (not record['receipt_failures'])
    assert scope['abort'] is None and scope['payload_resource_observation_verified'] and (observed['payload_exit_code'] == 0) and observed['payload_cleanup_verified']
    assert all((events['memory.events'][k] == 0 for k in ['high', 'max', 'oom', 'oom_kill'])) and events['pids.events']['max'] == 0
    oracle = json.loads((receipts / f"{item['case']}-oracle.json").read_text())
    assert [e['name'] for e in transcript] == [oracle['operation'], 'export_evidence_bundle']
    assert transcript[0]['input'] == oracle['input'] and record['question'] == oracle['question']
    assert all((not e['reply'].get('isError', False) for e in transcript))
    directory_tokens = count(compact([{k: t[k] for k in ['name', 'description', 'inputSchema']} for t in catalog['tools']]))
    argument_tokens = sum((count(compact({'name': e['name'], 'arguments': e['input']})) for e in transcript))
    reply_tokens = sum((count(c['text']) for e in transcript for c in e['reply']['content'] if c['type'] == 'text'))
    question_tokens = count(record['question'])
    instruction_tokens = count(record['server_instructions'])
    rows.append({
        **item,
        'catalog_tools': len(catalog['tools']),
        'catalog_sha256': digest(task / 'catalog.json'),
        'parent_evidence_id': record['parent_evidence_id'],
        'source_report_sha256': record['source_report_sha256'],
        'runtime_identity_sha256': record['runtime_identity_sha256'],
        'wall_seconds': scope['elapsed_seconds'],
        'cpu_seconds': observed['cpu_stat']['usage_usec'] / 1000000.0,
        'kernel_family_peak_bytes': observed['memory_peak_bytes'],
        'inspection_ms': record['calls'][0]['elapsed_ms'],
        'discovery_ms': record['phases']['discovery_ms'],
        'token_estimate': {
            'question': question_tokens,
            'instructions': instruction_tokens,
            'directory_once': directory_tokens,
            'arguments': argument_tokens,
            'text_replies': reply_tokens,
            'whole_task': question_tokens + instruction_tokens + directory_tokens + argument_tokens + reply_tokens,
            'raw_catalog': count(compact(catalog)),
        },
        'receipt_sha256': {n: digest(task / n) for n in ['report.json', 'transcript.json', 'catalog.json', 'source.evidence.json']},
        'payload_exit_events': events,
        'payload_cleanup_verified': True,
        'whole_scope_events_final': scope['resource_events_final'],
    })
summary = {}
for case in ['llvm', 'ls', 'beam']:
    case_samples = [record for record in rows if record['case'] == case]
    for k in ['catalog_sha256', 'source_report_sha256', 'parent_evidence_id']:
        assert len({record[k] for record in case_samples}) == 1, (case, k)
    summary[case] = {}
    for lane in ['before', 'after']:
        lane_samples = [record for record in case_samples if record['lane'] == lane]
        assert len(lane_samples) == 3
        assert {record['repeat'] for record in lane_samples} == {1, 2, 3}
        metrics = {k: [record[k] for record in lane_samples] for k in ['wall_seconds', 'cpu_seconds', 'kernel_family_peak_bytes', 'inspection_ms', 'discovery_ms']}
        metrics['whole_task_tokens'] = [record['token_estimate']['whole_task'] for record in lane_samples]
        summary[case][lane] = {k: {'median': statistics.median(v), 'min': min(v), 'max': max(v)} for k, v in metrics.items()}
identities = {lane: json.loads((receipts / f'{lane}-runtime-identity.json').read_text()) for lane in ['before', 'after']}
assert all((identity['source_clean'] for identity in identities.values()))
for row in rows:
    assert row['runtime_identity_sha256'] == digest(receipts / f"{row['lane']}-runtime-identity.json")
result = {
    'tiktoken': tiktoken.__version__,
    'encoding': encoding.name,
    'actual_model_usage': None,
    'revisions': {l: i['source_revision'] for l, i in identities.items()},
    'identity_receipts': {l: digest(receipts / f'{l}-runtime-identity.json') for l in identities},
    'oracles': {c: {'sha256': digest(receipts / f'{c}-oracle.json'), 'artifact': json.loads((receipts / f'{c}-oracle.json').read_text())['expected']['artifact']} for c in summary},
    'summary': summary,
    'recordings': rows,
    'measurement': 'Three alternating fresh production stdio SDK sessions per lane/case; exact discovered toolDefinition/default validator, fresh HOME, Node compile cache disabled, OS caches unflushed. Each task discovers complete catalog, inspects bytes and exports/compares full source Evidence; all oracle facts checked. Whole process-family CPU and kernel peak include client/server, runtime fingerprint verification, serialization, export and cleanup. Oracle generation and tokenization outside measured tasks. One-CPU quota, 3GiB early stop/4GiB hard/no swap; payload exit/cleanup/events verified, final whole-scope counters unavailable. Token serialization estimate includes question/instructions/all input name+description+schema once/all arguments/all text replies, raw catalog separately. Host framing, replay, model inference quality and billing unmeasured.',
}
options.output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(summary, indent=2))
