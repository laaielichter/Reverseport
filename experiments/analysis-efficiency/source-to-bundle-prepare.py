"""Prepare a pinned public source/bundle corpus without extracting or executing package scripts."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument('tarball', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
expected = 'f2517c466b50424b661a27e48039f15db7783e5822f46b5c7d39f20104ac67a9'
assert hashlib.sha256(args.tarball.read_bytes()).hexdigest() == expected
args.output.mkdir()
bundles = ['redux-toolkit.browser.mjs', 'redux-toolkit.legacy-esm.js', 'redux-toolkit.modern.mjs']
selected = {f'package/dist/{name}{suffix}' for name in bundles for suffix in ['', '.map']}
with tarfile.open(args.tarball) as archive:
    for member in archive:
        if not member.isfile():
            continue
        path = PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts:
            raise ValueError('Unsafe archive member')
        if not (member.name.startswith('package/src/') or member.name in selected):
            continue
        data = archive.extractfile(member).read()
        destination = args.output / 'artifact' / str(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        if member.name.startswith('package/src/'):
            layout = args.output / 'reference' / str(path.relative_to('package'))
        else:
            layout = args.output / 'artifact/shipped' / str(path.relative_to('package'))
        layout.parent.mkdir(parents=True, exist_ok=True)
        layout.write_bytes(data)
rows = []
for name in sorted(bundles):
    document = json.loads((args.output / 'artifact/package/dist' / (name + '.map')).read_text())
    assert len(document['sources']) == len(document['sourcesContent']) == 33
    for index, (source, content) in enumerate(zip(document['sources'], document['sourcesContent'])):
        assert source.startswith('../src/')
        relative = source.removeprefix('../src/')
        embedded_sha = hashlib.sha256(content.encode()).hexdigest()
        source_sha = hashlib.sha256((args.output / 'reference/src' / relative).read_bytes()).hexdigest()
        rows.append({'map': name + '.map', 'source_index': index, 'source_path': relative,
                     'map_source': source, 'content_sha256': embedded_sha,
                     'source_sha256': source_sha, 'exact': embedded_sha == source_sha})
assert len(list((args.output / 'reference/src').rglob('*.*'))) == 180
assert len(rows) == 99 and not any(row['exact'] for row in rows)
(args.output / 'oracle.json').write_text(json.dumps({'independent_method': 'Python JSON and SHA-256 over published map sourcesContent versus published source files; no REA parser.', 'rows': rows}, indent=2) + '\n')
print(json.dumps({'tarball_sha256': expected, 'source_files': 180, 'embedded_nodes': 99, 'executed_target_code': False}))
