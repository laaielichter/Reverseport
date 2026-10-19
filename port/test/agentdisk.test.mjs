// Optional agentdisk link: disk use per workspace folder always; agentdisk's measurement and cleanup route only when it
// is installed; REVERSEPORT_AGENTDISK=off turns it off. ReversePort never asks agentdisk to move or delete anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempDir } from './helpers.mjs';

const { diskReport, workspaceUsage } = await import('../src/agentdisk.mjs');

async function workspace() {
  const root = await tempDir('rp-ws-');
  await fs.mkdir(path.join(root, 'extracted', 'game-1234'), { recursive: true });
  await fs.writeFile(path.join(root, 'extracted', 'game-1234', 'a.bin'), Buffer.alloc(3000));
  await fs.mkdir(path.join(root, 'cases', 'c1'), { recursive: true });
  await fs.writeFile(path.join(root, 'cases', 'c1', 'case.json'), '{}');
  await fs.mkdir(path.join(root, 'ports'));
  return root;
}

test('workspaceUsage: bytes per top-level folder, largest first; a missing workspace is empty', async () => {
  const root = await workspace();
  const u = await workspaceUsage(root);
  assert.equal(u.bytes, 3002);
  assert.deepEqual(u.folders.map(f => f.folder), ['extracted', 'cases', 'ports']);
  assert.deepEqual(await workspaceUsage(path.join(root, 'nope')), { bytes: 0, folders: [] });
});

test('diskReport: missing, turned off, and a stand-in agentdisk that is only asked to measure', async () => {
  const root = await workspace();
  const empty = await tempDir('rp-path-');
  const missing = await diskReport(root, { env: { PATH: empty } });
  assert.equal(missing.agentdisk.available, false);
  assert.match(missing.agentdisk.reason, /not installed \(optional\)/);
  assert.equal(missing.bytes, 3002);

  const dir = await tempDir('rp-agentdisk-');
  const bin = path.join(dir, 'agentdisk.mjs');
  const log = path.join(dir, 'calls.jsonl');
  await fs.writeFile(bin, `import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] === '--version') { process.stdout.write('agentdisk 0.3.0\\n'); process.exit(0); }
if (args[0] === 'size' && args.includes('--json')) { process.stdout.write(JSON.stringify({ path: args[1], allocated_bytes: 8192, reclaimable_bytes: 4096 })); process.exit(0); }
process.exit(2);
`);
  const off = await diskReport(root, { env: { AGENTDISK_BIN: bin, REVERSEPORT_AGENTDISK: 'off' } });
  assert.deepEqual(off.agentdisk, { available: false, reason: 'Turned off with REVERSEPORT_AGENTDISK=off.' });

  const on = await diskReport(root, { env: { AGENTDISK_BIN: bin } });
  assert.equal(on.agentdisk.available, true);
  assert.equal(on.agentdisk.version, '0.3.0');
  assert.equal(on.agentdisk.reclaimableBytes, 4096);
  assert.equal(on.agentdisk.onDiskBytes, 8192);
  assert.match(on.agentdisk.next, /Only a person applies a plan/);
  // Only read-only commands were run
  const calls = (await fs.readFile(log, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(calls.map(c => c[0]).sort(), ['--version', 'size']);
  assert.equal(calls.find(c => c[0] === 'size')[1], root);

  const wrong = await diskReport(root, { env: { AGENTDISK_BIN: path.join(dir, 'nope') } });
  assert.match(wrong.agentdisk.reason, /AGENTDISK_BIN points to/);
});
