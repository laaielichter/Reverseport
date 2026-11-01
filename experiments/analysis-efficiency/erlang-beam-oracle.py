"""Independent struct oracle for the fixed public OTP 27 benchmark artifacts.

Reads bytes only. It deliberately refuses compact atom layouts; format-wide
coverage belongs to the production reader and its separate regressions.
"""
from pathlib import Path
import getopt
import hashlib
import json
import struct
import sys


def decode(path):
    data = path.read_bytes()
    assert len(data) <= 64 * 1024 * 1024
    u32 = lambda at: struct.unpack_from('>I', data, at)[0]
    assert data[:4] == b'FOR1' and data[8:12] == b'BEAM'
    assert u32(4) + 8 == len(data)
    chunks, selected, at = [], {}, 12
    while at < len(data):
        name = data[at:at + 4].decode('ascii')
        size = u32(at + 4)
        end = at + 8 + size
        padded = (end + 3) & ~3
        assert end <= padded <= len(data)
        chunks.append(dict(index=len(chunks), name=name,
                           location=dict(offset=at, bytes=padded - at),
                           payload=dict(location=dict(offset=at + 8, bytes=size),
                                        bytes=size, sha256=hashlib.sha256(data[at + 8:end]).hexdigest())))
        selected[name] = (at + 8, end)
        at = padded
    assert at == len(data)
    atom_name = 'AtU8' if 'AtU8' in selected else 'Atom'
    start, end = selected[atom_name]
    n = u32(start)
    assert n < 65536, 'Fixed OTP 27 oracle does not decode compact atom tables'
    at, atoms = start + 4, []
    for i in range(n):
        size = data[at]
        at += 1
        name = data[at:at + size].decode('utf-8' if atom_name == 'AtU8' else 'latin1')
        atoms.append(dict(index=i + 1, name=name))
        at += size
    assert at == end

    def atom(i):
        return atoms[i - 1]['name'] if 0 < i <= len(atoms) else None

    def table(name, keys):
        if name not in selected:
            return None
        start, end = selected[name]
        if name == 'FunT' and start == end:
            return None
        n, width = u32(start), len(keys)
        assert start + 4 + n * 4 * width == end
        rows = []
        for i in range(n):
            values = struct.unpack_from('>' + 'I' * width, data, start + 4 + i * width * 4)
            row = dict(zip(keys, values))
            if 'module_index' in row:
                row['module'] = atom(row['module_index'])
            row['function'] = atom(row['function_index'])
            rows.append(row)
        return rows

    exports = table('ExpT', ['function_index', 'arity', 'label'])
    imports = table('ImpT', ['module_index', 'function_index', 'arity'])
    lambdas = table('FunT', ['function_index', 'arity', 'label', 'index', 'free_vars', 'old_unique'])
    code = None
    if 'Code' in selected:
        start, end = selected['Code']
        size = u32(start)
        assert size >= 16 and start + 4 + size <= end
        code = dict(zip(['instruction_set', 'opcode_max', 'labels', 'functions'],
                        struct.unpack_from('>IIII', data, start + 4)))
        code.update(extra_header_bytes=size - 16,
                    instructions=dict(offset=start + 4 + size, bytes=end - start - 4 - size))
    return dict(artifact=dict(path=str(path), sha256=hashlib.sha256(data).hexdigest(), bytes=len(data)),
                form=dict(location=dict(offset=0, bytes=len(data)), size=len(data) - 8),
                chunks=chunks, atoms=atoms, atom_encoding='utf8' if atom_name == 'AtU8' else 'latin1',
                exports=exports, imports=imports, lambdas=lambdas, code=code,
                module=atoms[0]['name'],
                coverage=dict(status='complete', examined_chunks=len(chunks), atoms=len(atoms)))


def main():
    options, remaining = getopt.getopt(sys.argv[1:], '', ['input=', 'output=', 'name='])
    assert not remaining
    inputs = [v for k, v in options if k == '--input']
    outputs = [v for k, v in options if k == '--output']
    names = [v for k, v in options if k == '--name']
    assert len(inputs) == len(outputs) == 1 and names
    path = Path(inputs[0])
    assert path.is_absolute()
    expected = decode(path)
    answer = [dict(source_index=i, **row) for i, row in enumerate(expected['exports'] or [])
              if row['function'] in names]
    result = dict(oracle='Independent Python struct decoding of fixed OTP27 bytes; no BEAM execution. '
                         'Every table, chunk range/hash and Code header checked. Other encodings/malformed inputs unqualified.',
                  source='https://www.erlang.org/doc/apps/stdlib/beam_lib.html',
                  expected=expected, names=names, answer=answer)
    Path(outputs[0]).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
