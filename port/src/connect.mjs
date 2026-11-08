// `reverseport connect [client]`: the exact snippet to connect ReversePort to any agent, with no setup wizard and no
// dependencies. MCP clients get their own config format; everything else gets HTTP, OpenAPI or function definitions.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RPError } from './util.mjs';
import { closest } from './agent.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERSION = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
/** Hand-written registrations name an exact version, so an agent never runs a release nobody chose. */
const PACKAGE = `reverseport@${VERSION}`;

/** One description of both registration forms, matching what `setup` writes and `doctor` accepts. */
export const LAUNCH_NOTE = 'npx is the portable default and a current registration. `reverseport setup` instead registers the absolute Node.js runtime and entry script of the installation that runs it, which starts faster and offline; `reverseport doctor` accepts both forms and only flags an npx version older than the CLI.';

function launch(mode) {
  // On Windows, clients cannot start the npx .cmd shim directly; cmd /c does it.
  if (mode === 'npx') return process.platform === 'win32' ? { command: 'cmd', args: ['/c', 'npx', '-y', PACKAGE, 'mcp'] } : { command: 'npx', args: ['-y', PACKAGE, 'mcp'] };
  return { command: 'node', args: [path.join(REPO, 'bin', 'reverseport.mjs'), 'mcp'] };
}

const json = v => JSON.stringify(v, null, 2);

export const CLIENTS = {
  'claude-code': { file: 'shell', snippet: l => `claude mcp add reverseport -- ${l.command} ${l.args.join(' ')}\n# or instead (not both), the plugin with skills and the porting agent:\n/plugin marketplace add laaielichter/reverseport\n/plugin install reverseport@reverseport` },
  'claude-desktop': { file: 'claude_desktop_config.json', snippet: l => json({ mcpServers: { reverseport: l } }) },
  cursor: { file: '~/.cursor/mcp.json', snippet: l => json({ mcpServers: { reverseport: l } }) },
  windsurf: { file: '~/.codeium/windsurf/mcp_config.json', snippet: l => json({ mcpServers: { reverseport: l } }) },
  cline: { file: 'cline_mcp_settings.json', snippet: l => json({ mcpServers: { reverseport: { ...l, disabled: false } } }) },
  'roo-code': { file: 'mcp_settings.json', snippet: l => json({ mcpServers: { reverseport: l } }) },
  vscode: { file: '.vscode/mcp.json (GitHub Copilot agent mode)', snippet: l => json({ servers: { reverseport: { type: 'stdio', ...l } } }) },
  codex: { file: '~/.codex/config.toml', snippet: l => `[mcp_servers.reverseport]\ncommand = ${JSON.stringify(l.command)}\nargs = ${JSON.stringify(l.args)}\nstartup_timeout_sec = 60\ntool_timeout_sec = 600` },
  'gemini-cli': { file: '~/.gemini/settings.json', snippet: l => json({ mcpServers: { reverseport: { ...l, env: { REVERSEPORT_SCHEMA: 'portable' }, timeout: 600000 } } }) },
  opencode: { file: 'opencode.json', snippet: l => json({ mcp: { reverseport: { type: 'local', command: [l.command, ...l.args], enabled: true } } }) },
  zed: { file: 'Zed settings.json', snippet: l => json({ context_servers: { reverseport: { source: 'custom', command: l.command, args: l.args } } }) },
  continue: { file: '.continue/mcpServers/reverseport.yaml', snippet: l => `name: ReversePort\nversion: 1.0.0\nschema: v1\nmcpServers:\n  - name: reverseport\n    command: ${l.command}\n    args:\n${l.args.map(a => `      - ${JSON.stringify(a)}`).join('\n')}` },
  goose: { file: '~/.config/goose/config.yaml', snippet: l => `extensions:\n  reverseport:\n    type: stdio\n    name: reverseport\n    cmd: ${l.command}\n    args: ${JSON.stringify(l.args)}\n    enabled: true\n    timeout: 600` },
  'lm-studio': { file: 'LM Studio mcp.json', snippet: l => json({ mcpServers: { reverseport: l } }) },
  'mcp-http': { file: 'any client that takes an MCP URL (n8n, LangChain MultiServerMCPClient, Vercel AI SDK, Open WebUI via mcpo…)', snippet: () => 'reverseport serve\n# then connect to: http://127.0.0.1:32147/mcp   (set REVERSEPORT_TOKEN to require a bearer token)' },
  openai: { file: 'OpenAI Chat Completions / Responses, and OpenAI-compatible servers (vLLM, Ollama, LM Studio, llama.cpp)', snippet: () => 'reverseport serve\ncurl -s "http://127.0.0.1:32147/api/agent/tools?format=openai-strict"   # tools=…   (format=responses for the Responses API)\n# run a call: POST http://127.0.0.1:32147/api/agent/call {"name": "...", "arguments": {...}}' },
  anthropic: { file: 'Anthropic Messages API tool use', snippet: () => 'reverseport serve\ncurl -s "http://127.0.0.1:32147/api/agent/tools?format=anthropic"   # tools=…\n# run a call: POST http://127.0.0.1:32147/api/agent/call {"name": "...", "arguments": {...}}' },
  gemini: { file: 'Gemini API function calling', snippet: () => 'reverseport serve\ncurl -s "http://127.0.0.1:32147/api/agent/tools?format=gemini"   # tools=…\n# run a call: POST http://127.0.0.1:32147/api/agent/call {"name": "...", "arguments": {...}}' },
  openapi: { file: 'LangChain/LlamaIndex OpenAPI tools, Semantic Kernel, CrewAI, AutoGen, n8n HTTP; GPT Actions via a tunnel', snippet: () => 'reverseport serve\n# OpenAPI 3.1: http://127.0.0.1:32147/api/openapi.json   (each tool is POST /api/agent/tools/<name>)\n# GPT Actions and other hosted agents need a public HTTPS URL: set REVERSEPORT_TOKEN, REVERSEPORT_HOST=0.0.0.0 and\n# REVERSEPORT_ALLOWED_HOSTS=<tunnel host>, then expose the port with a tunnel of your choice.' },
  shell: { file: 'agents that can only run commands', snippet: () => 'reverseport help                      # what exists\nreverseport describe re_scan          # one tool\'s schema\nreverseport scan ./Game --compact     # JSON on stdout, errors as JSON on stderr\nreverseport re_scan --args \'{"path":"./Game"}\'\necho \'{"path":"./Game"}\' | reverseport re_scan --request -' },
};

