"""Independent ELF64 little-endian note oracle for the fixed Linux corpus."""
import argparse
import hashlib
import json
from pathlib import Path
import struct


def inspect(path):
    before = path.stat()
    data = path.read_bytes()
    header = struct.unpack_from('<16sHHIQQQIHHHHHH', data)
    ident, kind, machine, version, _, phoff, shoff, _, _, phsize, phnum, shsize, shnum, names_index = header
    assert ident[:7] == b'\x7fELF\x02\x01\x01' and version == 1 and kind == 3
    assert phsize == 56 and shsize == 64 and 0 < phnum < 65535 and 0 < shnum < 65535
    sections = [struct.unpack_from('<IIQQQQIIQQ', data, shoff + i * shsize) for i in range(shnum)]
    names = sections[names_index]
    assert names[1] == 3 and not names[2] & 0x800
    strings = data[names[4]:names[4] + names[5]]
    tables = []
    for i in range(phnum):
        program = struct.unpack_from('<IIQQQQQQ', data, phoff + i * phsize)
        if program[0] == 4:
            assert program[7] in [4, 8]
            tables.append({'kind':'program','index':i,'name':None,'location':{'offset':program[2],'bytes':program[5]},'alignment':program[7]})
    for i, section in enumerate(sections):
        if section[1] == 7:
            assert section[8] in [4, 8] and not section[2] & 0x800
            name_end = strings.index(0, section[0])
            tables.append({'kind':'section','index':i,'name':strings[section[0]:name_end].decode('ascii'),'location':{'offset':section[4],'bytes':section[5]},'alignment':section[8]})
    entries = []
    type_names = {1:'gnu_abi_tag',2:'gnu_hwcap',3:'gnu_build_id',4:'gnu_gold_version',5:'gnu_property'}
    for table in tables:
        pos = table['location']['offset']
        end = pos + table['location']['bytes']
        alignment = table['alignment']
        while pos < end:
            namesz, descsz, tag = struct.unpack_from('<III', data, pos)
            descriptor_offset = ((12 + namesz + alignment - 1) // alignment) * alignment
            next_offset = ((descriptor_offset + descsz + alignment - 1) // alignment) * alignment
            assert pos + next_offset <= end and namesz == 4 and descsz <= 64
            owner = data[pos + 12:pos + 12 + namesz]
            assert owner == b'GNU\0'
            descriptor = data[pos + descriptor_offset:pos + descriptor_offset + descsz]
            gnu = {'build_id_hex':None,'abi_tag':None,'gold_version':None}
            if tag == 3:
                gnu['build_id_hex'] = descriptor.hex()
            elif tag == 4:
                gnu['gold_version'] = descriptor.split(b'\0', 1)[0].decode('ascii')
            elif tag == 1:
                os_id, major, minor, subminor = struct.unpack('<IIII', descriptor)
                assert os_id == 0
                gnu['abi_tag'] = {'os':os_id,'os_name':'linux','major':major,'minor':minor,'subminor':subminor}
            entries.append({
                'index': len(entries),
                'table_kind': table['kind'],
                'table_index': table['index'],
                'location': {'offset': pos, 'bytes': next_offset},
                'namesz': namesz,
                'descsz': descsz,
                'type': tag,
                'type_name': type_names.get(tag, 'unknown'),
                'owner': 'GNU',
                'owner_bytes_hex': owner.hex(),
                'descriptor': {
                    'location': {'offset': pos + descriptor_offset, 'bytes': descsz},
                    'bytes': descsz,
                    'sha256': hashlib.sha256(descriptor).hexdigest(),
                    'hex': descriptor.hex(),
                },
                'gnu': gnu,
            })
            pos += next_offset
        assert pos == end
    after = path.stat()
    assert (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns) == (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns)
    return {
        'artifact': {'path': str(path), 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)},
        'format': 'elf64',
        'byte_order': 'little',
        'machine': machine,
        'type': kind,
        'type_name': 'shared',
        'tables': tables,
        'entries': entries,
        'coverage': {'status': 'complete', 'examined_tables': len(tables), 'examined_entries': len(entries)},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--path', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    assert args.path.is_absolute()
    expected = inspect(args.path)
    result = {
        'operation': 'inspect_elf_notes',
        'input': {'path': str(args.path), 'max_file_bytes': 268435456},
        'expected': expected,
        'question': 'Return every declared ELF note table and note, preserving program/section identity, file ranges, raw owner bytes, descriptor digests, GNU fields and complete source Evidence.',
    }
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'artifact':expected['artifact'],'tables':len(expected['tables']),'entries':len(expected['entries'])}))


if __name__ == '__main__':
    main()
