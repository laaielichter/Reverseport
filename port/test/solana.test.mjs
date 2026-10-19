// re_solana against hand-built transactions, accounts and program bytes, and a stand-in RPC (globalThis.fetch is
// replaced): no real requests are made. Known-answer vectors come from the Solana and Anchor documentation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { tempDir } from './helpers.mjs';

const dir = await tempDir();
process.env.REVERSEPORT_HOME = path.join(dir, 'home');
delete process.env.REVERSEPORT_SOLANA_RPC;
const sol = await import('../src/solana.mjs');
const { callTool } = await import('../src/tools.mjs');
const { b58encode, b58decode, findProgramAddress, anchorDiscriminator, isOnCurve, anchorIdlAddress, associatedTokenAddress } = sol;

// ------------------------------------------------------------------ fixtures
const fake = label => b58encode(crypto.createHash('sha256').update(label).digest());
const wallet = () => { const { publicKey } = crypto.generateKeyPairSync('ed25519'); return b58encode(publicKey.export({ format: 'der', type: 'spki' }).subarray(12)); };
const SYSTEM = '11111111111111111111111111111111', TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', T22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const shortvec = n => { const out = []; do { let b = n & 0x7f; n >>= 7; if (n) b |= 0x80; out.push(b); } while (n); return Buffer.from(out); };
const u8 = n => Buffer.from([n]);
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const key = a => b58decode(a);

/** Serialize a message (legacy or v0) and, unless bare, prefix empty signature slots. */
function buildTx({ header, keys, ixs, lookups = null, bare = false, sign = false }) {
  const parts = [];
  if (lookups) parts.push(u8(0x80));
  parts.push(Buffer.from(header), shortvec(keys.length), ...keys.map(key), crypto.randomBytes(32), shortvec(ixs.length));
  for (const ix of ixs) parts.push(u8(ix.p), shortvec(ix.a.length), Buffer.from(ix.a), shortvec(ix.d.length), ix.d);
  if (lookups) { parts.push(shortvec(lookups.length)); for (const l of lookups) parts.push(key(l.table), shortvec(l.w.length), Buffer.from(l.w), shortvec(l.r.length), Buffer.from(l.r)); }
  const msg = Buffer.concat(parts);
  if (bare) return msg;
  const sigs = Array.from({ length: header[0] }, () => (sign ? crypto.randomBytes(64) : Buffer.alloc(64)));
  return Buffer.concat([shortvec(header[0]), ...sigs, msg]);
}

/** Minimal sBPF ELF64 header followed by the given payload bytes (no sections). */
function buildSbf(payload) {
  const h = Buffer.alloc(64);
  h.writeUInt32BE(0x7f454c46, 0); h[4] = 2; h[5] = 1; h[6] = 1;
  h.writeUInt16LE(3, 16); h.writeUInt16LE(247, 18); h.writeUInt32LE(1, 20); h.writeUInt16LE(64, 52); h.writeUInt16LE(56, 54); h.writeUInt16LE(64, 58);
  return Buffer.concat([h, payload, Buffer.alloc(256)]);
}

// ------------------------------------------------------------------ stand-in RPC
const chain = new Map(); // address -> { owner, lamports, data: Buffer, executable }
const calls = [];
let simulateResult = null, txResult = null;
const account = a => { const v = chain.get(a); return v ? { lamports: Number(v.lamports ?? 1_000_000), owner: v.owner, executable: !!v.executable, rentEpoch: 0, data: [Buffer.from(v.data ?? []).toString('base64'), 'base64'] } : null; };
globalThis.fetch = async (url, init = {}) => {
  const { method, params } = JSON.parse(init.body);
  calls.push({ url: String(url), method, params });
  const reply = result => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200, headers: { 'content-type': 'application/json' } });
  switch (method) {
    case 'getAccountInfo': return reply({ context: { slot: 1 }, value: account(params[0]) });
    case 'getMultipleAccounts': return reply({ context: { slot: 1 }, value: params[0].map(account) });
    case 'getSlot': return reply(400_000_000);
    case 'simulateTransaction': return reply({ context: { slot: 1 }, value: simulateResult(params) });
    case 'getTransaction': return reply(txResult);
    default: return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } }), { status: 200 });
  }
};

