"""Summarize completed CLI trials; token counts are estimates, not model usage."""
import argparse
import hashlib
import json
import statistics
from pathlib import Path
import tiktoken

parser = argparse.ArgumentParser()
parser.add_argument('root', type=Path)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
root = args.root
inputs = json.loads((root / 'measurement-inputs.json').read_text())
expected = inputs['expected_runtime_bindings']
assert expected['complete']['git_revision'] == inputs['baseline_revision']
assert expected['selected']['git_revision'] == inputs['feature_parent_revision']
assert expected['complete']['root'] != expected['selected']['root']
assert expected['complete']['compiled_cli_sha256'] != expected['selected']['compiled_cli_sha256']
assert expected['complete']['source_diff_sha256'] == hashlib.sha256(b'').hexdigest()
assert expected['complete']['untracked_source_sha256'] == hashlib.sha256(b'[]').hexdigest()
enc = tiktoken.get_encoding('cl100k_base')
count = lambda text: len(enc.encode(text, disallowed_special=()))
compact = lambda obj: json.dumps(obj, ensure_ascii=False, separators=(',', ':'))
runs = []
for case in sorted(root.glob('pair-*')):
    if not case.is_dir():
        continue
    report = json.loads((case / 'report.json').read_text())
    assert report['status'] == 'passed' and report['cleanup_verified']
    assert report['runtime_binding_verified']
    assert report['runtime_binding'] == expected[report['mode']], case.name
    assert str(Path(report['runtime']).resolve()) == report['runtime_binding']['root']
    receipt = next(json.loads(line) for line in reversed(case.with_name(case.name + '.log').read_text().splitlines()) if line.startswith('{"resource_scope":'))
    obs = receipt['payload_resource_observation']
    assert receipt['abort'] is None and receipt['payload_resource_observation_verified']
    assert obs['payload_exit_code'] == 0 and obs['payload_cleanup_verified']
    assert obs['resource_events']['memory.events']['oom_kill'] == 0
    tokens = {'question_and_recipe': count(report['question'] + '\n' + report['recipe']),
              'arguments': sum(count(compact(call['arguments'])) for call in report['calls']),
              'help_and_replies': sum(count((case / call['stdout_file']).read_text()) for call in report['calls'])}
    tokens['whole_task'] = sum(tokens.values())
    runs.append({'case': case.name, 'mode': report['mode'], 'cache': report['cache'], 'runtime': report['runtime'], 'runtime_binding': report['runtime_binding'], 'runtime_binding_audit_ms': report['runtime_binding_audit_ms'],
                 'wall_seconds': receipt['elapsed_seconds'], 'cpu_seconds': obs['cpu_stat']['usage_usec'] / 1e6,
                 'peak_process_family_bytes_including_page_cache': obs['memory_peak_bytes'],
                 'tokens_estimated': tokens, 'calls': report['calls'],
                 'parent_evidence_id': report['parent_evidence_id'], 'parent_semantic_sha256': report['parent_semantic_sha256'],
                 'answer_sha256': report['answer_sha256'], 'oracle_verified': report['oracle_verified'],
                 'cleanup_verified': True, 'resource_events': obs['resource_events']})
assert len(runs) == 12
for key in ['answer_sha256', 'parent_semantic_sha256', 'parent_evidence_id']:
    assert len({row[key] for row in runs}) == 1, key
summary = {}
for cache in ['cold', 'warm']:
    summary[cache] = {}
    for mode in ['complete', 'selected']:
        rows = [r for r in runs if r['mode'] == mode and r['cache'] == cache]
        assert len(rows) == 3
        summary[cache][mode] = {key: {'median': statistics.median(r[key] for r in rows), 'min': min(r[key] for r in rows), 'max': max(r[key] for r in rows)} for key in ['wall_seconds', 'cpu_seconds', 'peak_process_family_bytes_including_page_cache']}
        summary[cache][mode]['whole_task_tokens_estimated'] = [r['tokens_estimated']['whole_task'] for r in rows]
result = {'status': 'passed', 'tokenizer': 'tiktoken==0.12.0/cl100k_base; estimates, not model usage',
          'context_scope': 'Question, supplied command recipe, actual selected-command help, all logical CLI argv and all stdout. No model invoked; reasoning, framing, irrelevant tool discovery and actual native-agent usage unmeasured.',
          'cache_scope': 'cold disables Node compile cache; warm primes the identical workflow once per runtime/mode before timing. Fresh processes and isolated HOME each trial; OS page cache uncontrolled.',
          'resource_scope': 'Whole task driver plus all CLI children; includes pre/post source-and-compiled-runtime binding verification, bundle publication/authentication, help, extra calls and local answer/oracle checking. Kernel cgroup peak includes file cache; not sampled RSS. Download/build/oracle preparation and priming excluded.',
          'acquisition': json.loads((root / 'acquisition.json').read_text()), 'measurement_inputs': inputs,
          'summary': summary, 'runs': runs}
native = root / 'native-control'
if native.exists():
    binding = json.loads((native / 'runtime-binding.json').read_text())
    assert binding['runtime_binding_verified'] and binding['runtime_binding'] == expected['complete']
    assert str(Path(binding['runtime']).resolve()) == binding['runtime_binding']['root']
    receipt = next(json.loads(line) for line in reversed((root / 'native-control.log').read_text().splitlines()) if line.startswith('{"resource_scope":'))
    obs = receipt['payload_resource_observation']
    assert receipt['abort'] is None and receipt['payload_resource_observation_verified'] and obs['payload_exit_code'] == 0 and obs['payload_cleanup_verified']
    baseline_case = root / next(run['case'] for run in runs if run['mode'] == 'complete')
    assert json.loads((native / 'answer.json').read_text()) == json.loads((baseline_case / 'answer.json').read_text())
    control_source = Path(__file__).with_name('managed-cli-local-control.py').read_text()
    result['existing_native_control'] = {'runtime': binding['runtime'], 'runtime_binding': binding['runtime_binding'], 'runtime_binding_audit_ms': binding['runtime_binding_audit_ms'], 'repetitions': 1,
        'tokens_estimated_script_plus_help_plus_answer': count(control_source) + count((native / 'help.txt').read_text()) + count((native / 'answer.json').read_text()),
        'token_scope': 'Projection source, original CLI help and returned answer; excludes shared question and launcher argv. No actual model usage measured.',
        'wall_seconds': receipt['elapsed_seconds'], 'cpu_seconds': obs['cpu_stat']['usage_usec'] / 1e6,
        'peak_process_family_bytes_including_page_cache': obs['memory_peak_bytes'], 'answer_matches': True, 'cleanup_verified': True}
args.output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(summary, indent=2))
