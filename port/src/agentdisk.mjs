// Optional link to agentdisk (github.com/laaielichter/agentdisk): the disk report for coding agents, with a cleanup
// you can undo. ReversePort never needs it. When it is there, `port doctor` says how much of the workspace would
// really come back (hardlinks counted once) and points at agentdisk's own plan → quarantine → purge route, which only
// a person can apply. ReversePort never asks agentdisk to move or delete anything.
//
// Found through AGENTDISK_BIN, else `agentdisk` on PATH. REVERSEPORT_AGENTDISK=off turns the link off.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const TIMEOUT_MS = 30000;
const OFF = 'Turned off with REVERSEPORT_AGENTDISK=off.';
const MISSING = 'agentdisk is not installed (optional). It reports what agents and tools left on disk and cleans up with undo: https://github.com/laaielichter/agentdisk';

function locate(env = process.env) {
  if (/^(off|0|false|no)$/i.test(env.REVERSEPORT_AGENTDISK ?? '')) return { off: true };
  const bin = env.AGENTDISK_BIN?.trim();
  if (bin) return existsSync(bin) ? { command: /\.m?js$/i.test(bin) ? [process.execPath, bin] : [bin] } : { missing: `AGENTDISK_BIN points to ${bin}, which does not exist.` };
  for (const dir of (env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const name of process.platform === 'win32' ? ['agentdisk.exe', 'agentdisk.cmd'] : ['agentdisk']) {
      const full = path.join(dir, name);
      if (existsSync(full)) return { command: [full] };
    }
  }
  return { missing: MISSING };
}

function run(command, args) {
  return new Promise(resolve => {
    execFile(command[0], [...command.slice(1), ...args], { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true, shell: process.platform === 'win32' && /\.cmd$/i.test(command[0]) }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr).trim() });
    });
  });
}

/** Bytes per top-level folder of the workspace, largest first. Never throws. */
export async function workspaceUsage(root) {
  const folders = [];
  let entries = [];
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return { bytes: 0, folders }; }
  const sizeOf = async dir => {
    let total = 0;
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop();
      let list = [];
      try { list = await fs.readdir(d, { withFileTypes: true }); } catch { continue; }
      for (const e of list) {
        const abs = path.join(d, e.name);
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) stack.push(abs);
        else if (e.isFile()) { try { total += (await fs.stat(abs)).size; } catch { /* gone meanwhile */ } }
      }
    }
    return total;
  };
  for (const e of entries) if (e.isDirectory() && !e.isSymbolicLink()) folders.push({ folder: e.name, bytes: await sizeOf(path.join(root, e.name)) });
  folders.sort((a, b) => b.bytes - a.bytes);
  return { bytes: folders.reduce((s, f) => s + f.bytes, 0), folders };
}

/**
 * The workspace's disk use, plus agentdisk's view when it is installed. Never throws: disk advice is a bonus.
 * { bytes, folders, agentdisk: { available, reason? | version, reclaimableBytes, next } }
 */
export async function diskReport(root, { env = process.env } = {}) {
  const usage = await workspaceUsage(root);
  const found = locate(env);
  if (!found.command) return { ...usage, agentdisk: { available: false, reason: found.off ? OFF : found.missing } };
  const [version, size] = await Promise.all([run(found.command, ['--version']), run(found.command, ['size', root, '--json'])]);
  let measured = null;
  try { measured = size.code === 0 ? JSON.parse(size.stdout) : null; } catch { measured = null; }
  return {
    ...usage,
    agentdisk: {
      available: true,
      version: version.stdout.trim().replace(/^agentdisk\s+/, '') || null,
      ...(measured ? { reclaimableBytes: measured.reclaimable_bytes ?? null, onDiskBytes: measured.allocated_bytes ?? null } : { error: size.stderr || 'agentdisk size failed.' }),
      next: 'agentdisk explain <folder> says what a folder is and whether it may go; agentdisk plan makes a cleanup plan (proof cases and port plans are never in it). Only a person applies a plan; items go to quarantine first and can be restored.',
    },
  };
}
