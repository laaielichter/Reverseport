#!/usr/bin/env node
// Challenge self-check: what ReversePort's quick look (re_binary, no decompiler) reveals about programs whose answers
// are known exactly. The eight challenge families come from rea-lab (challenges/generate.mjs and oracle.mjs, MIT,
// vendored unchanged); this script builds them for the host with a C compiler, proves the ground truth by running each
// binary with a valid and a wrong input, checks that rea-lab's oracle agrees, and then grades re_binary.
//
// The grade is deliberately narrow and honest: "revealed" means the accepted input appears among the strings
// re_binary returns. Only the plain-compare family should be revealed that way; the others need the deep-analysis
// engine (decompilation) or an agent's reasoning, and this script does not claim to measure either.
//
// --set large builds rea-lab's large set (challenges/large.mjs, MIT, vendored unchanged) instead: eight programs that
// hide the real check among 64 checkers behind a table of function pointers, two of them in C++, some with a decoy
// note that names a wrong code. Like rea-lab, it builds -O2 only, with and without symbols. "decoy" records whether
// that wrong code is among the strings.
//
// Usage: node bench/selfcheck.mjs [--set small|large] [--seed N] [--cc <compiler>] [--cxx <compiler>] [--keep <dir>] [--json]
//   Needs a C compiler (cc, gcc or clang; CC or --cc picks one), and for the large set's C++ programs a C++ compiler
//   (c++, g++ or clang++; CXX or --cxx). Without a compiler it checks generator and oracle only.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generate, PUBLIC_SEED, GENERATOR_VERSION } from './challenges/generate.mjs';
import { generateLarge, LARGE_PUBLIC_SEED, LARGE_GENERATOR_VERSION } from './challenges/large.mjs';
import { accepts } from './challenges/oracle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** One input each challenge accepts: the recorded answer, the checksum example, or the state machine's forward path. */
export function validInput(challenge) {
  const a = challenge.answer;
  if (typeof a.input === 'string') return a.input;
  if (typeof a.example === 'string') return a.example;
  if (a.machine) {
    const byId = new Map(a.machine.states.map(s => [s.id, s]));
    let at = a.machine.start, out = '';
    for (let i = 0; i <= a.machine.states.length && at !== a.machine.accept; i++) { const s = byId.get(at); out += s.forward.character; at = s.forward.next; }
    return at === a.machine.accept ? out : null;
  }
  return null;
}

/** An input the challenge must reject: the valid one with its first character changed. */
export function wrongInput(challenge, valid) {
  for (const c of 'zq9#Ab') { const w = c + valid.slice(1); if (w !== valid && !accepts(challenge, w)) return w; }
  return `${valid}!`;
}

const SETS = {
  small: { generate, seed: PUBLIC_SEED, version: GENERATOR_VERSION, optimizations: ['O0', 'O2'] },
  large: { generate: generateLarge, seed: LARGE_PUBLIC_SEED, version: LARGE_GENERATOR_VERSION, optimizations: ['O2'] },
};
const STD = { c: '-std=c11', cpp: '-std=c++17' };

export function findCompiler(env = process.env, language = 'c') {
  const names = language === 'cpp' ? [env.CXX, 'c++', 'g++', 'clang++'] : [env.CC, 'cc', 'gcc', 'clang'];
  for (const cc of names.filter(Boolean)) {
    if (spawnSync(cc, ['--version'], { encoding: 'utf8' }).status === 0) return cc;
  }
  return null;
}

const run = (bin, input) => spawnSync(bin, [], { input: `${input}\n`, encoding: 'utf8', timeout: 10000 }).stdout.trim();