// ------------------------------------------------------------------ primitives
test('base58, PDAs and Anchor discriminators match the documented values', () => {
  for (const a of [SYSTEM, TOKEN, USDC, LOADER]) { assert.equal(b58decode(a).length, 32); assert.equal(b58encode(b58decode(a)), a); }
  assert.deepEqual(b58decode('11'), Buffer.alloc(2));
  // Solana docs: PDA of seed "helloWorld" under the System Program.
  const pda = findProgramAddress([Buffer.from('helloWorld')], key(SYSTEM));
  assert.equal(b58encode(pda.address), '46GZzzetjCURsdFPb7rcnspbEMnCBXe9kpjrsZAkKb6X');
  assert.equal(pda.bump, 254);
  // Anchor: sha256("global:initialize")[0..8].
  assert.deepEqual([...anchorDiscriminator('global', 'initialize')], [175, 175, 109, 31, 13, 152, 155, 237]);
  for (let i = 0; i < 25; i++) assert.equal(isOnCurve(key(wallet())), true, 'real ed25519 keys are on the curve');
  assert.equal(isOnCurve(pda.address), false, 'PDAs are off the curve');
  assert.throws(() => b58decode('0OIl'), /not base58/);
});

test('address: keypair vs PDA, and PDA derivation from seeds', async () => {
  const w = wallet();
  const r = await callTool('re_solana', { action: 'address', address: w });
  assert.equal(r.onCurve, true);
  assert.match(r.kind, /keypair/);
  const d = await callTool('re_solana', { action: 'address', seeds: ['helloWorld'], programId: SYSTEM });
  assert.equal(d.derived, '46GZzzetjCURsdFPb7rcnspbEMnCBXe9kpjrsZAkKb6X');
  assert.equal((await callTool('re_solana', { action: 'address', address: TOKEN })).knownAs, 'SPL Token');
});

// ------------------------------------------------------------------ transactions (offline)
test('tx: flags an unlimited approval and an owner change, and totals what leaves the wallet', async () => {
  const me = wallet(), attacker = wallet(), myUsdc = fake('my-usdc'), dest = wallet();
  const tx = buildTx({
    header: [1, 0, 2], keys: [me, myUsdc, dest, attacker, SYSTEM, TOKEN],
    ixs: [
      { p: 4, a: [0, 2], d: Buffer.concat([u32(2), u64(1_500_000_000n)]) },
      { p: 5, a: [1, 3, 0], d: Buffer.concat([u8(4), u64(2n ** 64n - 1n)]) },
      { p: 5, a: [1, 0], d: Buffer.concat([u8(6), u8(2), u8(1), key(attacker)]) },
    ],
  });
  const r = await callTool('re_solana', { action: 'tx', transaction: tx.toString('base64'), offline: true });
  assert.equal(r.verdict, 'danger');
  assert.equal(r.instructions[0].name, 'Transfer');
  assert.match(r.instructions[0].effects[0].text, /1\.5 SOL/);
  assert.equal(r.instructions[1].name, 'Approve');
  assert.match(r.instructions[1].effects[0].text, /unlimited/);
  assert.equal(r.instructions[2].args.authorityType, 'AccountOwner');
  assert.equal(r.instructions[2].effects[0].severity, 'danger');
  assert.deepEqual(r.intendedChanges, [{ asset: 'SOL', change: '-1.5', raw: '-1500000000' }]);
  assert.match(r.summary, /^DANGER/);
  assert.equal(r.fee.baseLamports, '5000');
  // Same transaction as base58, as a bare message, and through the CLI positional form.
  const r58 = await callTool('re_solana', { action: 'tx', transaction: b58encode(tx), offline: true });
  assert.equal(r58.instructions.length, 3);
  const bare = buildTx({ header: [1, 0, 1], keys: [me, dest, SYSTEM], ixs: [{ p: 2, a: [0, 1], d: Buffer.concat([u32(2), u64(5)]) }], bare: true });
  const rb = await sol.solanaTool({ action: 'tx', address: bare.toString('base64'), offline: true });
  assert.equal(rb.signed, 'message only (no signatures)');
  assert.equal(rb.verdict, 'ok');
});

