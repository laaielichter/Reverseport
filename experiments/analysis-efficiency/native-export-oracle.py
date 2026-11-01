"""Independent readelf symbol facts and directly mapped ELF64 version indices."""
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import sys

path = Path(sys.argv[1]).resolve()
selected_names = sys.argv[2:]
source = path.read_bytes()
assert source[:6] == b'\x7fELF\x02\x01', 'This experiment oracle only covers ELF64 little-endian'
section_offset = struct.unpack_from('<Q', source, 40)[0]
section_width, section_count = struct.unpack_from('<HH', source, 58)
assert section_width == 64 and section_count > 0
sections = [struct.unpack_from('<IIQQQQIIQQ', source, section_offset + i * section_width) for i in range(section_count)]
dynsym_index = next(i for i, row in enumerate(sections) if row[1] == 11)
version_section = next(row for row in sections if row[1] == 0x6fffffff and row[6] == dynsym_index)
text = subprocess.check_output(['readelf', '--dyn-syms', '--wide', str(path)], text=True)
pattern = re.compile(r'^\s*(\d+):\s+([0-9a-f]+)\s+(\d+)\s+(\w+)\s+(\w+)\s+(\w+)\s+(\S+)\s+(\S+)')
rows = []
for line in text.splitlines():
    match = pattern.match(line)
    if not match:
        continue
    ordinal, value, size, kind, binding, visibility, section, display = match.groups()
    ordinal = int(ordinal)
    if binding not in ['GLOBAL', 'WEAK', 'UNIQUE'] or section == 'UND' or visibility not in ['DEFAULT', 'PROTECTED']:
        continue
    version_word = struct.unpack_from('<H', source, version_section[4] + ordinal * 2)[0]
    if (version_word & 0x7fff) == 0:
        continue
    name, _, version_name = display.partition('@@' if '@@' in display else '@')
    version = None if (version_word & 0x7fff) < 2 else {
        'index': version_word & 0x7fff, 'name': version_name or None,
        'name_bytes_base64': None, 'name_utf8_decodable': True if version_name else None,
        'hidden': bool(version_word & 0x8000),
    }
    rows.append({'source_index': len(rows), 'name': name, 'name_bytes_base64': None, 'name_utf8_decodable': True,
                 'value': hex(int(value, 16)), 'size': size, 'binding': binding.lower(),
                 'type': {'FUNC': 'function', 'IFUNC': 'ifunc', 'OBJECT': 'object', 'TLS': 'tls'}.get(kind, 'other'),
                 'version': version})
selected = [row for row in rows if row['name'] in selected_names]
assert set(row['name'] for row in selected) == set(selected_names)
print(json.dumps({'artifact': {'path': str(path), 'sha256': hashlib.sha256(source).hexdigest(), 'bytes': len(source)},
                  'oracle': subprocess.check_output(['readelf', '--version'], text=True).splitlines()[0],
                  'names': selected_names, 'export_count': len(rows), 'rows': selected}, indent=2))
