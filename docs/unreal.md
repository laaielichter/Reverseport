# Unreal Engine files

ReversePort reads Unreal Engine files by their magic, without the Unreal Editor.

| File               | Tool                   | What is read                                                                                                       | What is only reported                    |
| ------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `.pak` (v1 to v11) | `re_archive`           | Entries and compression; extract for stored and Zlib entries                                                       | Encrypted paks and entries (listed only) |
| `.uasset`, `.umap` | `re_unreal`            | Package summary (engine and object versions, flags), name table, imports, exports, main asset, referenced packages | Property bodies (not read)               |
| IoStore `.utoc`    | `re_unreal`            | Header, compression methods and, when the directory index is there, the file list with sizes                       | An encrypted index                       |
| `.locres`          | `re_unreal`            | Namespaces, keys and texts (versions 0 to 3)                                                                       |                                          |
| GVAS `.sav`        | `re_unreal`, `re_save` | Header and the tagged properties with their values (UE 4.x to 5.3)                                                 | Newer tag layouts stop at the header     |

Packages from UE4 (object versions 214 to 522) and UE5 (1000 to 1018) are accepted, also unversioned cooked ones when
the tables fit. Anything else stops with `partial` and the reason instead of a guess.

## Example

A cooked UE4 package built for this page with the writer from `port/test/unreal.test.mjs`:

```bash
reverseport unreal ./SM_Crate.uasset
```

The result, trimmed to the key fields:

```json
{
  "format": "unreal-package",
  "counts": { "names": 9, "imports": 2, "exports": 2 },
  "package": {
    "legacyFileVersion": -7,
    "unversioned": true,
    "assumedLayout": "UE 4.16-4.27 / UE5 early access (object version 511-522)",
    "packageFlags": {
      "names": ["Cooked", "UnversionedProperties", "FilterEditorOnly"]
    },
    "savedByEngineVersion": "4.27.2-18319896+++UE4+Release-4.27"
  },
  "summary": {
    "mainAsset": { "name": "SM_Crate", "class": "StaticMesh" },
    "referencedPackages": {
      "total": 1,
      "script": [{ "package": "/Script/Engine", "objects": 1 }]
    }
  },
  "imports": {
    "items": [
      {
        "index": -2,
        "className": "Class",
        "objectName": "StaticMesh",
        "path": "/Script/Engine.StaticMesh"
      }
    ]
  },
  "exports": {
    "items": [
      {
        "index": 1,
        "objectName": "SM_Crate",
        "class": "StaticMesh",
        "serialSize": 200,
        "isAsset": true
      }
    ]
  },
  "note": "Export data runs past this file (to offset 961): it lives in the .uexp beside it (bulk data in .ubulk). Properties are unversioned (schema-driven, no tags): export bodies need the game's type mappings (.usmap) and are not read here."
}
```

`--match` filters names, paths and keys (substring, glob or `/regex/`); `--limit` sets the entries per list
(default 50).

## How well it works

The package reader parsed 413 public Unreal packages. The `.utoc` reader is tested on self-built fixtures
only: no real IoStore container was available, so treat its file lists as less proven than the rest.

## Limits

- Read-only: encrypted or Oodle-compressed data is reported, never opened.
- Property bodies of exports are not read. Imports tell you what an asset needs (`/Script/…` is a C++ class in the
  game binary, `/Game/…` another asset); exports are the objects it defines.
- GVAS saves with UE 5.4+ property tags stop at the header.
- For the native code of a game (the `/Script/…` classes), use `re_binary` or the deep-analysis engine.
