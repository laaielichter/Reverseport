"""Existing native code-composition control: save complete stdout, return selected facts."""
import argparse
import json
import subprocess
import time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('runtime', type=Path)
parser.add_argument('target', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--measurement-inputs', type=Path, required=True)
args = parser.parse_args()
args.output.mkdir()
node = 'node'
inputs = json.loads(args.measurement_inputs.read_text())
expected = inputs['expected_runtime_bindings']['complete']
assert expected['git_revision'] == inputs['baseline_revision']
helper = Path(__file__).with_name('managed-cli-runtime.mjs')
def capture_binding():
    return json.loads(subprocess.check_output([node, str(helper), str(args.runtime)], text=True))
binding_started = time.monotonic()
binding = capture_binding()
binding_audit_ms = {'before': (time.monotonic() - binding_started) * 1000}
assert binding == expected

entry = str(args.runtime / 'scripts/rea.mjs')
help_result = subprocess.run([node, entry, 'inspect-managed-members', '--help'], check=True, capture_output=True, text=True)
(args.output / 'help.txt').write_text(help_result.stdout)
with (args.output / 'parent.json').open('w') as file:
    subprocess.run([node, entry, 'inspect-managed-members', str(args.target), '--type', 'Newtonsoft.Json.JsonConvert', '--json'], check=True, stdout=file)
parent = json.loads((args.output / 'parent.json').read_text())
data = parent['normalized_result']
answer = {'parent_evidence_id': parent['evidence_id'], 'artifact_sha256': data['artifact']['sha256'],
          'selection': data['selection'], 'source_coverage': data['coverage'],
          'total_methods': len(data['methods']), 'total_member_refs': len(data['member_refs']),
          'methods': data['methods'][:8], 'member_refs': data['member_refs'][:16],
          'limitation': 'MemberRef rows are assembly-wide; methods are selected-type rows. Page exhaustion is not an absence claim.'}
(args.output / 'answer.json').write_text(json.dumps(answer))
binding_finished = time.monotonic()
assert capture_binding() == binding
binding_audit_ms['after'] = (time.monotonic() - binding_finished) * 1000
(args.output / 'runtime-binding.json').write_text(json.dumps({'runtime': str(args.runtime), 'runtime_binding': binding, 'runtime_binding_verified': True, 'runtime_binding_audit_ms': binding_audit_ms}))
print(json.dumps(answer))
