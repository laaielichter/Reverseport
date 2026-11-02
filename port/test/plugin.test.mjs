import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFile(path.join(REPO, f), 'utf8');
const { tools, VERSION } = await import('../src/tools.mjs');
const names = new Set(tools.map(t => t.name));

test('one version everywhere', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(VERSION, pkg.version);
  assert.equal(pkg.name, 'reverseport');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.bin.reverseport, 'bin/reverseport.mjs');
  for (const f of ['bin', 'port/src', 'port/knowledge', 'port/templates', 'port/plugin', 'port/mcp.mjs', 'port/cli.mjs', 'port/server.mjs']) assert.ok(pkg.files.includes(f), `package files: ${f}`);
});

test('Claude Code plugin and marketplace manifests', async () => {
  const m = JSON.parse(await read('.claude-plugin/plugin.json'));
  assert.equal(m.name, 'reverseport');
  assert.equal(m.version, VERSION);
  assert.equal(m.license, 'MIT');
  await fs.access(m.mcpServers.reverseport.args[0].replace('${CLAUDE_PLUGIN_ROOT}', REPO));
  const market = JSON.parse(await read('.claude-plugin/marketplace.json'));
  assert.deepEqual(market.plugins.map(p => [p.name, p.source]), [
    ['reverseport', './'],
    ['stashpad', { source: 'github', repo: 'laaielichter/stashpad' }],
    ['agentdisk', { source: 'github', repo: 'laaielichter/agentdisk' }],
  ]);
  for (const p of market.plugins) assert.ok(p.description?.length >= 40, `${p.name}: description`);
  // Settings the user fills in once, instead of editing settings.json by hand; every one reaches the server.
  for (const [key, option] of Object.entries(m.userConfig)) {
    assert.match(key, /^[a-z_]+$/);
    assert.ok(['string', 'number', 'boolean', 'directory', 'file'].includes(option.type), `${key}: type`);
    assert.ok(option.title && option.description, `${key}: title and description`);
    assert.ok(Object.values(m.mcpServers.reverseport.env).includes(`\${user_config.${key}}`), `${key}: passed to the server`);
  }
});

test('listing metadata: registry limits, tags, and gift details only in the READMEs', async () => {
  // The MCP Registry rejects a whole publish when the description is over 100 characters; catch it before a release.
  const server = JSON.parse(await read('server.json'));
  assert.ok(server.description.length > 0 && server.description.length <= 100, `server.json description is ${server.description.length} characters`);
  const pkg = JSON.parse(await read('package.json'));
  const plugin = JSON.parse(await read('.claude-plugin/plugin.json'));
  for (const [where, list] of [['package.json', pkg.keywords], ['plugin.json', plugin.keywords]]) {
    assert.equal(new Set(list).size, list.length, `${where}: duplicate keywords`);
    for (const k of list) assert.match(k, /^[a-z0-9][a-z0-9-]{0,49}$/, `${where}: keyword ${k}`);
  }
  // Gifts are mentioned in the READMEs only: never in agent-facing files, tool output, skills or the website.
  const address = 'BDRA7dHGBYtPsZPNzVQccDYZ8BqstJGCsWx3kopPSCDK';
  const agentFacing = ['llms.txt', 'llms-install.md', 'AGENTS.md', 'site/index.html', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'server.json', 'CITATION.cff'];
  for (const dir of await fs.readdir(path.join(REPO, 'skills'))) agentFacing.push(`skills/${dir}/SKILL.md`);
  for (const f of agentFacing) {
    const text = await read(f).catch(() => '');
    assert.ok(!text.includes(address) && !/\b(?:donat(?:e|ion)|solana)\b/i.test(text), `${f}: gift details belong in the READMEs only`);
  }
  for (const f of ['README.md', 'docs/README.nl.md']) assert.ok((await read(f)).includes(address), `${f}: support section`);
});

test('Claude plugin directory: no .gitattributes, and the .cmd fixtures keep CRLF without one', async () => {
  // The directory rejects a repository when a .gitattributes rule can make a clone differ from its download.
  await assert.rejects(fs.access(path.join(REPO, '.gitattributes')), '.gitattributes: the Claude plugin directory rejects the repository');
  for (const f of ['tests/fixtures/captureGhidraLaunch.cmd', 'tests/fixtures/pcap/capinfos-stub.cmd', 'tests/fixtures/pcap/tshark-stub.cmd']) {
    const text = await read(f);
    assert.ok(text.includes('\r\n') && !/(?:^|[^\r])\n/.test(text), `${f}: keep CRLF line endings`);
  }
});

