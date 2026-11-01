"""Verify paired SDK startup/analysis receipts and account for the whole task."""
import argparse
import hashlib
import importlib.util
import json
import math
import statistics
from pathlib import Path

import tiktoken

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('root', type=Path)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
root = args.root
input_bytes = (root / 'measurement-inputs.json').read_bytes()
inputs = json.loads(input_bytes)
expected = inputs['runtime_bindings']
sha = lambda value: hashlib.sha256(value).hexdigest()
compact = lambda value: json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
encoding = tiktoken.get_encoding('cl100k_base')
count = lambda value: len(encoding.encode(value, disallowed_special=()))
for role in ['baseline', 'candidate']:
    assert expected[role]['git_revision'] == inputs[f'{role}_revision']
    assert expected[role]['source_diff_sha256'] == sha(b'')
    assert expected[role]['untracked_source_sha256'] == sha(b'[]')
assert expected['baseline']['root'] != expected['candidate']['root']
assert expected['baseline']['compiled_runtime_sha256'] != expected['candidate']['compiled_runtime_sha256']
spec = importlib.util.spec_from_file_location('catalog_costs', Path(__file__).with_name('mcp-input-catalog-costs.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
catalogs = {}
identities = {}
rows = []
heap_rows = []
for case in inputs['cases'] + inputs.get('diagnostic_cases', []):
    directory = root / case['case']
    report = json.loads((directory / 'report.json').read_text())
    assert report['status'] == 'passed' and report['cleanup_verified']
    assert report['runtime_binding_verified']
    assert report['measurement_inputs_sha256'] == sha(input_bytes)
    for name, producer_digest in report['producer_sources_sha256'].items():
        assert producer_digest == inputs['harness_sources_sha256'][name]
    assert report['runtime_binding'] == expected[case['role']]
    assert type(report['elapsed_ms']) in [int, float] and math.isfinite(report['elapsed_ms']) and report['elapsed_ms'] >= 0
    for key in ['role', 'cache', 'profile', 'phase']:
        assert report[key] == case[key]
    raw = (directory / 'catalog.json').read_bytes()
    catalog_digest = sha(raw)
    assert catalog_digest == report['catalog_sha256']
    profile = case['profile']
    if profile not in catalogs:
        catalog = json.loads(raw)
        definitions = [{key: tool[key] for key in ['name', 'description', 'inputSchema']} for tool in catalog['tools']]
        catalogs[profile] = {'sha256': catalog_digest, 'tool_count': len(catalog['tools']),
                             'input_catalog_tokens': count(compact(definitions)),
                             'raw_catalog_tokens': count(raw.decode()), 'raw_catalog_bytes': len(raw)}
    assert catalog_digest == catalogs[profile]['sha256'], 'Directory differs across roles or phases'
    transcript = json.loads((directory / 'transcript.json').read_text())
    server = json.loads((directory / 'server.json').read_text())
    tokens = {'question_and_recipe': count(inputs['questions'][case['phase']] + '\n' + inputs['recipes'][case['phase']]),
              'server_instructions': count(server.get('instructions') or ''),
              'input_catalog_once': catalogs[profile]['input_catalog_tokens'],
              'arguments': sum(count(compact({'name': call['name'], 'arguments': call['arguments']})) for call in transcript),
              'text_replies': sum(count(block['text']) for call in transcript for block in call['reply']['content'] if block['type'] == 'text')}
    requests = report['protocol_requests']
    assert requests['initialize'] == 1
    if case['phase'] == 'analysis':
        assert len(transcript) == 5 and requests['tools/call'] == 5 and requests['tools/list'] == 2
        assert report['artifact_sha256'] == inputs['artifacts'][case['artifact']]['sha256']
        identity = (report['parent_evidence_id'], report['parent_semantic_sha256'], sha(compact(report['answer']).encode()))
        assert identities.setdefault(case['artifact'], identity) == identity
        assert sum(call['is_error'] for call in report['calls']) == 1
    else:
        assert not transcript and requests.get('tools/call', 0) == 0
        assert requests['tools/list'] == 1 and requests['prompts/list'] == 1
        prompts = (directory / 'prompts.json').read_bytes()
        assert sha(prompts) == report['prompts_sha256']
        assert identities.setdefault('prompts', report['prompts_sha256']) == report['prompts_sha256']
        tokens['prompt_directory'] = count(prompts.decode())
    tokens['whole_task'] = sum(tokens.values())
    resource = module.resource(directory)
    for name, guard_digest in resource['guard_sources_sha256'].items():
        assert guard_digest == inputs['harness_sources_sha256'][name]
    del resource['guard_sources_sha256']
    row = {**case, 'runtime_binding_sha256': sha(compact(report['runtime_binding']).encode()), 'runtime_audit_ms': report['runtime_audit_ms'],
           'sdk_task_elapsed_seconds': report['elapsed_ms'] / 1000,
           'catalog_sha256': catalog_digest, 'parent_evidence_id': report.get('parent_evidence_id'),
           'parent_semantic_sha256': report.get('parent_semantic_sha256'),
           'answer_sha256': sha(compact(report['answer']).encode()), 'tokens_estimated': tokens,
           'raw_catalog_result_tokens_all_lists': catalogs[profile]['raw_catalog_tokens'] * requests['tools/list'],
           'raw_catalog_result_bytes_all_lists': catalogs[profile]['raw_catalog_bytes'] * requests['tools/list'],
           'actual_model_usage': None, 'protocol_era': report['protocol_era'], 'protocol_requests': requests, 'calls': report['calls'],
           **resource,
           'receipt_sha256': {name: sha((directory / name).read_bytes()) for name in ['report.json', 'catalog.json', 'server.json', 'transcript.json']}}
    assert row['catalog_sha256'] == row['receipt_sha256']['catalog.json'] == catalogs[profile]['sha256']
    heap = report.get('diagnostic_heap')
    if case.get('diagnostic_heap'):
        assert case['phase'] == 'analysis' and case['cache'] == 'cold' and case['artifact'] == 'zellij'
        assert heap is not None and heap['pid_verified'] is True
        for sample in [heap['before_gc'], heap['after_gc']]:
            assert type(sample['usedSize']) is int and sample['usedSize'] >= 0
            assert type(sample['totalSize']) is int and sample['totalSize'] >= sample['usedSize']
        row['heap_observation'] = heap
        row['retained_v8_heap_bytes_after_gc'] = heap['after_gc']['usedSize']
        heap_rows.append(row)
    else:
        assert heap is None, 'Diagnostic GC contaminated a normal task trial'
        rows.append(row)
assert len(rows) == 72
summary = []
for phase in ['discovery', 'analysis']:
    for cache in ['cold', 'warm']:
        for profile in ['default', 'full']:
            for artifact in ([None] if phase == 'discovery' else ['ripgrep', 'zellij']):
                item = {'phase': phase, 'cache': cache, 'profile': profile, 'artifact': artifact}
                for role in ['baseline', 'candidate']:
                    selected = [row for row in rows if all(row[key] == item[key] for key in ['phase', 'cache', 'profile', 'artifact']) and row['role'] == role]
                    assert len(selected) == 3
                    item[role] = {metric: {'median': statistics.median(row[metric] for row in selected),
                                           'min': min(row[metric] for row in selected), 'max': max(row[metric] for row in selected)}
                                  for metric in ['wall_seconds', 'cpu_seconds', 'kernel_family_peak_bytes_including_page_cache', 'sdk_task_elapsed_seconds']}
                    item[role]['tokens_estimated'] = [row['tokens_estimated']['whole_task'] for row in selected]
                summary.append(item)
result = {'status': 'passed', 'tokenizer': f'tiktoken=={tiktoken.__version__}/cl100k_base; estimates, not model usage',
          'aggregation_sources_sha256': {path.name: sha(path.read_bytes()) for path in [Path(__file__), Path(spec.origin)]},
          'context_scope': 'Question, explicit recipe, server instructions, one complete name/description/input-schema directory, every tool argument and text reply, plus prompt directory for discovery. This projection assumes the client retains a single unchanged directory. Raw catalog result costs include every observed tools/list result separately, with output schemas and without JSON-RPC envelopes. SDK initialization/framing, reasoning and actual model usage are unmeasured. The analysis task includes retained-read, rejection, export/oracle and post-materialization directory checks.',
          'cache_scope': 'Cold disables server Node compile cache. Warm enables a prepopulated role/profile-specific cache after one complete analysis priming run. Fresh server/client processes and HOME each trial. Driver compile cache disabled in both cohorts. Cache hit rate and OS page cache are unmeasured; source/runtime audits warm compiled-file pages before startup.',
          'resource_scope': 'Whole SDK driver, resource observer and owned REA process family. Includes before/after source-and-all-compiled-JS/JSON binding, SDK schema checks, extra validation calls, bundle export and independent oracle checking. Kernel cgroup peak includes file cache. Build/download/oracle preparation and cache priming excluded. Retained V8 heap and forced-GC diagnostics were not separately measured.',
          'measurement_inputs': inputs, 'catalogs': catalogs, 'summary': summary, 'records': rows,
          'sdk_task_elapsed_scope': 'SDK span from client connect through task checks and client/server close. Excludes pre/post runtime binding and preflight artifact/oracle loading. Diagnostic spans include inspector and forced GC. CPU is measured for the whole family only; per-span CPU is unmeasured.',
          'warmup_receipts': {name: sha((root / name / 'report.json').read_bytes()) for name in [f'warmup-{profile}-{role}' for profile in ['default', 'full'] for role in ['baseline', 'candidate']]}}
if heap_rows:
    assert len(heap_rows) == 12
    heap_summary = []
    for profile in ['default', 'full']:
        item = {'profile': profile}
        for role in ['baseline', 'candidate']:
            selected = [row for row in heap_rows if row['profile'] == profile and row['role'] == role]
            assert len(selected) == 3
            item[role] = {metric: {'median': statistics.median(row[metric] for row in selected),
                                   'min': min(row[metric] for row in selected), 'max': max(row[metric] for row in selected)}
                          for metric in ['retained_v8_heap_bytes_after_gc', 'wall_seconds', 'cpu_seconds', 'sdk_task_elapsed_seconds',
                                         'kernel_family_peak_bytes_including_page_cache']}
        heap_summary.append(item)
    result['heap_diagnostics'] = {
        'scope': 'Separate three-pair Zellij tasks per profile, with an explicitly launched loopback inspector. Four CDP calls verify the owned REA PID, read heap, force GC and read heap again after the completed SDK task. These whole-family costs include inspector and diagnostic GC overhead; they are excluded from the normal timing cohort. Heap values describe REA V8 only, not the client or the whole process family.',
        'summary': heap_summary, 'records': heap_rows}
args.output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(summary, indent=2))