test('tx: durable nonce, Assign of the wallet, USDC into the wallet\'s own account, compute budget fee', async () => {
  const me = wallet(), sender = wallet(), evil = fake('evil-program'), nonce = fake('nonce');
  const myAta = b58encode(associatedTokenAddress(key(me), key(USDC), key(TOKEN)));
  const tx = buildTx({
    header: [2, 0, 6], keys: [me, sender, nonce, myAta, fake('sender-usdc'), SYSTEM, TOKEN, USDC, 'SysvarRecentB1ockHashes11111111111111111111', 'ComputeBudget111111111111111111111111111111'],
    ixs: [
      { p: 5, a: [2, 8, 0], d: u32(4) },
      { p: 9, a: [], d: Buffer.concat([u8(2), u32(100_000)]) },
      { p: 9, a: [], d: Buffer.concat([u8(3), u64(1_000_000)]) },
      { p: 6, a: [4, 7, 3, 1], d: Buffer.concat([u8(12), u64(25_000_000), u8(6)]) },
      { p: 5, a: [0], d: Buffer.concat([u32(1), key(evil)]) },
    ],
  });
  const r = await callTool('re_solana', { action: 'tx', transaction: tx.toString('base64'), offline: true });
  assert.ok(r.findings.some(f => /never expires/.test(f.text)));
  assert.equal(r.instructions[3].name, 'TransferChecked');
  assert.match(r.instructions[3].effects[0].text, /25 USDC/);
  assert.deepEqual(r.intendedChanges.find(c => c.asset === 'USDC'), { asset: 'USDC', change: '25', raw: '25000000' });
  assert.equal(r.instructions[4].name, 'Assign');
  assert.equal(r.instructions[4].effects[0].severity, 'danger');
  assert.equal(r.fee.priorityLamports, '100000');
  assert.equal(r.verdict, 'danger');
});

test('tx: v0 lookup tables resolve through the RPC; unknown programs are named, not guessed', async () => {
  const me = wallet(), table = fake('table'), program = fake('mystery-program'), a = fake('lut-a'), b = fake('lut-b');
  chain.set(table, { owner: 'AddressLookupTab1e1111111111111111111111111', data: Buffer.concat([Buffer.alloc(56), key(a), key(b)]) });
  const tx = buildTx({ header: [1, 0, 1], keys: [me, program], ixs: [{ p: 1, a: [0, 2, 3], d: Buffer.from([9, 9, 9]) }], lookups: [{ table, w: [1], r: [0] }] });
  const r = await callTool('re_solana', { action: 'tx', transaction: tx.toString('base64'), rpc: 'https://rpc.example/key-in-path' });
  assert.equal(r.version, 0);
  assert.equal(r.network, 'https://rpc.example/…', 'RPC paths (often API keys) are not echoed');
  const ix = r.instructions[0];
  assert.equal(ix.name, 'unknown');
  assert.deepEqual(ix.accounts.map(x => x.address), [me, b, a]);
  assert.deepEqual(r.unknownPrograms, [program]);
  assert.equal(ix.effects[0].severity, 'caution', 'it can change the wallet');
  const off = await callTool('re_solana', { action: 'tx', transaction: tx.toString('base64'), offline: true });
  assert.equal(off.instructions[0].accounts[1].address, null);
  assert.ok(off.warnings.some(w => /lookup tables/.test(w)));
});