export function connect({ client, mode } = {}) {
  const how = mode === 'npx' || mode === 'local' ? mode : 'npx';
  const l = launch(how);
  if (!client) {
    return {
      clients: Object.fromEntries(Object.entries(CLIENTS).map(([k, v]) => [k, v.file])),
      easiest: 'npx -y reverseport@latest setup   (finds and configures installed agents for you)',
      next: 'reverseport connect <client>   (add --mode local to point at this copy instead of npx)',
      launch: LAUNCH_NOTE,
    };
  }
  const key = String(client).toLowerCase().replace(/_/g, '-');
  const c = CLIENTS[key];
  if (!c) {
    const near = closest(key, Object.keys(CLIENTS), 3);
    throw new RPError('INVALID_ARGUMENT', `Unknown client "${client}".${near ? ` Did you mean "${near}"?` : ''} Clients: ${Object.keys(CLIENTS).join(', ')}.`);
  }
  return { client: key, where: c.file, snippet: c.snippet(how === 'local' ? launch('local') : l), serverName: 'reverseport — the name both `reverseport setup` and the Claude plugin use, so a snippet and setup write the same entry instead of a second one (in Claude Code pick the plugin or a registration, not both). Older setups registered it as "rea": rerunning `reverseport setup` moves that entry to "reverseport"; for a client setup does not edit, remove the old "rea" entry by hand.', ...(how === 'npx' ? { version: `${PACKAGE} — pinned on purpose; after an update run \`reverseport connect ${key}\` again for the new number`, launch: LAUNCH_NOTE } : {}), tools: 'ReversePort lists its own tools plus the engine core; REVERSEPORT_TOOLS=all lists every engine tool, REVERSEPORT_TOOLS=port only ReversePort\'s.' };
}
