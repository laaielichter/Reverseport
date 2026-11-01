"""Verify completed PYC selection/export tasks and count a declared token projection."""
import argparse
import hashlib
import json
from pathlib import Path
import statistics

import tiktoken


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inspect(path, encoding):
    report = json.loads((path / 'report.json').read_text())
    catalog = json.loads((path / 'catalog.json').read_text())
    transcript = json.loads((path / 'transcript.json').read_text())
    scope = next(json.loads(line) for line in reversed(path.with_suffix('.log').read_text().splitlines())
                 if line.startswith('{"resource_scope":'))
    observed = scope.get('payload_resource_observation') or {}
    events = observed.get('resource_events', {})
    assert report['status'] == 'passed' and report['runtime_identity_sha256']
    assert report['complete_source_export_verified'] is True
    assert not report['cleanup_failures'] and not report['receipt_failures']
    assert scope['abort'] is None and scope['payload_resource_observation_verified'] is True
    assert observed['payload_exit_code'] == 0 and observed['payload_cleanup_verified'] is True
    assert all(events.get('memory.events', {}).get(key) == 0 for key in ['high', 'max', 'oom', 'oom_kill'])
    assert events.get('pids.events', {}).get('max') == 0
    assert len(catalog['tools']) == report['catalog_tools'] == 221
    assert [event['name'] for event in transcript] == ['inspect_python_pyc', 'export_evidence_bundle']
    assert all('reply' in event and not event['reply'].get('isError', False) for event in transcript)
    count = lambda text: len(encoding.encode(text, disallowed_special=()))
    directory = [{key: tool[key] for key in ['name', 'description', 'inputSchema']} for tool in catalog['tools']]
    request = transcript[0]['input']
    # Both lanes answer the same question; selected arguments disclose the exact fields/names.
    question = (f"For {report['artifact']['path']}, return every matching code object for "
                f"{', '.join(report['selected_names'])}, including its original source_index, name, qualname, "
                "filename, firstlineno, bytecode bytes/SHA-256 and nested_code constant-reference indices. "
                "Keep same-name alternatives, preserve source coverage and export complete source Evidence. "
                "Do not execute the bytecode or infer runtime calls.")
    assert ('detail' in request) == (report['lane'] == 'selected')
    arguments = sum(count(compact({'name': event['name'], 'arguments': event['input']})) for event in transcript)
    replies = sum(count(block['text']) for event in transcript for block in event['reply']['content'] if block['type'] == 'text')
    inputs, prompt = count(compact(directory)), count(question)
    instructions = count(report['server_instructions'])
    return dict(case=path.name, lane=report['lane'], artifact=report['artifact'],
                answer_count=report['answer_count'], answer_sha256=report['answer_sha256'],
                parent_evidence_id=report['parent_evidence_id'], source_report_sha256=report['source_report_sha256'],
                runtime_identity_sha256=report['runtime_identity_sha256'], catalog_sha256=digest(path / 'catalog.json'),
                calls=report['calls'], phases=report['phases'], wall_seconds=scope['elapsed_seconds'],
                cpu_seconds=observed['cpu_stat']['usage_usec'] / 1e6,
                kernel_family_peak_bytes=observed['memory_peak_bytes'],
                events_at_payload_exit=events, payload_cleanup_verified=True,
                final_whole_scope_events=scope.get('resource_events_final'),
                token_proxy=dict(question=prompt, server_instructions=instructions, input_catalog_once=inputs, arguments=arguments,
                                 text_replies=replies, combined=prompt + instructions + inputs + arguments + replies,
                                 complete_transport_catalog=count(compact(catalog))),
                receipt_sha256={file.name: digest(file) for file in [path / 'report.json', path / 'catalog.json',
                               path / 'transcript.json', path / 'evidence.json', path.with_suffix('.log')]})


def summarize(rows):
    result = {}
    for artifact in sorted({row['artifact']['sha256'] for row in rows}):
        cases = [row for row in rows if row['artifact']['sha256'] == artifact]
        for field in ['answer_count', 'answer_sha256', 'parent_evidence_id', 'source_report_sha256']:
            assert len({row[field] for row in cases}) == 1, field
        result[artifact] = {}
        for lane in ['complete', 'selected']:
            samples = [row for row in cases if row['lane'] == lane]
            assert len(samples) == 3
            for field in ['runtime_identity_sha256', 'catalog_sha256']:
                assert len({row[field] for row in samples}) == 1, field
            metrics = {key: [row[key] for row in samples] for key in ['wall_seconds', 'cpu_seconds', 'kernel_family_peak_bytes']}
            metrics['projected_tokens'] = [row['token_proxy']['combined'] for row in samples]
            metrics['mcp_reply_bytes'] = [sum(call['reply_bytes'] for call in row['calls']) for row in samples]
            result[artifact][lane] = {key: dict(median=statistics.median(values), minimum=min(values), maximum=max(values))
                                      for key, values in metrics.items()}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cohort', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads((args.cohort / 'manifest.json').read_text())
    index = json.loads((args.cohort / 'index.json').read_text())
    assert len(index) == 18 and all(case['exit'] == 0 for case in index)
    for file, expected in manifest['driver_files'].items():
        assert digest(Path(file)) == expected, file
    identities = {}
    for lane, path in manifest['runtime_identities'].items():
        identity = json.loads(Path(path).read_text())
        assert identity['source_clean'] is True
        identities[lane] = dict(sha256=digest(Path(path)), source_revision=identity['source_revision'])
    encoding = tiktoken.get_encoding('cl100k_base')
    rows = [inspect(args.cohort / case['name'], encoding) for case in index]
    assert all(row['runtime_identity_sha256'] == identities[row['lane']]['sha256'] for row in rows)
    receipt = dict(tiktoken=tiktoken.__version__, encoding=encoding.name, actual_model_usage=None,
                   cohort=manifest, commands=index, runtime_identities=identities,
                   projection='Scripted fresh SDK tasks, not model runs. One fixed question, server instructions and complete input directory (name/description/inputSchema), every argument and MCP text reply including export. Raw catalog including output schemas reported separately. No framing, host injection, history replay, inference quality or billable usage measured.',
                   resources='CPU quota100%, payload affinity0-1, initial observer15. Early stop3GiB, hard4GiB, swap0. Fresh HOME/client/server; Node compile cache disabled, OS caches unflushed. Whole process-family CPU and kernel memory peak include file cache, runtime identity checks, hashing, assertions, SDK/server serialization and cleanup. Oracle generation and tokenization outside timed tasks. Payload-exit counters verified; final whole-scope counters unavailable.',
                   summary=summarize(rows), recordings=rows)
    args.output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
