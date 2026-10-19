# Connect any agent

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
instead of `npx`. Setup and `connect` both register the server under the name `rea`, so doing both never adds it
twice. In Claude Code, use either `setup` or the plugin, not both: the plugin brings its own copy of the server.

The Claude Code plugin installed from GitHub has no built deep-analysis engine; it starts with ReversePort's own
tools. Set `REVERSEPORT_ENGINE_FETCH=npx` to have it run the published engine through `npx` (downloaded once).

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
out-of-range numbers are clamped and the result says so under `adjusted`. In `openai-strict` and `responses`, a tool whose schema has a
free-form object is sent with `strict: false`; the others are strict.

The server answers only on localhost. Pages served from localhost may call it from a browser (CORS). Set
`REVERSEPORT_TOKEN` to require `Authorization: Bearer <token>`. To reach it from Docker or through a tunnel (hosted
agents such as GPT Actions need a public HTTPS URL), set `REVERSEPORT_TOKEN`, `REVERSEPORT_HOST=0.0.0.0` and
`REVERSEPORT_ALLOWED_HOSTS=<host names>`; without a token it refuses to listen beyond this machine.

## Fit the tool list to the agent

Every agent can reach every tool. What changes is how much is listed up front:

| Profile              | Lists                                                                           | About           | For                                                |
| -------------------- | ------------------------------------------------------------------------------- | --------------- | -------------------------------------------------- |
| `compact`            | 8 ReversePort tools + 6 engine essentials, one-line descriptions, short schemas | 17 tools        | small or older models, small context windows       |
| `standard` (default) | ReversePort's 23 tools + about 20 core engine tools                             | 46 tools        | most agents                                        |
| `full`               | every tool                                                                      | about 200 tools | large-context agents whose client allows that many |

Some clients cap the number of tools (Cursor has used about 40, VS Code and OpenAI 128, Windsurf 100). Pick
`compact` for a tight cap. Set the profile with `REVERSEPORT_PROFILE`, or let the agent switch at any time with
`set_tool_profile`. In every profile `engine_tools {query}` finds any other engine tool and
`engine_call {tool, arguments}` calls it. `REVERSEPORT_TOOLS=all|port|name,glob*` picks the listed tools exactly.

Strict schema validators (Gemini, OpenAI strict mode, some local-model servers) reject some JSON-Schema features the
deep-analysis engine uses (`$ref`, unions, dependent fields). `REVERSEPORT_SCHEMA=portable` lists every schema in a
form they accept (the `compact` profile always does), and the HTTP formats `openai-strict`, `responses` and `gemini`
always do. The server still validates the full schema.

## Errors look the same everywhere

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

The engine states are distinct, so the next step is always right: `ENGINE_UNAVAILABLE` (not built — install it),
`ENGINE_OFF` (turned off — unset `REVERSEPORT_ENGINE`), `ENGINE_STOPPED` (crashed — call again once; it restarts),
`ENGINE_RESTART_LIMIT` (kept crashing — tell the user).

## Tell us what got in the way

Agents can leave a note with `share_feedback` at any time: what helped, what was confusing or slow, what would
help next time. Notes stay on the user's computer (`reverseport feedback` shows them) until the user shares them.
They shape the next release.
