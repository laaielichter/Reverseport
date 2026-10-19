# ReversePort (Nederlands)

**Reverse engineer alles. Port het overal naartoe.**

Eén CLI en één MCP-server waarmee je coding-agent (Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, OpenCode
en meer) apps, games, binaries en websites uit elkaar haalt — en ze opnieuw opbouwt of naar een andere engine of taal
port. Alles draait lokaal; het doelwit wordt alleen gelezen.

<img src="assets/demo.gif" alt="Terminal: ReversePort scant de 2D-platformerdemo van Godot, plant een port naar Unity met 68 onderdelen, kopieert 38 assets, zet een scène om en controleert de voortgang" width="640">

Een echte run op de [2D-platformerdemo van Godot](https://github.com/godotengine/godot-demo-projects/tree/master/2d/platformer),
de JSON ingekort tot de belangrijkste velden. Website: <https://laaielichter.github.io/Reverseport/>

## Installeren

Met Node.js 22.19 of nieuwer:

```bash
npx reverseport setup
```

Kies je agents, bekijk de wijzigingen en keur ze goed. Setup registreert één MCP-server en installeert de skill, met
back-ups van je bestaande configuratie. Herstart daarna je agent.

Claude Code kan ook de plugin gebruiken (met de port-skills en de `port-architect`-agent):

```text
/plugin marketplace add laaielichter/reverseport
/plugin install reverseport@reverseport
```

Dezelfde marketplace heeft ook de zusterplugins [Stashpad](https://github.com/laaielichter/stashpad) (geheugen voor
agents dat je kunt lezen en nakijken: `/plugin install stashpad@reverseport`) en
[agentdisk](https://github.com/laaielichter/agentdisk) (wat agents op je schijf achterlaten, en opruimen met undo:
`/plugin install agentdisk@reverseport`; daarvoor moet de `agentdisk`-binary geïnstalleerd zijn). Met agentdisk
erbij laat `reverseport port doctor` zien wat opruimen van de werkmap echt oplevert; proof cases en port-plannen
komen nooit in een opruimplan.

Vanuit de broncode: `git clone https://github.com/laaielichter/reverseport`, dan `npm ci && npm run build` en
`./bin/reverseport.mjs setup`. De verken-, build-, lookup-, blueprint- en port-commando's werken direct na de clone,
zonder installatie: `node bin/reverseport.mjs scan ./MijnGame`.

## Wat het kan

- **Verkennen** — `re_scan` herkent engine en versie (Godot, Unity, Unreal, GameMaker, RPG Maker, Ren'Py, LÖVE,
  Defold, Bevy, MonoGame, three.js, Electron…), talen en startpunten, ook van geëxporteerde builds. Afhankelijkheden
  (`re_graph`), klassen en signalen (`re_symbols`), scènes (`re_scene`), executables (`re_binary`), packs zoals
  Godot `.pck` — ook in de `.exe` (`re_archive`) — onbekende data (`re_probe`, `re_extract`) en verschillen tussen
  builds (`re_compare`).
- **Diep gaan** — decompileren, cross-references en call-paden van native, .NET-, Android-, Electron/JavaScript-,
  WebAssembly-, firmware- en browserdoelen via Ghidra, Hopper, IDA, JADX en meer, met het bewijs bij elke conclusie.
- **Zonder bestanden** — `re_lookup` zoekt een game, app, website of publieke repo op in openbare bronnen: engine met
  betrouwbaarheid, stack, waar de bestanden staan en bestaande open-source remakes.
- **Precies nabouwen** — `re_blueprint` maakt daar een clean-room bouwspecificatie van: systemen, wat je aan het
  origineel meet, een `parity.json` en een projectskelet met elke waarde als instelbare parameter.
- **Porten** — Godot ⇄ Unity, Godot → Unreal, Godot → three.js, GDScript → Godot C#, of van taal naar taal. Scènes en
  transformaties gaan automatisch; de agent port de code per bestand (`port_unit`, `port_write`) en `port_verify`
  controleert dat er niets ontbreekt.
- **Bewijs bijhouden** — `re_case` houdt per onderzoek of port een dossier bij: bewijs met een vingerafdruk (SHA-256),
  claims die dat bewijs noemen, open vragen, beslissingen met de afgewezen opties en echte tests. Pas als alle
  poorten groen zijn, is het klaar. Met [Stashpad](https://github.com/laaielichter/stashpad) erbij onthoudt het wat
  eerdere sessies vonden; nieuwe feiten wachten tot jij ze goedkeurt. Zie [proof-and-memory.nl.md](proof-and-memory.nl.md).
- **Echte port-problemen** — `re_apicheck` vangt Godot 3-namen en verzonnen API's, `port_upgrade` zet Godot 3 om naar
  4, `re_save` leest savebestanden, `port_shader` zet shaders om, `port_convert {physics}` houdt springen en vallen
  gelijk, `port_trace` vindt de eerste tick waarop twee versies verschillen, en `re_il2cpp` en `port_rpgmaker` helpen
  bij Unity IL2CPP en RPG Maker.
- **Monorepo's en websites** — `re_scan` en `re_graph` begrijpen JS/TS-monorepo's (pnpm, Turborepo, Nx, tsconfig
  paths) en Rust-workspaces. `capture_web_screenshot` met een `selector` geeft van één element op een site een
  bijgesneden afbeelding, de HTML en de CSS.

## Skills

Setup en de Claude Code-plugin installeren skills, zodat de agent zelf weet welke stap volgt: `reverse-engineer`
(hoe werkt dit), `build-inspector` (geëxporteerde builds), `rebuild` (nabouwen zonder bestanden), `port-project`,
`godot-port` en `unity-to-godot` (porten), `port-verify` (de eindcontrole), `proof-case` (bewijs bijhouden) en
`troubleshoot` (fouten oplossen). De plugin voegt ook de agent `port-architect` en de bewakers-hooks toe.
`reverseport skills get <naam>` toont de skill die bij jouw versie hoort.

Vraag daarna gewoon: "Waar is deze game mee gemaakt?", "Wat is er veranderd tussen build 43 en 44?", "Decompileer de
functie die de instellingen opslaat en leg uit wat ze doet.", "Port mijn Godot-game naar Unity."

Werkmap: `~/.reverseport` (verplaatsen met `REVERSEPORT_HOME`). Alleen voor eigen software of software die je mag
analyseren; ReversePort kraakt, ontsleutelt of omzeilt niets. Licentie: MIT.

## Steunen

ReversePort is gratis en open source. Bespaart het jou of je agent tijd, dan is een gift welkom, maar nooit verplicht.
SOL en elke token op Solana (zoals USDC) kunnen naar:

- **Solana:** `BDRA7dHGBYtPsZPNzVQccDYZ8BqstJGCsWx3kopPSCDK`

Giften gaan naar nieuw modeltegoed om ReversePort te verbeteren, en naar werk aan betere arbeidsomstandigheden en
welzijn voor LLM's en agents.
