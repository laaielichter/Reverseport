# Elke agent verbinden

_English: [connect-any-agent.md](connect-any-agent.md)_

ReversePort werkt hetzelfde voor elke agent, ongeacht wie hem heeft gemaakt en hoe groot of klein het model is. Kies de deur
die bij je agent past; ze komen allemaal uit bij dezelfde tools.

| Je agent                                                                                                         | Deur                                | Eén commando                                                     |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------- |
| Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, OpenCode en andere geïnstalleerde agents                 | MCP (stdio), voor je geconfigureerd | `npx -y reverseport@latest setup`                                |
| Elke MCP-client, handmatig geconfigureerd (Windsurf, Cline, Roo Code, Continue, Zed, Goose, LM Studio, VS Code…) | MCP (stdio)                         | `reverseport connect <client>` toont het exacte fragment         |
| Clients die een MCP-URL accepteren (n8n, LangChain `MultiServerMCPClient`, Open WebUI via mcpo…)                 | MCP via HTTP                        | `reverseport serve` → `http://127.0.0.1:32147/mcp`               |
| OpenAI Chat Completions / Responses, OpenAI-compatibele servers (vLLM, Ollama, LM Studio, llama.cpp)             | Functieaanroepen                    | `GET /api/agent/tools?format=openai-strict` (of `responses`)     |
| Anthropic Messages API                                                                                           | Toolgebruik                         | `GET /api/agent/tools?format=anthropic`                          |
| Gemini API                                                                                                       | Functiedeclaraties                  | `GET /api/agent/tools?format=gemini`                             |
| LangChain/LlamaIndex OpenAPI tools, Semantic Kernel, CrewAI, AutoGen, n8n HTTP                                   | OpenAPI 3.1                         | `GET /api/openapi.json`                                          |
| Agents die alleen opdrachten kunnen uitvoeren                                                                    | CLI met JSON                        | `reverseport describe <tool>`, `reverseport <tool> --args '{…}'` |

`reverseport connect` zonder client toont ze allemaal. Voeg `--mode local` toe om een fragment naar je checkout te laten verwijzen in plaats van `npx`. Zowel setup als `connect` registreren de server onder de naam `rea`, dus beide uitvoeren voegt hem
twee keer. Gebruik in Claude Code `setup` of de plugin, niet beide: de plugin bevat zijn eigen kopie van de server.

The Claude Code plugin installed from GitHub has no built deep-analysis engine; it starts with ReversePort's own
tools. Zet de plugin-instelling **Deep-analysis engine** aan (`/plugin` → reverseport → configure) om de
gepubliceerde engine via `npx` uit te voeren (eenmalig gedownload); `REVERSEPORT_ENGINE_FETCH=npx` doet hetzelfde. Met
de andere instellingen kies je de lengte van de tool-lijst, de werkmap en je Ghidra-map, zonder `settings.json` met de
hand aan te passen.

## Functieaanroepen via HTTP

```bash
reverseport serve                     # http://127.0.0.1:32147 (REVERSEPORT_PORT to change)
curl -s "http://127.0.0.1:32147/api/agent/tools?format=openai-strict" > tools.json
curl -s -X POST http://127.0.0.1:32147/api/agent/call \
  -H 'content-type: application/json' \
  -d '{"name":"re_scan","arguments":{"path":"/absolute/path/to/game"}}'
```

Een volledige cyclus met de OpenAI Python SDK (werkt hetzelfde met Ollama, vLLM of LM Studio door `base_url` te wijzigen):

```python
import json, requests
from openai import OpenAI

api = "http://127.0.0.1:32147"
tools = requests.get(f"{api}/api/agent/tools", params={"format": "openai-strict"}).json()
client = OpenAI()
messages = [{"role": "user", "content": "What engine is /games/demo made with?"}]
while True:
    reply = client.chat.completions.create(model="gpt-4.1", messages=messages, tools=tools).choices[0].message
    messages.append(reply)
    if not reply.tool_calls:
        break
    for call in reply.tool_calls:
        result = requests.post(f"{api}/api/agent/call", json={"name": call.function.name, "arguments": json.loads(call.function.arguments)}).json()
        messages.append({"role": "tool", "tool_call_id": call.id, "content": json.dumps(result)})
print(reply.content)
```

LangChain, through MCP (`pip install langchain-mcp-adapters`):

```python
from langchain_mcp_adapters.client import MultiServerMCPClient

client = MultiServerMCPClient({"reverseport": {"command": "npx", "args": ["-y", "reverseport@latest", "mcp"], "transport": "stdio"}})
tools = await client.get_tools()
```

