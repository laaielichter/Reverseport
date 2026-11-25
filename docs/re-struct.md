# An unknown format, from sample files (`re_struct`)

Give `re_struct` 2 to 32 files of the same unknown binary format (saves, levels, packets, custom archives). It
compares them side by side and returns the layout as fields, each with the evidence that the samples gave for it.

## What it finds

| Field               | How the samples show it                                                             |
| ------------------- | ----------------------------------------------------------------------------------- |
| Magic, version, pad | Bytes that are the same in every sample                                             |
| Length              | A number that follows the file size, or the size of the bytes after it              |
| Record count        | Count x record size = what follows; the columns of the record table come with it    |
| Checksum            | A CRC-32 or Adler-32 field with what it covers; MD5, SHA-1, SHA-256 or CRC trailers |
| Time                | Unix times that lie close together                                                  |
| Offset              | A number that lands on the same bytes in every sample                               |
| Text                | Text with a length in front or a NUL behind it                                      |
| Kaitai Struct draft | The same layout as a `.ksy` file in `ksy`, to continue in the Kaitai tools          |

A text of a different length per sample does not end the comparison: every sample keeps its own cursor, and `offset`
becomes a list.

## Example

Four saves of a made-up format, built for this page (the same layout as the fixture in `port/test/struct.test.mjs`):
a header, a body size, a CRC-32, a time, a player name and a table of 12-byte records.

```bash
reverseport struct ./saves "*.sav"
```

The result, trimmed to the key fields:

```json
{
  "summary": "6 fields before the data starts; 5 with a meaning the samples prove (length, count, checksum, time, offset or text).",
  "fields": [
    {
      "offset": 0,
      "size": 12,
      "type": "constant",
      "role": "magic",
      "hex": "53 41 56 45 03 00 00 00 00 00 00 00"
    },
    {
      "offset": 12,
      "type": "u4le",
      "values": [56, 145, 30, 326],
      "role": "length",
      "note": "the size of the file minus 16 (what follows a 16-byte header, which ends right after this field)"
    },
    {
      "offset": 16,
      "type": "u4le",
      "role": "checksum",
      "note": "CRC-32 of the bytes after this field"
    },
    {
      "offset": 20,
      "type": "u4le",
      "values": [1700000000, 1710000123, 1722222222, 1733333333],
      "role": "time"
    },
    {
      "offset": 24,
      "type": "u4le length + text",
      "role": "string",
      "values": ["Roel", "Alexandra", "Bo", "Player One"]
    },
    {
      "offset": [32, 37, 30, 38],
      "type": "u4le",
      "values": [3, 10, 1, 25],
      "role": "count",
      "stride": 12
    }
  ],
  "records": {
    "size": 12,
    "columns": [
      {
        "offset": 0,
        "type": "u4le",
        "note": "whole numbers that rise from record to record (an id or an index)"
      },
      {
        "offset": 4,
        "type": "f4le",
        "note": "every record reads as a sensible float here"
      },
      {
        "offset": 8,
        "type": "u4le",
        "note": "large values: flags, a hash, an id, or not a little-endian number"
      }
    ]
  }
}
```

And the start of the Kaitai Struct draft in `ksy`:

```yaml
meta:
  id: sav
  endian: le
seq:
  - id: magic
    contents:
      [0x53, 0x41, 0x56, 0x45, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
  - id: len_body
    type: u4le
  - id: checksum
    type: u4le
  - id: timestamp
    type: u4le
  - id: len_text
    type: u4le
  - id: text
    type: str
    size: len_text
    encoding: UTF-8
  - id: num_records
    type: u4le
  - id: records
    type: record
    repeat: expr
    repeat-expr: num_records
```

## Options

| Option  | What it does                                                                               |
| ------- | ------------------------------------------------------------------------------------------ |
| `files` | The sample files (CLI: `--files a.sav,b.sav`)                                              |
| `path`  | Or a folder with the samples; `match` picks them (`"*.sav"` or `/slot\d+\.dat/`)           |
| `maxKB` | KiB of each sample to read (default 1024). A checksum over the whole file needs all of it. |

## Limits

- The result is a hypothesis from the samples you gave. A field marked constant may be a value that no sample
  changes. Run the page's example with only three of the four saves and the header reads differently: the samples
  no longer rule out another split. Add samples that differ in one known thing (one more item, another name) and
  run again.
- It is read-only and decrypts and decompresses nothing.
- With one file only, use `re_probe` (hex view, entropy, embedded files, record strides). For a save in an open
  format (JSON, gzip, Godot `store_var`, GVAS, plist), use `re_save`.
- Keep the proof with `re_case` when someone will act on the layout.