test('plugin settings: empty or unsubstituted values are unset; the engine setting fetches the engine', async () => {
  const { applyPluginSettings } = await import('../plugin/mcp-launch.mjs');
  const env = applyPluginSettings({ REVERSEPORT_PLUGIN_ENGINE: 'true', REVERSEPORT_PROFILE: 'compact', REVERSEPORT_HOME: '', GHIDRA_INSTALL_DIR: '${user_config.ghidra_install_dir}' });
  assert.equal(env.REVERSEPORT_ENGINE_FETCH, 'npx');
  assert.equal(env.REVERSEPORT_PROFILE, 'compact');
  assert.equal('REVERSEPORT_HOME' in env, false);
  assert.equal('GHIDRA_INSTALL_DIR' in env, false);
  assert.equal('REVERSEPORT_PLUGIN_ENGINE' in env, false);
  const off = applyPluginSettings({ REVERSEPORT_PLUGIN_ENGINE: 'false' });
  assert.equal(off.REVERSEPORT_ENGINE_FETCH, undefined);
  assert.equal(applyPluginSettings({ REVERSEPORT_PLUGIN_ENGINE: 'true', REVERSEPORT_ENGINE_FETCH: 'off' }).REVERSEPORT_ENGINE_FETCH, 'off', 'an explicit environment choice wins');
});

test('skills and agent: frontmatter, and only real tool names', async () => {
  const docs = ['agents/port-architect.md', 'README.md', 'llms.txt', 'docs/connect-any-agent.md', 'docs/README.nl.md', 'docs/claude-ai-skill/SKILL.md', '.agents/skills/reverse-engineer-anything/references/porting-and-rebuilds.md'];
  for (const dir of await fs.readdir(path.join(REPO, 'skills'))) {
    if (dir === 'reverse-engineer-anything') continue; // generated by the engine build
    const text = await read(`skills/${dir}/SKILL.md`);
    const front = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
    assert.ok(front, `${dir}: frontmatter`);
    assert.match(front, new RegExp(`^name: ${dir}$`, 'm'));
    assert.match(front, /^description: .{80,1024}$/m);
    docs.push(`skills/${dir}/SKILL.md`);
  }
  for (const f of docs) {
    const text = await read(f);
    for (const [t] of text.matchAll(/\b(?:re|port)_[a-z_]+\b/g)) assert.ok(names.has(t), `${f}: unknown tool ${t}`);
    assert.doesNotMatch(text, /node cli\.mjs|cli\.mjs install|install\.ps1/, `${f}: outdated command`);
  }
});

test('front door: help, version, port commands, and a clear message when the engine is not built', () => {
  const env = { ...process.env, REVERSEPORT_HOME: path.join(os.tmpdir(), 'reverseport-front-door-test') };
  const run = (...args) => spawnSync(process.execPath, [path.join(REPO, 'bin', 'reverseport.mjs'), ...args], { env, encoding: 'utf8' });
  const help = run('help').stdout;
  assert.match(help, /reverseport setup/);
  assert.match(help, /Proof \(evidence ledger\)/);
  assert.match(help, /reverseport case init/);
  assert.match(help, /reverseport case evidence/);
  assert.match(help, /reverseport case claim/);
  assert.match(help, /reverseport case check/);
  assert.equal(run('--version').stdout.trim(), VERSION);
  const scan = run('scan', path.join(REPO, 'port', 'test', 'fixtures', 'godot-mini'));
  assert.equal(scan.status, 0, scan.stderr);
  assert.equal(JSON.parse(scan.stdout).primary.id, 'godot');
  const conv = run('port_convert', 'godot', 'unreal', '--position', '[1,2,3]');
  assert.deepEqual(JSON.parse(conv.stdout).position, [-300, 100, 200]);
  assert.match(run('port', 'help').stdout, /Porting/);
  const kase = run('case', 'list', '--compact');
  assert.equal(kase.status, 0, kase.stderr);
  assert.ok(Array.isArray(JSON.parse(kase.stdout).cases), 'reverseport case reaches re_case');
  const built = spawnSync(process.execPath, ['-e', 'process.exit(require("fs").existsSync(process.argv[1]) ? 0 : 1)', path.join(REPO, 'dist', 'cli-runtime', 'cli.js')]).status === 0;
  if (!built) {
    const deep = run('analyze', '/nonexistent');
    assert.equal(deep.status, 1);
    assert.match(deep.stderr, /npm ci && npm run build/);
  }
});