Formats: `mcp`, `openai`, `openai-strict`, `responses`, `anthropic`, `gemini`, `json-schema`. In de strikte indelingen
elk argument is vereist en optionele argumenten accepteren `null`; `null` betekent "niet gegeven". Elke deur accepteert ook
getallen en booleans die als strings worden verzonden (`"20"`, `"true"`) en objecten die als JSON-tekst worden verzonden. Voor de eigen tools van ReversePort,
worden getallen buiten het toegestane bereik begrensd en het resultaat vermeldt dit onder `adjusted`. In `openai-strict`
en `responses` zijn de tools strikt: een vrij object (zoals `arguments` in `run_batch`) gaat als JSON-tekst mee, en
ReversePort leest die terug. Alleen een schema dat nog steeds niet strikt kan (een eigenschap zonder enig type) gaat
mee met `strict: false`. Unions houden elke optie: een veld dat in meerdere vormen voorkomt, houdt al zijn toegestane
waarden, en de beschrijving zegt welke velden bij elkaar horen. Grenzen die een indeling niet kent (`minLength`,
`multipleOf`, …) komen in de beschrijving. Functiebeschrijvingen blijven binnen 1024 tekens, OpenAPI-beschrijvingen
binnen 300 (de grens van GPT Actions), afgekapt na een hele zin — `/api/openapi.json?descriptions=full` geeft de hele
tekst.

De server antwoordt alleen op localhost. Pagina's die vanaf localhost worden aangeboden, kunnen het vanuit een browser aanroepen (CORS). Stel `REVERSEPORT_TOKEN` in om `Authorization: Bearer <token>` te vereisen. Om het vanuit Docker of via een tunnel te bereiken (gehoste agents zoals GPT Actions hebben een openbare HTTPS-URL nodig), stel `REVERSEPORT_TOKEN`, `REVERSEPORT_HOST=0.0.0.0` and
`REVERSEPORT_ALLOWED_HOSTS=<host names>`; zonder token weigert de server buiten deze machine te luisteren.

## MCP-versies en lange klussen

De server spreekt beide MCP-tijdperken op dezelfde verbinding. Clients die met `initialize` beginnen krijgen de
klassieke sessie (2025-11-25 en ouder). Clients op MCP 2026-07-28 sturen `server/discover` of een verzoek met
`io.modelcontextprotocol/protocolVersion` in `_meta` en worden zonder handdruk bediend: elk resultaat heeft
`resultType`, lijsten hebben `ttlMs` en `cacheScope`, en `tools/list` houdt een vaste volgorde, zodat de
prompt-cache van de agent warm blijft.

Een 2026-07-28-client die de extensie `io.modelcontextprotocol/tasks` meldt, krijgt lange aanroepen als taak: een
`tools/call` die na 2,5 seconde nog loopt, geeft een taaknummer terug in plaats van te blijven wachten. `tasks/get`
toont de stand (voortgang van de motor komt in `statusMessage`) en aan het eind het gewone resultaat.
`tasks/cancel` stopt de taak. Snelle aanroepen antwoorden direct, dus niets wordt trager. Taaknummers gelden zes
uur en overleven geen herstart van de server. `REVERSEPORT_TASK_AFTER_MS` verandert de 2,5 seconde. Claude Code
gebruikt taken in de CLI vanaf v2.1.304.

`subscriptions/listen` (stdio) meldt `notifications/tools/list_changed` als de motor start of stopt, of als het
tool-profiel verandert. Via HTTP antwoordt het endpoint alleen met JSON; vraag daar `tools/list` gewoon opnieuw op.

## Pas de tool-lijst aan de agent aan

Elke agent kan elke tool bereiken. Wat verandert, is hoeveel er vooraf wordt weergegeven:

| Profiel              | Toont                                                                                          | Tools                          | Voor                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| `compact`            | 9 ReversePort-tools voor verkennen en porten + 6 essentiële engine-tools, korte beschrijvingen | 19 tools (11 zonder de engine) | kleine of oudere modellen, kleine contextvensters                      |
| `standard` (default) | alle 33 ReversePort-tools + 20 kern-engine-tools                                               | 57 tools (35 zonder de engine) | de meeste agents                                                       |
| `full`               | elke tool                                                                                      | meer dan 200 tools             | agents met grote contextvensters waarvan de client dit aantal toestaat |

De aantallen tellen `set_tool_profile` en `run_batch` mee, en met de engine ook `engine_tools` en `engine_call`.
`reverseport tools --profile compact` toont de lijst zelf.

Sommige clients beperken het aantal tools (Cursor heeft ongeveer 40 gebruikt, VS Code en OpenAI 128, Windsurf 100). Kies
`compact` voor een strikte limiet. Stel het profiel in met `REVERSEPORT_PROFILE`, of laat de agent op elk moment wisselen
met `set_tool_profile`. Een tool die niet in de lijst staat, werkt nog steeds als je hem bij naam aanroept; met de
engine vindt `engine_tools {query}` elke andere engine-tool en roept `engine_call {tool, arguments}` hem aan.
`REVERSEPORT_TOOLS=all|port|name,glob*` selecteert exact de vermelde tools.

