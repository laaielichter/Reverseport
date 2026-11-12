# Installing ReversePort (for agents)

ReversePort is an MCP server on stdio. It needs Node.js 22.23.4+, 24.22.1+ or 26.12.1+ (`node --version`) and
nothing else: no account and no API key.

## Cline

Add this to `cline_mcp_settings.json` (Cline → MCP Servers → Configure):

<!-- x-release-please-start-version -->

```json
{
  "mcpServers": {
    "reverseport": {
      "command": "npx",
      "args": ["-y", "reverseport@1.24.0", "mcp"],
      "disabled": false,
      "timeout": 600
    }
  }
}
```

On Windows use `"command": "cmd"` and `"args": ["/c", "npx", "-y", "reverseport@1.24.0", "mcp"]`.

<!-- x-release-please-end -->

The version is pinned on purpose; `npx -y reverseport@latest connect cline` prints the same block for the newest
release. This npx form is the portable default and a current registration. `npx -y reverseport@latest setup`
configures supported agents for you and instead pins the absolute Node.js runtime and entry script, which starts
faster; `reverseport doctor` accepts both forms.

## Check that it works

Ask for `re_scan` on any project folder, for example `{"path": "/absolute/path/to/a/game"}`. The answer names the
engine and version and lists the entry points. Decompiling native code also needs Ghidra, IDA or Hopper on the
machine; ReversePort finds them but never installs them. `npx -y reverseport@latest doctor` shows what is missing.

## Good to know

- It reads targets and never changes them; output goes to new folders. Workspace: `~/.reverseport`
  (`REVERSEPORT_HOME` moves it).
- Only analyse or port what the user owns or may legally use. ReversePort does not crack or bypass DRM,
  anti-cheat or licensing.
- Other agents: `npx -y reverseport@latest connect` lists the configuration for each one.
