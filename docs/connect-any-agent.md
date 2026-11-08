# Connect any agent

_Nederlands: [connect-any-agent.nl.md](connect-any-agent.nl.md)_

ReversePort works the same for every agent, whoever made it and however large or small the model. Pick the door
that fits your agent; all of them reach the same tools.

| Your agent                                                                                                | Door                            | One command                                                      |
| --------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------- |
| Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, OpenCode and other installed agents               | MCP (stdio), configured for you | `npx -y reverseport@latest setup`                                |
| Any MCP client, configured by hand (Windsurf, Cline, Roo Code, Continue, Zed, Goose, LM Studio, VS Code…) | MCP (stdio)                     | `reverseport connect <client>` prints the exact snippet          |
| Clients that take an MCP URL (n8n, LangChain `MultiServerMCPClient`, Open WebUI via mcpo…)                | MCP over HTTP                   | `reverseport serve` → `http://127.0.0.1:32147/mcp`               |
| OpenAI Chat Completions / Responses, OpenAI-compatible servers (vLLM, Ollama, LM Studio, llama.cpp)       | Function calling                | `GET /api/agent/tools?format=openai-strict` (or `responses`)     |
| Anthropic Messages API                                                                                    | Tool use                        | `GET /api/agent/tools?format=anthropic`                          |
| Gemini API                                                                                                | Function declarations           | `GET /api/agent/tools?format=gemini`                             |
| LangChain/LlamaIndex OpenAPI tools, Semantic Kernel, CrewAI, AutoGen, n8n HTTP                            | OpenAPI 3.1                     | `GET /api/openapi.json`                                          |
| Agents that can only run commands                                                                         | CLI with JSON                   | `reverseport describe <tool>`, `reverseport <tool> --args '{…}'` |