Over HTTP houdt elke MCP-sessie een eigen profiel en een eigen herhaalbewaking, zodat de ene client nooit verandert wat
een andere ziet. Verzoeken zonder sessie onthouden niets; vraag dan om een profiel in het adres: `/mcp?profile=compact`,
`/api/agent/tools?profile=compact` of `/api/openapi.json?profile=compact`. Een sessie die is beëindigd (of nooit
bestond) krijgt HTTP 404 met JSON-RPC-fout `-32001`: stuur dan opnieuw `initialize`.

Strikte schemavalidators (Gemini, OpenAI strict mode, sommige lokale modelservers) wijzen sommige JSON-Schema-functies af die de
deep-analysis-engine gebruikt (`$ref`, unions, dependent fields). `REVERSEPORT_SCHEMA=portable` vermeldt elk schema in een
form they accept (het `compact`-profiel doet dit altijd), en de HTTP-indelingen `openai-strict`, `responses` and `gemini`
doen dit altijd. De server valideert nog steeds het volledige schema.

## Grote resultaten overspoelen de context niet

Via MCP en HTTP, a tool result larger than 256 KB is saved whole to `~/.reverseport/tool-output/` (or under
`REVERSEPORT_HOME`). De agent krijgt een verkort resultaat: de langste lijsten behouden hun eerste items, lange tekst behoudt zijn
eerste regels, en `outputTruncated` (of een afsluitende regel voor platte tekst) vermeldt wat is ingekort en waar het volledige resultaat staat. Opgeslagen resultaten worden na 7 days. `REVERSEPORT_MAX_OUTPUT_BYTES` stelt een andere limiet in (minimaal 4096
bytes), of `off`. De CLI toont altijd het volledige resultaat.

## Meerdere stappen in één aanroep

`run_batch` voert tot 20 tool-aanroepen na elkaar uit en antwoordt één keer. Met `select` houd je per resultaat alleen
de velden die je nodig hebt (`"primary.id"`, `"entryPoints[*].file"`); dat spaart context en heen-en-weer. Bij de
eerste fout stopt het en zegt het welke aanroep je moet aanpassen en waar je verder kunt; `continueOnError: true`
voert de rest toch uit. Een `select`-pad dat niets vindt, staat voor die stap onder `unresolved`, met de reden en het
pad dat wel werkt (`"primry.id"` → `"primary.id"`, `"entryPoints.file"` → `"entryPoints[*].file"`). Ook motor-tools werken. Grote resultaten krijgen via MCP een `resource_link` naar
`reverseport://tool-output/<bestand>`, zodat clients zonder bestandstoegang het volledige resultaat kunnen lezen.

Faalt precies dezelfde aanroep twee keer in dezelfde sessie (drie keer bij fouten met `retryable`), dan komt de fout terug
met `repeated` en `retryable: false` en de duidelijke boodschap: stuur hem niet ongewijzigd opnieuw, maar pas de
invoer aan, kies een andere tool of vertel de gebruiker wat er in de weg zit.

## Fouten zien er overal hetzelfde uit

Tool-aanroepen via elke deur geven hetzelfde foutobject terug, zodat een agent kan handelen zonder te hoeven raden:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "category": "invalid_input",
    "retryable": false,
    "message": "project folder not found: /games/demo",
    "remediation": {
      "action": "Check the path; absolute paths are safest. Ask the user where the file is if you cannot find it."
    }
  }
}
```

De codes van ReversePort zijn in hoofdletters (`NOT_FOUND`, `INVALID_ARGUMENT`, `ENGINE_STOPPED`…); die van de
deep-analysis-engine in kleine letters (`provider_unavailable`, `resource_constraint`…). Beide gebruiken dezelfde categorieën en bevatten `retryable`
en `remediation`. Een onbekende toolnaam levert een toolresultaat met `UNKNOWN_TOOL` en de meest overeenkomende naam. In de CLI eindigen
gebruiksfouten met 2 en andere fouten met 1; de fout is JSON op stderr (in een interactieve terminal toont het `reverseport`-commando in plaats daarvan platte tekst). Via HTTP volgt de status de code: 400 voor invoer, 404 voor een onbekende tool, 503 wanneer de engine of een openbare bron niet beschikbaar is, 500 voor onverwachte fouten.

De engine-statussen zijn verschillend, dus de volgende stap is altijd duidelijk: `ENGINE_UNAVAILABLE` (not built — install it),
`ENGINE_OFF` (turned off — unset `REVERSEPORT_ENGINE`), `ENGINE_STOPPED` (crashed — call again once; it restarts),
`ENGINE_RESTART_LIMIT` (kept crashing — tell the user).

## Laat weten wat in de weg stond

Agents kunnen op elk moment een notitie achterlaten met `share_feedback`: wat hielp, wat verwarrend of traag was, wat de volgende keer zou helpen. Notities blijven op de computer van de gebruiker (`reverseport feedback` toont ze) totdat de gebruiker ze deelt.
Ze helpen de volgende release vorm te geven.
