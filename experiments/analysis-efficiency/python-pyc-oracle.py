"""Independent CPython code-object facts; never execute target bytecode."""
import getopt
import hashlib
import importlib.util
import json
import marshal
from pathlib import Path
import py_compile
import sys
import types

FIELDS = ['name', 'qualname', 'filename', 'firstlineno', 'bytecode', 'nested_code']
NAMES = ['parse_args', 'parse_known_args', '_parse_known_args']


def describe(path, names):
    raw = path.read_bytes()
    assert raw[:4] == importlib.util.MAGIC_NUMBER, "Use the matching CPython producer for this oracle"
    root = marshal.loads(raw[16:])
    assert isinstance(root, types.CodeType)
    objects, indices, children = [], {}, {}

    def nested(value, visited):
        identity = id(value)
        if identity in visited:
            return []
        visited.add(identity)
        if isinstance(value, types.CodeType):
            return [value]
        if isinstance(value, (tuple, list, frozenset, set)):
            return [child for item in value for child in nested(item, visited)]
        if isinstance(value, dict):
            return [child for item in value.items() for child in nested(item, visited)]
        return []

    def visit(code):
        if id(code) in indices:
            return
        indices[id(code)] = len(objects)
        objects.append(code)
        children[id(code)] = nested(code.co_consts, set())
        for child in children[id(code)]:
            visit(child)

    visit(root)
    rows = [dict(source_index=index, name=code.co_name,
                 qualname=code.co_qualname, filename=code.co_filename,
                 firstlineno=code.co_firstlineno,
                 bytecode=dict(bytes=len(code.co_code),
                               sha256=hashlib.sha256(code.co_code).hexdigest()),
                 nested_code=[indices[id(child)] for child in children[id(code)]])
            for index, code in enumerate(objects)]
    return dict(artifact=dict(path=str(path.resolve()), bytes=len(raw),
                             sha256=hashlib.sha256(raw).hexdigest()),
                python=sys.version, names=names, fields=FIELDS, rows=rows,
                answer=[row for row in rows if row['name'] in names],
                bytecode_execution=False)


# Keep the argument parser independent of the argparse/typing targets.
options, trailing = getopt.getopt(sys.argv[1:], '',
                                 ['path=', 'compile-control=', 'output=', 'name='])
if trailing:
    raise SystemExit('Unexpected positional arguments; repeat --name NAME for selectors')
values, selected_names = {}, []
for key, value in options:
    if key == '--name':
        selected_names.append(value)
    elif key in values:
        raise SystemExit('Duplicate option: ' + key)
    else:
        values[key] = value
if '--output' not in values:
    raise SystemExit('--output is required')
path = Path(values['--path']) if '--path' in values else None
compile_control = Path(values['--compile-control']) if '--compile-control' in values else None
output = Path(values['--output'])
names = selected_names or NAMES
assert all(module not in sys.modules for module in ['argparse', 'typing']), 'Oracle dependency loaded a target module'
assert sys.implementation.name == 'cpython' and sys.version_info >= (3, 11)
if compile_control:
    directory = compile_control
    directory.mkdir(parents=True, exist_ok=False)
    source = directory / 'control.py'
    source.write_text('''class First:
    def parse_args(self):
        def inner():
            return "a" + "😀" * 40
        return inner
    def parse_known_args(self):
        return 1
class Second:
    def parse_args(self):
        return 2
def _parse_known_args():
    return 3
''', encoding='utf8')
    path = directory / 'control.pyc'
    py_compile.compile(str(source), cfile=str(path), dfile='control.py',
                       doraise=True, invalidation_mode=py_compile.PycInvalidationMode.CHECKED_HASH)
assert path is not None
output.write_text(json.dumps(describe(path, names), indent=2) + '\n')
assert all(module not in sys.modules for module in ['argparse', 'typing']), 'Oracle loaded a target module'