// ------------------------------------------------------------------ Anchor IDLs
test('tx: decodes an Anchor program with a 0.30 IDL file and a legacy IDL, including nested args', async () => {
  const me = wallet(), program = fake('vault-program'), vault = fake('vault');
  const idlNew = {
    address: program, metadata: { name: 'vault', version: '0.1.0', spec: '0.1.0' },
    instructions: [{ name: 'deposit', discriminator: [...anchorDiscriminator('global', 'deposit')], accounts: [{ name: 'user', writable: true, signer: true }, { name: 'vault', writable: true }], args: [{ name: 'amount', type: 'u64' }, { name: 'memo', type: { option: 'string' } }, { name: 'route', type: { defined: { name: 'Route' } } }] }],
    types: [{ name: 'Route', type: { kind: 'struct', fields: [{ name: 'hops', type: { vec: 'pubkey' } }, { name: 'side', type: { defined: { name: 'Side' } } }] } }, { name: 'Side', type: { kind: 'enum', variants: [{ name: 'Buy' }, { name: 'Sell' }] } }],
  };
  const idlFile = path.join(dir, 'vault.json');
  await fs.writeFile(idlFile, JSON.stringify(idlNew));
  const data = Buffer.concat([anchorDiscriminator('global', 'deposit'), u64(42), u8(1), u32(2), Buffer.from('hi'), u32(1), key(me), u8(1)]);
  const tx = buildTx({ header: [1, 0, 1], keys: [me, vault, program], ixs: [{ p: 2, a: [0, 1], d: data }] });
  const r = await callTool('re_solana', { action: 'tx', transaction: tx.toString('base64'), idl: idlFile, offline: true });
  const ix = r.instructions[0];
  assert.equal(ix.name, 'deposit');
  assert.equal(ix.decodedWith, 'Anchor IDL (file)');
  assert.deepEqual(ix.args, { amount: '42', memo: 'hi', route: { hops: [me], side: 'Sell' } });
  assert.deepEqual(ix.accounts, { user: me, vault });
  assert.equal(r.programName ?? ix.programName, 'vault');
  // Legacy IDL: camelCase name, no discriminator, isMut/isSigner.
  const legacy = { name: 'old', version: '0.0.1', instructions: [{ name: 'closeVault', accounts: [{ name: 'owner', isMut: true, isSigner: true }], args: [] }] };
  const legacyFile = path.join(dir, 'legacy.json');
  await fs.writeFile(legacyFile, JSON.stringify(legacy));
  const tx2 = buildTx({ header: [1, 0, 1], keys: [me, fake('old-program')], ixs: [{ p: 1, a: [0], d: anchorDiscriminator('global', 'close_vault') }] });
  const r2 = await callTool('re_solana', { action: 'tx', transaction: tx2.toString('base64'), idl: legacyFile, offline: true });
  assert.equal(r2.instructions[0].name, 'closeVault');
  assert.deepEqual(r2.instructions[0].accounts, { owner: me });
});

