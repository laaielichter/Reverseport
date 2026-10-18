# ReversePort site

The one-page site at <https://laaielichter.github.io/Reverseport/>. Plain HTML, no build step.
`.github/workflows/site.yml` publishes this folder to GitHub Pages on every push to `main` that touches `site/`.

## The terminal replay

The replay in `index.html` (the `RUN` list) and `docs/assets/demo.gif` show a real run of ReversePort on
[Godot's 2D platformer demo](https://github.com/godotengine/godot-demo-projects/tree/master/2d/platformer), with the
JSON trimmed to the key fields. To check or refresh it:

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/godotengine/godot-demo-projects
(cd godot-demo-projects && git sparse-checkout set 2d/platformer)
cp -r godot-demo-projects/2d/platformer ./platformer
export REVERSEPORT_HOME="$PWD/rphome"
RP="node /path/to/reverseport/bin/reverseport.mjs"
$RP scan ./platformer | jq -c '{engine: .primary.name, mainScene: .engines[0].details.mainScene, scripts: .languages.gdscript.files, files}'
$RP plan ./platformer --to unity | tee plan.json | jq -c '{planId, units, byAction, risky}'
ID=$(jq -r .planId plan.json)
$RP copy-assets "$ID" | jq -c '{copied, percent: .progress.percent}'
$RP port-scene "$ID" u041 | jq -c '.written'
$RP verify "$ID" | jq -c '{passed, leftovers, missingSymbols, pending: .progress.pending}'
```

The plan id ends in a random suffix, so it differs per run. After changing `RUN`, record the GIF from
`index.html#demo` (an 820×720 viewport shows only the terminal), for example with Playwright's video recording, and
convert it with ffmpeg.

## Images

- `og.png` (1280×640) is the sharing image. The same file is `docs/assets/social-preview.png`, for
  Settings > General > Social preview on GitHub.
- `favicon.svg` is the logo mark.
