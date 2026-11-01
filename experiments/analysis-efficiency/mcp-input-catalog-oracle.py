"""Independent ELF64 little-endian / zlib oracle for the pinned Alpine corpus."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import zlib


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    assert args.artifact.stat().st_size <= 256 * 1024 ** 2
    binary = args.artifact.read_bytes()
    assert binary[:6] == b"\x7fELF\x02\x01"
    table = struct.unpack_from("<Q", binary, 40)[0]
    stride, count, strings_index = struct.unpack_from("<HHH", binary, 58)
    assert stride == 64 and 0 < count < 65535 and strings_index < count
    sections = [struct.unpack_from("<IIQQQQIIQQ", binary, table + index * stride)
                for index in range(count)]
    string_row = sections[strings_index]
    names = binary[string_row[4]:string_row[4] + string_row[5]]
    matches = [row for row in sections
               if names[row[0]:names.index(b"\0", row[0])] == b".dep-v0"]
    assert len(matches) == 1
    row = matches[0]
    assert row[5] <= 1024 ** 2
    compressed = binary[row[4]:row[4] + row[5]]
    decoder = zlib.decompressobj()
    decoded = decoder.decompress(compressed, 8 * 1024 ** 2 + 1)
    assert len(decoded) <= 8 * 1024 ** 2 and decoder.eof
    assert not decoder.unconsumed_tail and not decoder.unused_data
    raw = json.loads(decoded)
    packages = [{"name": item["name"], "version": item["version"],
                 "source": item.get("source"), "kind": item.get("kind"),
                 "dependencies": item.get("dependencies", []), "root": item.get("root", False)}
                for item in raw["packages"]]
    result = {
        "artifact_sha256": hashlib.sha256(binary).hexdigest(),
        "section_sha256": hashlib.sha256(compressed).hexdigest(),
        "json_sha256": hashlib.sha256(decoded).hexdigest(),
        "packages": packages,
        "edges": [{"from_index": index, "to_index": destination}
                  for index, item in enumerate(packages) for destination in item["dependencies"]],
        "serde_rows": [{"index": index, **{key: item[key] for key in ["name", "version", "kind"]}}
                       for index, item in enumerate(packages) if item["name"] == "serde"],
    }
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