export async function selfcheck({ set = 'small', seed, cc = findCompiler(), cxx, keep } = {}) {
  const spec = SETS[set];
  if (!spec) throw new Error(`Unknown set ${set}; use small or large.`);
  seed ??= spec.seed;
  const challenges = spec.generate(seed);
  if (cxx === undefined && challenges.some(ch => ch.language === 'cpp')) cxx = findCompiler(process.env, 'cpp');
  const work = keep ? path.resolve(keep) : fs.mkdtempSync(path.join(os.tmpdir(), 'rp-bench-'));
  fs.mkdirSync(work, { recursive: true });
  const { inspectBinary } = await import(pathToFileURL(path.join(ROOT, 'port', 'src', 'binary.mjs')).href);
  const results = [];
  for (const ch of challenges) {
    const valid = validInput(ch);
    const wrong = valid === null ? null : wrongInput(ch, valid);
    const row = { id: ch.id, family: ch.family, oracle: valid !== null && accepts(ch, valid) && !accepts(ch, wrong), variants: [] };
    const language = ch.language ?? 'c';
    const compiler = language === 'cpp' ? cxx : cc;
    if (compiler && valid !== null) {
      const src = path.join(work, `${ch.id}.${language}`);
      fs.writeFileSync(src, ch.source);
      for (const opt of spec.optimizations) for (const strip of [false, true]) {
        const variant = `${opt}-${strip ? 'strip' : 'sym'}`;
        const bin = path.join(work, `${ch.id}-${variant}${process.platform === 'win32' ? '.exe' : ''}`);
        const built = spawnSync(compiler, [STD[language], `-${opt}`, ...(strip ? ['-s'] : []), '-o', bin, src], { encoding: 'utf8' });
        if (built.status !== 0) { row.variants.push({ variant, error: built.stderr.trim().split('\n')[0] }); continue; }
        const truth = run(bin, valid) === 'ACCESS GRANTED' && run(bin, wrong) === 'ACCESS DENIED';
        const info = await inspectBinary({ file: bin, strings: { limit: 5000, min: 4 } });
        const strings = (info.strings?.items ?? info.strings ?? []).map(s => (typeof s === 'string' ? s : s.value ?? s.text ?? '')).filter(Boolean);
        const decoy = ch.answer.decoy?.input;
        row.variants.push({ variant, truth, format: info.format ?? info.kind ?? null, revealed: strings.some(s => s.includes(valid)), ...(decoy ? { decoy: strings.some(s => s.includes(decoy)) } : {}) });
      }
    }
    results.push(row);
  }
  if (!keep) fs.rmSync(work, { recursive: true, force: true });
  const built = results.flatMap(r => r.variants).filter(v => !v.error);
  return {
    set, generatorVersion: spec.version, seed, compiler: cc ?? null, ...(cxx !== undefined ? { cxxCompiler: cxx ?? null } : {}), platform: `${os.platform()} ${os.arch()}`,
    summary: {
      challenges: results.length, oracleAgrees: results.filter(r => r.oracle).length,
      binaries: built.length, groundTruthHolds: built.filter(v => v.truth).length,
      revealedByStrings: built.filter(v => v.revealed).length,
      revealedFamilies: [...new Set(results.filter(r => r.variants.some(v => v.revealed)).map(r => r.family))],
      ...(built.some(v => 'decoy' in v) ? { decoyInStrings: built.filter(v => v.decoy).length, withDecoy: built.filter(v => 'decoy' in v).length } : {}),
    },
    results,
    note: cc || cxx ? '"revealed" = the accepted input is among re_binary strings. Families not revealed need decompilation or reasoning; this check does not measure those.' : 'No C compiler found: only the generator and oracle were checked.',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const report = await selfcheck({ set: opt('--set') ?? 'small', seed: opt('--seed') ? Number(opt('--seed')) : undefined, cc: opt('--cc') ?? findCompiler(), cxx: opt('--cxx'), keep: opt('--keep') });
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    const s = report.summary;
    console.log(`Set ${report.set}, seed ${report.seed}, compiler ${report.compiler ?? 'none'}${'cxxCompiler' in report ? `, C++ ${report.cxxCompiler ?? 'none'}` : ''} (${report.platform})`);
    console.log(`Oracle agrees on ${s.oracleAgrees}/${s.challenges}; ground truth holds on ${s.groundTruthHolds}/${s.binaries} binaries.`);
    console.log(`re_binary strings reveal the answer in ${s.revealedByStrings}/${s.binaries} binaries (families: ${s.revealedFamilies.join(', ') || 'none'}).`);
    if (s.withDecoy) console.log(`A decoy note with a wrong code is among the strings in ${s.decoyInStrings}/${s.withDecoy} binaries that have one.`);
    for (const r of report.results) console.log(`  ${r.id.padEnd(14)} ${r.variants.map(v => v.error ? `${v.variant}:build-failed` : `${v.variant}:${v.truth ? 'ok' : 'WRONG'}${v.revealed ? '+revealed' : ''}${v.decoy ? '+decoy' : ''}`).join('  ')}`);
    console.log(report.note);
  }
  const s = report.summary;
  process.exitCode = s.oracleAgrees === s.challenges && s.groundTruthHolds === s.binaries ? 0 : 1;
}