// ------------------------------------------------------------------ programs
test('program: upgrade authority, deploy age, framework, crates, instructions, security.txt and the on-chain IDL', async () => {
  const programId = fake('prog'), programData = fake('prog-data'), authority = wallet();
  const security = Buffer.from('=======BEGIN SECURITY.TXT V1=======\0name\0Vault\0contacts\0email:sec@vault.example\0policy\0https://vault.example/security\0=======END SECURITY.TXT V1=======\0');
  const payload = Buffer.concat([
    Buffer.from('\0Instruction: Deposit\0Instruction: WithdrawAll\0AnchorError occurred\0'),
    Buffer.from('/home/runner/.cargo/registry/src/index.crates.io-6f17d22bba15001f/anchor-lang-0.30.1/src/lib.rs\0'),
    Buffer.from('/home/runner/.cargo/registry/src/index.crates.io-6f17d22bba15001f/solana-program-1.18.26/src/lib.rs\0programs/vault/src/instructions/deposit.rs\0sol_invoke_signed_rust\0'),
    key(TOKEN), security,
  ]);
  const elf = buildSbf(payload);
  chain.set(programId, { owner: LOADER, executable: true, data: Buffer.concat([u32(2), key(programData)]) });
  chain.set(programData, { owner: LOADER, data: Buffer.concat([u32(3), u64(399_999_000), u8(1), key(authority), elf]) });
  const idl = { address: programId, metadata: { name: 'vault', version: '0.1.0' }, instructions: [{ name: 'deposit', discriminator: [1, 2, 3, 4, 5, 6, 7, 8], accounts: [], args: [] }], accounts: [{ name: 'Vault', discriminator: [...anchorDiscriminator('account', 'Vault')] }], types: [{ name: 'Vault', type: { kind: 'struct', fields: [{ name: 'owner', type: 'pubkey' }, { name: 'total', type: 'u64' }] } }] };
  const z = zlib.deflateSync(Buffer.from(JSON.stringify(idl)));
  chain.set(b58encode(anchorIdlAddress(key(programId))), { owner: programId, data: Buffer.concat([Buffer.alloc(8), key(authority), u32(z.length), z]) });
  const r = await callTool('re_solana', { action: 'program', address: programId });
  assert.equal(r.loader, 'upgradeable');
  assert.equal(r.programData.upgradeAuthority, authority);
  assert.ok(r.findings.some(f => f.severity === 'caution' && /one wallet key/.test(f.text)));
  assert.ok(r.findings.some(f => /deployed or changed less than a day ago/.test(f.text)));
  assert.equal(r.code.framework, 'Anchor');
  assert.deepEqual(r.code.crates.find(c => c.name === 'anchor-lang').versions, ['0.30.1']);
  assert.deepEqual(r.code.instructions, ['Deposit', 'WithdrawAll']);
  assert.ok(r.code.capabilities.includes('calls other programs (CPI)'));
  assert.ok(r.code.references.some(x => x.name === 'SPL Token'));
  assert.deepEqual(r.code.sourceFiles, ['programs/vault/src/instructions/deposit.rs']);
  assert.equal(r.contact.contacts, 'email:sec@vault.example');
  assert.equal(r.idl.name, 'vault');
  assert.equal(r.verdict, 'caution');
  assert.match(r.summary, /vault 0\.1\.0\. Built with Anchor 0\.30\.1\./);
  // The IDL was saved: a data account of the program now decodes with it.
  const vaultAcc = fake('vault-acc');
  chain.set(vaultAcc, { owner: programId, data: Buffer.concat([anchorDiscriminator('account', 'Vault'), key(authority), u64(77)]) });
  const acc = await callTool('re_solana', { action: 'account', address: vaultAcc });
  assert.equal(acc.anchorType, 'Vault');
  assert.deepEqual(acc.decoded, { owner: authority, total: '77' });
  // Immutable program, and a program owned by a PDA (multisig).
  chain.set(programData, { owner: LOADER, data: Buffer.concat([u32(3), u64(1), u8(0), Buffer.alloc(32), elf]) });
  const imm = await callTool('re_solana', { action: 'program', address: programId, fresh: true });
  assert.ok(imm.findings.some(f => f.severity === 'ok' && /Immutable/.test(f.text)));
  const pda = b58encode(findProgramAddress([Buffer.from('multisig')], key(fake('squads'))).address);
  chain.set(programData, { owner: LOADER, data: Buffer.concat([u32(3), u64(1), u8(1), key(pda), elf]) });
  const ms = await callTool('re_solana', { action: 'program', address: programId });
  assert.ok(ms.findings.some(f => /program-derived address/.test(f.text)));
  // A local .so works offline.
  const so = path.join(dir, 'vault.so');
  await fs.writeFile(so, elf);
  const local = await callTool('re_solana', { action: 'program', file: so });
  assert.equal(local.code.framework, 'Anchor');
  assert.equal(local.address, undefined);
});

