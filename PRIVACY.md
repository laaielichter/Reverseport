# Privacy

ReversePort runs on your computer. It has no account, no telemetry and no analytics, and it sends nothing about
you, your files or your agent to the maintainers or anyone else.

## What stays on your computer

- The targets you point it at. ReversePort reads them and never changes them.
- Everything it writes: plans, extracted files, reports, proof cases and saved results, in `~/.reverseport`
  (or `REVERSEPORT_HOME`), and port output in the folder you choose.
- Notes an agent leaves with `share_feedback`. They stay in `~/.reverseport/feedback/feedback.jsonl` until you
  decide to share them yourself.

## When it uses the network

Only for what you or your agent ask, and never with the contents of your files:

- `re_lookup` reads public pages about a game or app you name: PCGamingWiki, Steam, Wikidata, the App Store,
  Google Play and GitHub. It sends only the name, address or repository you gave it.
- Installing or updating (`npx reverseport`, `setup`, the plugin's engine setting) downloads the package from
  npm. `setup --install-hopper` downloads Hopper from its publisher, and only when you ask for it.
- Tools that observe a web page or app reach only the target you name.
- When you connect a decompiler (Ghidra, IDA, Hopper), ReversePort talks to it on your own machine.

The HTTP server (`reverseport serve`) listens on localhost only, unless you set `REVERSEPORT_HOST` together with
`REVERSEPORT_TOKEN`.

## Contact

Questions: open an issue at https://github.com/laaielichter/reverseport/issues.
