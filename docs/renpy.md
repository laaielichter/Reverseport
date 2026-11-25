# Ren'Py games

ReversePort reads a Ren'Py game without Ren'Py installed.

| File              | Tool         | What you get                                                       |
| ----------------- | ------------ | ------------------------------------------------------------------ |
| Game folder       | `re_scan`    | Engine, languages, entry points                                    |
| `.rpa` archive    | `re_archive` | The file list; `action:"extract"` writes scripts, images and audio |
| `.rpyc`, `.rpymc` | `re_decode`  | The compiled script back as `.rpy` text                            |
| `.rpy` scripts    | `re_strings` | Dialogue and menu texts as `.pot` or `.csv`                        |

`re_decode` reads scripts from Ren'Py 6.99 to 8.x: labels, dialogue, menus, screens, ATL and translations. Give it
one file or the folder that `re_archive` extracted.

## Example

`tutorial_playing.rpyc` from the Ren'Py tutorial, compiled by Ren'Py 8.2 (the same file the tests use):

```bash
reverseport archive ./game/archive.rpa --action extract   # when the scripts are in an .rpa; prints the folder
reverseport decode ./game                                # a folder with .rpyc files, or one file
```

The result, trimmed to the key fields:

```json
{
  "decoded": 1,
  "byKind": { "rpy": 1 },
  "files": [
    {
      "file": "tutorial_playing.rpyc",
      "decoded": "tutorial_playing.rpy",
      "container": "RPYC2",
      "statements": 54,
      "atlNodes": 1,
      "notDecompiled": 0,
      "renpy": { "scriptVersion": 5003000, "pickleProtocol": 2, "python": 3 }
    }
  ]
}
```

The start of the written `tutorial_playing.rpy`:

```text
transform popup_place:
    xpos 0.1 xanchor 0.0 ypos 0.1 yanchor 0.0


label tutorial_playing:

    e "As someone who has played more than a few visual novels, there are many features that I expect all games to have."

    e "Features like saving, loading, changing preferences, and so on."
```

## How well it works

On the Ren'Py 8.2 test cases of unrpyc, 28 of 28 come out byte-identical to unrpyc's own output.

## Limits

- Comments are not in a compiled script, so they are gone. Blank lines follow the stored line numbers.
- A node class the printer does not know becomes a comment line and is counted in `notDecompiled`; it is not
  guessed.
- The pickle inside a `.rpyc` is read as data and never executed.
- Encrypted files are reported, never decrypted.
- The statement printer is a Node port of [unrpyc](https://github.com/CensoredUsername/unrpyc) (MIT). Its notice is
  kept in
  [THIRD_PARTY_NOTICES.md](https://github.com/laaielichter/reverseport/blob/main/THIRD_PARTY_NOTICES.md) and
  [licenses/unrpyc-MIT.txt](https://github.com/laaielichter/reverseport/blob/main/licenses/unrpyc-MIT.txt).