test('program: a closed program and a non-program address are reported, not crashed on', async () => {
  const programId = fake('closed'), gone = fake('closed-data');
  chain.set(programId, { owner: LOADER, executable: true, data: Buffer.concat([u32(2), key(gone)]) });
  const r = await callTool('re_solana', { action: 'program', address: programId });
  assert.equal(r.verdict, 'danger');
  assert.match(r.findings[0].text, /closed/);
  const w = wallet();
  chain.set(w, { owner: SYSTEM, data: Buffer.alloc(0), lamports: 2_000_000_000 });
  const nr = await callTool('re_solana', { action: 'program', address: w });
  assert.equal(nr.executable, false);
  assert.equal(nr.nextCall.args.action, 'account');
  await assert.rejects(callTool('re_solana', { action: 'program', address: fake('nothing-here') }), /No account/);
});

// ------------------------------------------------------------------ accounts
test('account: wallet, token account with an approval, mint authorities and Token-2022 extensions', async () => {
  const w = wallet(), delegate = wallet();
  chain.set(w, { owner: SYSTEM, data: Buffer.alloc(0), lamports: 2_500_000_000 });
  const wr = await callTool('re_solana', { action: 'account', address: w });
  assert.equal(wr.kind, 'wallet');
  assert.equal(wr.balance, '2.5 SOL');

  const ata = b58encode(associatedTokenAddress(key(w), key(USDC), key(TOKEN)));
  const tokenAcc = Buffer.concat([key(USDC), key(w), u64(12_340_000), u32(1), key(delegate), u8(1), u32(0), u64(0), u64(5_000_000), u32(0), Buffer.alloc(32)]);
  assert.equal(tokenAcc.length, 165);
  chain.set(ata, { owner: TOKEN, data: tokenAcc });
  const tr = await callTool('re_solana', { action: 'account', address: ata });
  assert.equal(tr.kind, 'token account');
  assert.equal(tr.token.amountFormatted, '12.34 USDC');
  assert.equal(tr.token.isAta, true);
  assert.equal(tr.token.delegate, delegate);
  assert.equal(tr.verdict, 'caution');

  const mint = fake('mint22'), mintAuth = wallet(), permanent = wallet(), hook = fake('hook');
  const base = Buffer.concat([u32(1), key(mintAuth), u64(1_000_000_000), u8(6), u8(1), u32(0), Buffer.alloc(32)]);
  const meta = Buffer.concat([Buffer.alloc(32), key(mint), u32(4), Buffer.from('Meme'), u32(3), Buffer.from('MEM'), u32(10), Buffer.from('https://x/'), u32(0)]);
  const fee = Buffer.concat([key(mintAuth), Buffer.alloc(32), u64(0), u64(0), u64(0), Buffer.from([0, 0]), u64(0), u64(1000), Buffer.from([0xf4, 0x01])]);
  const tlv = (type, v) => Buffer.concat([Buffer.from([type & 0xff, type >> 8]), Buffer.from([v.length & 0xff, v.length >> 8]), v]);
  const data = Buffer.concat([base, Buffer.alloc(165 - 82), u8(1), tlv(12, key(permanent)), tlv(14, Buffer.concat([Buffer.alloc(32), key(hook)])), tlv(1, fee), tlv(19, meta)]);
  chain.set(mint, { owner: T22, data });
  const mr = await callTool('re_solana', { action: 'account', address: mint });
  assert.equal(mr.kind, 'token mint');
  assert.equal(mr.mint.supplyFormatted, '1,000');
  assert.equal(mr.verdict, 'danger');
  assert.ok(mr.findings.some(f => /Permanent delegate/.test(f.text)));
  assert.ok(mr.findings.some(f => /fee of 5%/.test(f.text)));
  assert.ok(mr.findings.some(f => /transfer hook/.test(f.text)));
  assert.equal(mr.extensions.find(e => e.type === 'TokenMetadata').symbol, 'MEM');

  const empty = await callTool('re_solana', { action: 'account', address: wallet() });
  assert.equal(empty.exists, false);
});