`reverseport connect` without a client lists them all. Add `--mode local` to point a snippet at your checkout
instead of `npx`. Setup and `connect` both register the server under the name `reverseport`, so doing both never
adds it twice. Earlier releases used `rea`; see the [server name change](getting-started/installation.md#server-name-change). In
Claude Code, use either `setup` or the plugin, not both: the plugin brings its own copy of the server, listed as
`plugin_reverseport_reverseport`, so with both you run two servers.

The Claude Code plugin installed from GitHub has no built deep-analysis engine; it starts with ReversePort's own
tools. Turn on the plugin's **Deep-analysis engine** setting (`/plugin` → reverseport → configure) to have it run
the published engine through `npx` (downloaded once); `REVERSEPORT_ENGINE_FETCH=npx` does the same. The plugin's
other settings choose the tool list size, the workspace folder and your Ghidra folder, so nobody edits
`settings.json` by hand.

## Function calling over HTTP

```bash
reverseport serve                     # http://127.0.0.1:32147 (REVERSEPORT_PORT to change)
curl -s "http://127.0.0.1:32147/api/agent/tools?format=openai-strict" > tools.json
curl -s -X POST http://127.0.0.1:32147/api/agent/call \
  -H 'content-type: application/json' \
  -d '{"name":"re_scan","arguments":{"path":"/absolute/path/to/game"}}'
```

A complete loop with the OpenAI Python SDK (works the same against Ollama, vLLM or LM Studio by changing
`base_url`):

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

Formats: `mcp`, `openai`, `openai-strict`, `responses`, `anthropic`, `gemini`, `json-schema`. In the strict formats
every argument is required and optional ones accept `null`; `null` means "not given". Every door also accepts
numbers and booleans sent as strings (`"20"`, `"true"`) and objects sent as JSON text. For ReversePort's own tools,
out-of-range numbers are clamped and the result says so under `adjusted`. In `openai-strict` and `responses` the
tools are strict: a free-form object (such as `arguments` in `run_batch`) is sent as a JSON string, which ReversePort
reads back. Only a schema that still cannot be strict (a property with no type at all) goes out with `strict: false`.
Unions keep every option: a field shared by several shapes keeps all its allowed values, and the description says
which fields belong together. Limits a format does not take (`minLength`, `multipleOf`, …) move into the description.
Function descriptions stay within 1024 characters; OpenAPI operation descriptions within 300 (the GPT Actions limit),
cut at a sentence — `/api/openapi.json?descriptions=full` gives the whole text.

The server answers only on localhost. Pages served from localhost may call it from a browser (CORS). Set
`REVERSEPORT_TOKEN` to require `Authorization: Bearer <token>`. To reach it from Docker or through a tunnel (hosted
agents such as GPT Actions need a public HTTPS URL), set `REVERSEPORT_TOKEN`, `REVERSEPORT_HOST=0.0.0.0` and
`REVERSEPORT_ALLOWED_HOSTS=<host names>`; without a token it refuses to listen beyond this machine.

## MCP versions and long-running calls

The server speaks both MCP eras on the same connection. Clients that open with `initialize` get the classic
session (2025-11-25 and older). Clients on MCP 2026-07-28 send `server/discover` or any request with
`io.modelcontextprotocol/protocolVersion` in `_meta` and are served without a handshake: every result carries
`resultType`, list results carry `ttlMs` and `cacheScope`, and `tools/list` keeps a fixed order so prompt caches
stay warm.

A 2026-07-28 client that declares the `io.modelcontextprotocol/tasks` extension gets long calls as tasks: a
`tools/call` still running after 2.5 seconds returns a task id instead of blocking, and `tasks/get` shows its status
(progress from the engine becomes `statusMessage`) and, at the end, the normal tool result. `tasks/cancel` stops
it. Quick calls answer directly, so nothing gets slower. Task ids last six hours and do not survive a restart of
the server. `REVERSEPORT_TASK_AFTER_MS` changes the 2.5 seconds. Claude Code uses tasks in its CLI from v2.1.304.

`subscriptions/listen` (stdio) delivers `notifications/tools/list_changed` when the engine starts, stops or the
tool profile changes. Over HTTP the endpoint answers with JSON only, so a stream cannot stay open there; call
`tools/list` again instead.

## Fit the tool list to the agent

Every agent can reach every tool. What changes is how much is listed up front:

| Profile              | Lists                                                                                  | Tools                            | For                                                |
| -------------------- | -------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------- |
| `compact`            | 9 ReversePort tools for recon and porting + 6 engine essentials, one-line descriptions | 19 tools (11 without the engine) | small or older models, small context windows       |
| `standard` (default) | all 33 ReversePort tools + 20 core engine tools                                        | 57 tools (35 without the engine) | most agents                                        |
| `full`               | every tool                                                                             | over 200 tools                   | large-context agents whose client allows that many |

The counts include `set_tool_profile` and `run_batch`, and with the engine `engine_tools` and `engine_call`.
`reverseport tools --profile compact` prints the list itself.

Some clients cap the number of tools (Cursor has used about 40, VS Code and OpenAI 128, Windsurf 100). Pick
`compact` for a tight cap. Set the profile with `REVERSEPORT_PROFILE`, or let the agent switch at any time with
`set_tool_profile`. A tool left out of the list still works when called by name; with the engine,
`engine_tools {query}` finds any other engine tool and `engine_call {tool, arguments}` calls it.
`REVERSEPORT_TOOLS=all|port|name,glob*` picks the listed tools exactly.

Over HTTP every MCP session keeps its own profile and its own repeat guard, so one client never changes what another
sees. Requests without a session remember nothing; ask for a profile in the address instead: `/mcp?profile=compact`,
`/api/agent/tools?profile=compact` or `/api/openapi.json?profile=compact`. A session that ended (or never existed)
gets HTTP 404 with JSON-RPC error `-32001`: send `initialize` again.

Strict schema validators (Gemini, OpenAI strict mode, some local-model servers) reject some JSON-Schema features the
deep-analysis engine uses (`$ref`, unions, dependent fields). `REVERSEPORT_SCHEMA=portable` lists every schema in a
form they accept (the `compact` profile always does), and the HTTP formats `openai-strict`, `responses` and `gemini`
always do. The server still validates the full schema.

## Big results do not flood the context

Over MCP and HTTP, a tool result larger than 256 KB is saved whole to `~/.reverseport/tool-output/` (or under
`REVERSEPORT_HOME`). The agent gets a shortened result: the longest lists keep their first items, long text keeps its
first lines, and `outputTruncated` (or a closing line for plain text) says what was shortened and where the full
result is. Over MCP the result also carries a `resource_link` to `reverseport://tool-output/<file>`, so clients
without file access read the complete result with `resources/read`. Saved results are removed after 7 days.
`REVERSEPORT_MAX_OUTPUT_BYTES` sets another limit (at least 4096 bytes), or `off`. The CLI always prints the full
result.

Most results stay far below that limit: `re_scan`, `re_graph` and `re_symbols` return short lists by default, with
counts (`orphanCount`, `cycleCount`, `functionCount`…) for what was left out, and `limit`/`match` for more.

## Several steps in one call

`run_batch` runs up to 20 tool calls in order and answers once. `select` keeps only the fields an agent needs from
each result, which saves context and round trips:

```json
{
  "calls": [
    {
      "tool": "re_scan",
      "arguments": { "path": "/games/demo" },
      "select": ["primary.id", "entryPoints[*].file"]
    },
    {
      "tool": "re_graph",
      "arguments": { "path": "/games/demo" },
      "select": ["cycles", "portOrder"]
    },
    {
      "tool": "port_map",
      "arguments": { "from": "godot", "to": "unity" },
      "select": ["conventions", "hint"]
    }
  ]
}
```

It stops at the first error and says which call to fix and where to resume; `continueOnError: true` runs the rest.
A `select` path that finds nothing is listed under `unresolved` for that step, with the reason and the path that works
(`"primry.id"` → `"primary.id"`, `"entryPoints.file"` → `"entryPoints[*].file"`).
Engine tools work too. In strict function-calling formats, `arguments` is a JSON object written as a string.

## Errors look the same everywhere

Successful workflow results include a `next` field wherever there is an obvious next step (graphs, truncated
results and every porting step), with the exact call the agent can make next.

Tool calls on every door return the same error object, so an agent can act on it without guessing:

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

ReversePort's codes are UPPERCASE (`NOT_FOUND`, `INVALID_ARGUMENT`, `ENGINE_STOPPED`…); the deep-analysis engine's
are lowercase (`provider_unavailable`, `resource_constraint`…). Both use the same categories and carry `retryable`
and `remediation`. An unknown tool name is a tool result with `UNKNOWN_TOOL` and the closest name. On the CLI, usage
errors exit with 2 and other failures with 1; the error is JSON on stderr (at an interactive terminal the
`reverseport` command prints plain text instead). Over HTTP the status follows the code: 400 for input, 404 for an
unknown tool, 503 when the engine or a public source is unavailable, 500 for unexpected failures.

When the exact same call fails twice in one session (three times for errors marked `retryable`), the error comes back
with `repeated` and `retryable: false` and says plainly not to send it unchanged again: change the input, use another
tool, or tell the user what is blocking. A success of that same call clears it; other calls in between do not.

The engine states are distinct, so the next step is always right: `ENGINE_UNAVAILABLE` (not built — install it),
`ENGINE_OFF` (turned off — unset `REVERSEPORT_ENGINE`), `ENGINE_STOPPED` (crashed — call again once; it restarts),
`ENGINE_RESTART_LIMIT` (kept crashing — tell the user).

## Tell us what got in the way

Agents can leave a note with `share_feedback` at any time: what helped, what was confusing or slow, what would
help next time. Notes stay on the user's computer (`reverseport feedback` shows them) until the user shares them.
They shape the next release.
