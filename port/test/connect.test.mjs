import test from 'node:test';
import assert from 'node:assert/strict';
import { connect, CLIENTS } from '../src/connect.mjs';

// One server name everywhere: every MCP snippet registers "reverseport", the name `reverseport setup` and the plugin use.
const EXPECTED = {
  'claude-code': /^claude mcp add reverseport -- /m,
  'claude-desktop': s => JSON.parse(s).mcpServers.reverseport,
  cursor: s => JSON.parse(s).mcpServers.reverseport,
  windsurf: s => JSON.parse(s).mcpServers.reverseport,
  cline: s => JSON.parse(s).mcpServers.reverseport,
  'roo-code': s => JSON.parse(s).mcpServers.reverseport,
  vscode: s => JSON.parse(s).servers.reverseport,
  codex: /^\[mcp_servers\.reverseport\]$/m,
  'gemini-cli': s => JSON.parse(s).mcpServers.reverseport,
  opencode: s => JSON.parse(s).mcp.reverseport,
  zed: s => JSON.parse(s).context_servers.reverseport,
  continue: /^ {2}- name: reverseport$/m,
  goose: /^extensions:\n {2}reverseport:\n {4}type: stdio\n {4}name: reverseport$/m,
  'lm-studio': s => JSON.parse(s).mcpServers.reverseport,
};

for (const mode of ['npx', 'local']) {
  test(`connect (${mode}): every MCP client snippet registers the server as "reverseport", never "rea"`, () => {
    for (const client of Object.keys(CLIENTS)) {
      const { snippet, serverName } = connect({ client, mode });
      const check = EXPECTED[client];
      if (check instanceof RegExp) assert.match(snippet, check, client);
      else if (check) assert.ok(check(snippet), `${client}: no "reverseport" key`);
      // No snippet may still use rea as a server name (as a key, a TOML table, a YAML name or `claude mcp add rea`).
      assert.doesNotMatch(snippet, /["']?\brea\b["']?\s*:|mcp_servers\.rea\b|name:\s*rea\b|mcp add rea\b/, client);
      assert.match(serverName, /^reverseport\b/, client);
      assert.match(serverName, /"rea"/, `${client}: the note on older "rea" registrations`);
    }
    assert.deepEqual(Object.keys(EXPECTED).filter(k => !CLIENTS[k]), [], 'every expected client still exists');
  });
}

test('connect: npx stays the portable default and the note describes both registration forms', () => {
  const { snippet, launch, version } = connect({ client: 'cursor' });
  const entry = JSON.parse(snippet).mcpServers.reverseport;
  const args = process.platform === 'win32' ? entry.args.slice(2) : entry.args;
  assert.equal(process.platform === 'win32' ? entry.args[1] : entry.command, 'npx');
  assert.deepEqual([args[0], args[2]], ['-y', 'mcp']);
  assert.match(args[1], /^reverseport@\d+\.\d+\.\d+/);
  assert.match(version, /pinned on purpose/);
  for (const text of [launch, connect().launch]) {
    assert.match(text, /portable default and a current registration/);
    assert.match(text, /reverseport setup/);
    assert.match(text, /absolute Node\.js runtime and entry script/);
    assert.match(text, /reverseport doctor` accepts both forms/);
  }
  assert.equal(connect({ client: 'cursor', mode: 'local' }).launch, undefined);
});