// ------------------------------------------------------------------ simulation and landed transactions
test('tx simulate: real owner and delegate changes on the wallet\'s token account become danger findings', async () => {
  const me = wallet(), thief = wallet(), program = fake('drainer');
  const ata = b58encode(associatedTokenAddress(key(me), key(USDC), key(TOKEN)));
  const before = Buffer.concat([key(USDC), key(me), u64(10_000_000), u32(0), Buffer.alloc(32), u8(1), u32(0), u64(0), u64(0), u32(0), Buffer.alloc(32)]);
  const after = Buffer.concat([key(USDC), key(thief), u64(10_000_000), u32(1), key(thief), u8(1), u32(0), u64(0), u64(2n ** 64n - 1n), u32(0), Buffer.alloc(32)]);
  chain.set(ata, { owner: TOKEN, data: before });
  chain.set(me, { owner: SYSTEM, data: Buffer.alloc(0), lamports: 1_000_000_000 });
  simulateResult = params => {
    assert.equal(params[1].sigVerify, false);
    assert.equal(params[1].replaceRecentBlockhash, true);
    return { err: null, logs: ['Program log: claim airdrop'], unitsConsumed: 1234, accounts: params[1].accounts.addresses.map(a => (a === ata ? { lamports: 2039280, owner: TOKEN, executable: false, data: [after.toString('base64'), 'base64'] } : a === me ? { lamports: 990_000_000, owner: SYSTEM, executable: false, data: ['', 'base64'] } : null)) };
  };
  const tx = buildTx({ header: [1, 0, 1], keys: [me, ata, program], ixs: [{ p: 2, a: [0, 1], d: Buffer.from('claim') }] });
  const r = await callTool('re_solana', { action: 'tx', transaction: tx.toString('base64'), simulate: true });
  assert.equal(r.verdict, 'danger');
  assert.ok(r.findings.some(f => /gets a new owner/.test(f.text)));
  assert.ok(r.findings.some(f => /becomes approved to spend/.test(f.text)));
  assert.deepEqual(r.simulation.changes.find(c => c.asset === 'SOL'), { account: me, asset: 'SOL', change: '-0.01', mine: true });
  assert.match(r.summary, /Your balance changes: -0\.01 SOL/);
});

test('tx by signature: reports what actually happened from the transaction metadata', async () => {
  const me = wallet(), to = wallet();
  const tx = buildTx({ header: [1, 0, 1], keys: [me, to, SYSTEM], ixs: [{ p: 2, a: [0, 1], d: Buffer.concat([u32(2), u64(250_000_000)]) }], sign: true });
  txResult = { slot: 5, blockTime: 1_760_000_000, transaction: [tx.toString('base64'), 'base64'], meta: { err: null, fee: 5000, preBalances: [1_000_000_000, 0, 1], postBalances: [749_995_000, 250_000_000, 1], preTokenBalances: [], postTokenBalances: [], loadedAddresses: { writable: [], readonly: [] } } };
  const sig = b58encode(crypto.randomBytes(64));
  const r = await callTool('re_solana', { action: 'tx', transaction: sig });
  assert.equal(r.landed.status, 'succeeded');
  assert.deepEqual(r.actualChanges.find(c => c.mine), { account: me, asset: 'SOL', change: '-0.250005', mine: true });
  assert.equal(r.verdict, 'ok');
  assert.equal(calls.at(-1).method, 'getTransaction');
});

test('bad input gets a clear error with the next step', async () => {
  await assert.rejects(callTool('re_solana', { action: 'tx', transaction: 'not a tx!', offline: true }), /base64 or base58/);
  await assert.rejects(callTool('re_solana', { action: 'account', address: 'abc' }), /32-byte/);
  await assert.rejects(callTool('re_solana', { action: 'tx', transaction: Buffer.from([1, 2, 3]).toString('base64'), offline: true }), /ends early|Not a Solana|header/);
  await assert.rejects(callTool('re_solana', { action: 'account', address: TOKEN, cluster: 'moon' }), /one of/);
});
