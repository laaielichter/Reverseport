// Solana without an SDK: read deployed programs, accounts and transactions straight from the bytes.
// Answers the questions people and agents have before they trust or sign anything on Solana:
//   program  - who can change this program, what is inside it (framework, crates, instructions, security.txt, IDL)?
//   account  - what is this address (wallet, token account, mint, program data) and what can its authorities do?
//   tx       - what will this transaction really do to my wallet, in plain words, and is any of it dangerous?
// Zero dependencies: base58, ed25519 point checks, PDAs, the wire format and the instruction layouts are hand-written.
// Network access is plain JSON-RPC through globalThis.fetch, so tests can stand in for the chain.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RPError, requireFile, readJson, writeJson } from './util.mjs';
import { parseELF } from './binary.mjs';
import { workspaceDir } from './workspace.mjs';

export const ACTIONS = ['program', 'account', 'tx', 'address'];
export const CLUSTERS = { mainnet: 'https://api.mainnet-beta.solana.com', devnet: 'https://api.devnet.solana.com', testnet: 'https://api.testnet.solana.com' };

// ---------------------------------------------------------------------------------------------------- base58
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHA_MAP = new Map([...ALPHABET].map((c, i) => [c, BigInt(i)]));

export function b58encode(bytes) {
  const buf = Buffer.from(bytes);
  let n = buf.length ? BigInt('0x' + buf.toString('hex')) : 0n;
  let out = '';
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b !== 0) break; out = '1' + out; }
  return out;
}

export function b58decode(text) {
  if (typeof text !== 'string' || !text) throw new RPError('INVALID_ARGUMENT', 'Expected a base58 string.');
  let n = 0n;
  for (const c of text) {
    const v = ALPHA_MAP.get(c);
    if (v === undefined) throw new RPError('INVALID_ARGUMENT', `"${text.length > 60 ? text.slice(0, 57) + '…' : text}" is not base58 (character "${c}").`);
    n = n * 58n + v;
  }
  let hexStr = n === 0n ? '' : n.toString(16);
  if (hexStr.length % 2) hexStr = '0' + hexStr;
  let zeros = 0;
  for (const c of text) { if (c !== '1') break; zeros++; }
  return Buffer.concat([Buffer.alloc(zeros), Buffer.from(hexStr, 'hex')]);
}

/** A 32-byte public key from base58 text. */
export function pubkey(text, what = 'address') {
  const b = b58decode(String(text).trim());
  if (b.length !== 32) throw new RPError('INVALID_ARGUMENT', `${what} must be a 32-byte base58 Solana address (got ${b.length} bytes).`);
  return b;
}

// ---------------------------------------------------------------------------------------------------- ed25519 / PDAs
const P = 2n ** 255n - 19n;
const mod = a => ((a % P) + P) % P;
function powmod(b, e) { let r = 1n; b = mod(b); while (e > 0n) { if (e & 1n) r = (r * b) % P; b = (b * b) % P; e >>= 1n; } return r; }
const D = mod(-121665n * powmod(121666n, P - 2n));
const SQRT_M1 = powmod(2n, (P - 1n) / 4n);

/**
 * Is these 32 bytes a point on the ed25519 curve? Same rule as curve25519-dalek's decompress, which Solana uses:
 * wallet keys are on the curve, program-derived addresses (PDAs) are not.
 */
export function isOnCurve(bytes) {
  const b = Buffer.from(bytes);
  if (b.length !== 32) return false;
  const yb = Buffer.from(b); yb[31] &= 0x7f;
  const y = mod(BigInt('0x' + Buffer.from(yb).reverse().toString('hex')));
  const y2 = (y * y) % P;
  const u = mod(y2 - 1n), v = mod(D * y2 + 1n);
  const v3 = (v * v % P) * v % P, v7 = (v3 * v3 % P) * v % P;
  let x = (u * v3 % P) * powmod(u * v7 % P, (P - 5n) / 8n) % P;
  const vx2 = v * (x * x % P) % P;
  if (vx2 === u) return true;
  if (vx2 === mod(-u)) { x = x * SQRT_M1 % P; return true; }
  return false;
}

const sha256 = (...parts) => crypto.createHash('sha256').update(Buffer.concat(parts.map(p => (typeof p === 'string' ? Buffer.from(p) : Buffer.from(p))))).digest();

export function createProgramAddress(seeds, programId) {
  if (seeds.length > 16 || seeds.some(s => Buffer.from(s).length > 32)) throw new RPError('INVALID_ARGUMENT', 'At most 16 seeds of at most 32 bytes each.');
  const h = sha256(...seeds, programId, 'ProgramDerivedAddress');
  return isOnCurve(h) ? null : h;
}

export function findProgramAddress(seeds, programId) {
  for (let bump = 255; bump >= 0; bump--) {
    const a = createProgramAddress([...seeds, Buffer.from([bump])], programId);
    if (a) return { address: a, bump };
  }
  throw new RPError('SOURCE_ERROR', 'No viable bump for these seeds.');
}

export const createWithSeed = (base, seed, owner) => sha256(base, seed, owner);

/** Anchor's 8-byte discriminator: sha256("<namespace>:<name>")[0..8]. */
export const anchorDiscriminator = (namespace, name) => sha256(`${namespace}:${name}`).subarray(0, 8);
const toSnake = s => String(s).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z])([A-Z][a-z])/g, '$1_$2').toLowerCase();

/** Where Anchor stores a program's on-chain IDL. */
export function anchorIdlAddress(programId) {
  const pid = Buffer.from(programId);
  const base = findProgramAddress([], pid).address;
  return createWithSeed(base, 'anchor:idl', pid);
}

/** The associated token account of owner for mint under a token program. */
export function associatedTokenAddress(owner, mint, tokenProgram = KEY.token) {
  return findProgramAddress([Buffer.from(owner), Buffer.from(tokenProgram), Buffer.from(mint)], KEY.ata).address;
}

// ---------------------------------------------------------------------------------------------------- known programs
const KNOWN_TEXT = {
  '11111111111111111111111111111111': 'System Program',
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: 'SPL Token',
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: 'Token-2022',
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: 'Associated Token Account',
  ComputeBudget111111111111111111111111111111: 'Compute Budget',
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: 'Memo',
  Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo: 'Memo (v1)',
  BPFLoaderUpgradeab1e11111111111111111111111: 'BPF Upgradeable Loader',
  BPFLoader2111111111111111111111111111111111: 'BPF Loader v2',
  BPFLoader1111111111111111111111111111111111: 'BPF Loader v1',
  LoaderV411111111111111111111111111111111111: 'Loader v4',
  NativeLoader1111111111111111111111111111111: 'Native Loader',
  Stake11111111111111111111111111111111111111: 'Stake Program',
  Vote111111111111111111111111111111111111111: 'Vote Program',
  AddressLookupTab1e1111111111111111111111111: 'Address Lookup Table',
  Ed25519SigVerify111111111111111111111111111: 'Ed25519 signature check',
  KeccakSecp256k11111111111111111111111111111: 'Secp256k1 signature check',
  SysvarRent111111111111111111111111111111111: 'Rent sysvar',
  SysvarC1ock11111111111111111111111111111111: 'Clock sysvar',
  Sysvar1nstructions1111111111111111111111111: 'Instructions sysvar',
  metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s: 'Metaplex Token Metadata',
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: 'Jupiter Aggregator v6',
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: 'Orca Whirlpools',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium AMM v4',
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: 'Raydium CLMM',
  SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf: 'Squads Multisig v4',
  SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu: 'Squads Multisig v3',
  GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw: 'SPL Governance',
};
export const KNOWN_PROGRAMS = new Map(Object.entries(KNOWN_TEXT));
const k = text => b58decode(text);
const KEY = {
  system: k('11111111111111111111111111111111'), token: k('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), token2022: k('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),
  ata: k('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'), upgradeable: k('BPFLoaderUpgradeab1e11111111111111111111111'),
};
const MINTS = { EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', decimals: 6 }, Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', decimals: 6 }, So11111111111111111111111111111111111111112: { symbol: 'wSOL', decimals: 9 } };
const label = addr => KNOWN_PROGRAMS.get(addr) ?? MINTS[addr]?.symbol;
const isTokenProgram = a => a === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' || a === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// ---------------------------------------------------------------------------------------------------- byte reader
class Reader {
  constructor(buf, o = 0) { this.b = buf; this.o = o; }
  need(n, what) { if (this.o + n > this.b.length) throw new RPError('MALFORMED', `Data ends early while reading ${what} (offset ${this.o}, need ${n} bytes, have ${this.b.length - this.o}).`); }
  u8(w = 'u8') { this.need(1, w); return this.b[this.o++]; }
  u16(w = 'u16') { this.need(2, w); const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  u32(w = 'u32') { this.need(4, w); const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
  u64(w = 'u64') { this.need(8, w); const v = this.b.readBigUInt64LE(this.o); this.o += 8; return v; }
  i64(w = 'i64') { this.need(8, w); const v = this.b.readBigInt64LE(this.o); this.o += 8; return v; }
  bytes(n, w = 'bytes') { this.need(n, w); const v = this.b.subarray(this.o, this.o + n); this.o += n; return v; }
  key(w = 'address') { return b58encode(this.bytes(32, w)); }
  shortvec(w = 'length') {
    let len = 0;
    for (let i = 0; i < 3; i++) { const b = this.u8(w); len |= (b & 0x7f) << (7 * i); if (!(b & 0x80)) return len; }
    throw new RPError('MALFORMED', `Bad compact length for ${w}.`);
  }
  get left() { return this.b.length - this.o; }
}

// ---------------------------------------------------------------------------------------------------- transactions
/** Parse a serialized transaction (signatures + message) or a bare message. */
export function parseTransaction(bytes) {
  const buf = Buffer.from(bytes);
  // A bare message starts with the version prefix (0x80) or a header whose first byte (required signers) is ≥ 1.
  try {
    const r = new Reader(buf);
    const n = r.shortvec('signature count');
    if (n === 0 || n > 64) throw new RPError('MALFORMED', 'not a full transaction');
    const signatures = [];
    for (let i = 0; i < n; i++) { const s = r.bytes(64, 'signature'); signatures.push(s.every(x => x === 0) ? null : b58encode(s)); }
    const message = parseMessage(buf.subarray(r.o));
    if (message.header.requiredSignatures !== n) throw new RPError('MALFORMED', `transaction has ${n} signature slots but the message needs ${message.header.requiredSignatures}`);
    return { signatures, message, messageBytes: buf.subarray(r.o) };
  } catch (e) {
    try { return { signatures: [], message: parseMessage(buf), messageBytes: buf, bareMessage: true }; }
    catch { throw e.code ? e : new RPError('MALFORMED', `Not a Solana transaction: ${e.message}`); }
  }
}

export function parseMessage(buf) {
  const r = new Reader(Buffer.from(buf));
  let version = 'legacy';
  if (r.b[0] & 0x80) { version = r.u8() & 0x7f; if (version !== 0) throw new RPError('UNSUPPORTED', `Transaction version ${version} is not supported (legacy and v0 are).`); }
  const header = { requiredSignatures: r.u8('header'), readonlySigned: r.u8('header'), readonlyUnsigned: r.u8('header') };
  const nKeys = r.shortvec('account count');
  const keys = [];
  for (let i = 0; i < nKeys; i++) keys.push(r.key('account key'));
  if (header.requiredSignatures > nKeys || header.readonlySigned > header.requiredSignatures || header.readonlyUnsigned > nKeys - header.requiredSignatures) throw new RPError('MALFORMED', 'Message header does not fit its account list.');
  const recentBlockhash = r.key('recent blockhash');
  const nIx = r.shortvec('instruction count');
  const instructions = [];
  for (let i = 0; i < nIx; i++) {
    const programIndex = r.u8('program index');
    const nAcc = r.shortvec('instruction accounts');
    const accounts = [...r.bytes(nAcc, 'instruction accounts')];
    const data = Buffer.from(r.bytes(r.shortvec('instruction data length'), 'instruction data'));
    instructions.push({ programIndex, accounts, data });
  }
  const lookups = [];
  if (version === 0) {
    const n = r.shortvec('lookup count');
    for (let i = 0; i < n; i++) {
      const table = r.key('lookup table');
      const writable = [...r.bytes(r.shortvec('lookup writable'), 'lookup writable')];
      const readonly = [...r.bytes(r.shortvec('lookup readonly'), 'lookup readonly')];
      lookups.push({ table, writable, readonly });
    }
  }
  if (r.left) throw new RPError('MALFORMED', `${r.left} unexpected bytes after the message.`);
  return { version, header, keys, recentBlockhash, instructions, lookups };
}

/** Every account the message touches, with signer/writable flags; lookup-table entries resolved when known. */
function accountList(message, loaded = null) {
  const { header, keys, lookups } = message;
  const n = keys.length;
  const list = keys.map((address, i) => ({
    address, signer: i < header.requiredSignatures,
    writable: i < header.requiredSignatures ? i < header.requiredSignatures - header.readonlySigned : i < n - header.readonlyUnsigned,
  }));
  for (const kind of ['writable', 'readonly']) {
    let k = 0;
    for (const l of lookups) for (const index of l[kind]) list.push({ address: loaded?.[kind]?.[k++] ?? null, signer: false, writable: kind === 'writable', lookup: { table: l.table, index } });
  }
  return list;
}

const LOOKUP_META = 56;
function lookupAddresses(data) {
  const out = [];
  for (let o = LOOKUP_META; o + 32 <= data.length; o += 32) out.push(b58encode(data.subarray(o, o + 32)));
  return out;
}

// ---------------------------------------------------------------------------------------------------- amounts
const LAMPORTS = 1_000_000_000n;
export function formatUnits(raw, decimals) {
  const v = BigInt(raw);
  if (decimals === undefined || decimals === null) return `${v} (raw units)`;
  const neg = v < 0n, a = neg ? -v : v, d = 10n ** BigInt(decimals);
  const frac = (a % d).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${(a / d).toLocaleString('en-US')}${frac ? '.' + frac : ''}`;
}
const sol = lamports => `${formatUnits(lamports, 9)} SOL`;
const U64_MAX = 2n ** 64n - 1n;

// ---------------------------------------------------------------------------------------------------- instruction decoders
// Each decoder returns { name, args, accounts: {role: address}, effects: [{severity, text}] }.
// Severities: info (normal), caution (read before signing), danger (a common way wallets get drained).
const SYSTEM_IX = ['CreateAccount', 'Assign', 'Transfer', 'CreateAccountWithSeed', 'AdvanceNonceAccount', 'WithdrawNonceAccount', 'InitializeNonceAccount', 'AuthorizeNonceAccount', 'Allocate', 'AllocateWithSeed', 'AssignWithSeed', 'TransferWithSeed', 'UpgradeNonceAccount'];
const TOKEN_IX = ['InitializeMint', 'InitializeAccount', 'InitializeMultisig', 'Transfer', 'Approve', 'Revoke', 'SetAuthority', 'MintTo', 'Burn', 'CloseAccount', 'FreezeAccount', 'ThawAccount', 'TransferChecked', 'ApproveChecked', 'MintToChecked', 'BurnChecked', 'InitializeAccount2', 'SyncNative', 'InitializeAccount3', 'InitializeMultisig2', 'InitializeMint2', 'GetAccountDataSize', 'InitializeImmutableOwner', 'AmountToUiAmount', 'UiAmountToAmount'];
const AUTHORITY_TYPES = ['MintTokens', 'FreezeAccount', 'AccountOwner', 'CloseAccount', 'TransferFeeConfig', 'WithheldWithdraw', 'CloseMint', 'InterestRate', 'PermanentDelegate', 'ConfidentialTransferMint', 'TransferHookProgramId', 'ConfidentialTransferFeeConfig', 'MetadataPointer', 'GroupPointer', 'GroupMemberPointer', 'ScaledUiAmount', 'Pause'];
const STAKE_IX = ['Initialize', 'Authorize', 'DelegateStake', 'Split', 'Withdraw', 'Deactivate', 'SetLockup', 'Merge', 'AuthorizeWithSeed', 'InitializeChecked', 'AuthorizeChecked', 'AuthorizeCheckedWithSeed', 'SetLockupChecked', 'GetMinimumDelegation', 'DeactivateDelinquent', 'Redelegate', 'MoveStake', 'MoveLamports'];
const LOADER_IX = ['InitializeBuffer', 'Write', 'DeployWithMaxDataLen', 'Upgrade', 'SetAuthority', 'Close', 'ExtendProgram', 'SetAuthorityChecked', 'Migrate', 'ExtendProgramChecked'];

const name = a => (a ? (label(a) ? `${a} (${label(a)})` : a) : 'an address from a lookup table');
const roles = (accts, names) => Object.fromEntries(names.map((n, i) => [n, accts[i]?.address ?? null]).filter(([, v]) => v !== undefined));

function decodeSystem(data, accts, ctx) {
  const r = new Reader(data);
  const tag = r.u32('instruction');
  const ix = SYSTEM_IX[tag] ?? `Instruction ${tag}`;
  const out = { name: ix, args: {}, accounts: {}, effects: [] };
  const mine = a => ctx.mine(a);
  switch (tag) {
    case 0: { const lamports = r.u64(), space = r.u64(), owner = r.key(); out.accounts = roles(accts, ['funder', 'newAccount']); out.args = { lamports: String(lamports), space: String(space), owner };
      out.effects.push({ severity: 'info', text: `Creates account ${name(out.accounts.newAccount)} (${space} bytes, owned by ${name(owner)}), funded with ${sol(lamports)} from ${name(out.accounts.funder)}.` }); break; }
    case 1: case 10: {
      const owner = tag === 1 ? r.key() : (r.key(), r.bytes(Number(r.u64('seed length')), 'seed'), r.key());
      out.accounts = roles(accts, tag === 1 ? ['account'] : ['account', 'base']); out.args = { owner };
      const target = out.accounts.account;
      const danger = owner !== '11111111111111111111111111111111' && mine(target);
      out.effects.push({ severity: danger ? 'danger' : 'caution', text: `Hands ownership of ${name(target)} to program ${name(owner)}. ${danger ? 'That program can then move all SOL in it — a known wallet-drain trick unless you are setting up a brand-new account.' : 'The new owner program controls the account from then on.'}` }); break; }
    case 2: { const lamports = r.u64(); out.accounts = roles(accts, ['from', 'to']); out.args = { lamports: String(lamports) };
      ctx.flow('SOL', out.accounts.from, out.accounts.to, lamports, 9);
      out.effects.push({ severity: 'info', text: `Sends ${sol(lamports)} from ${name(out.accounts.from)} to ${name(out.accounts.to)}.` }); break; }
    case 3: { const base = r.key(); const seed = r.bytes(Number(r.u64('seed length')), 'seed').toString('utf8'); const lamports = r.u64(), space = r.u64(), owner = r.key();
      out.accounts = roles(accts, ['funder', 'newAccount', 'base']); out.args = { base, seed, lamports: String(lamports), space: String(space), owner };
      out.effects.push({ severity: 'info', text: `Creates account ${name(out.accounts.newAccount)} with seed "${seed}" (${space} bytes, owned by ${name(owner)}), funded with ${sol(lamports)}.` }); break; }
    case 4: out.accounts = roles(accts, ['nonceAccount', 'recentBlockhashes', 'nonceAuthority']);
      ctx.durableNonce = out.accounts.nonceAccount;
      out.effects.push({ severity: 'caution', text: `Uses durable nonce ${name(out.accounts.nonceAccount)}: this signed transaction never expires and can be submitted at any later time by whoever holds it.` }); break;
    case 5: { const lamports = r.u64(); out.accounts = roles(accts, ['nonceAccount', 'to', 'recentBlockhashes', 'rent', 'nonceAuthority']); out.args = { lamports: String(lamports) };
      ctx.flow('SOL', out.accounts.nonceAccount, out.accounts.to, lamports, 9);
      out.effects.push({ severity: 'info', text: `Withdraws ${sol(lamports)} from nonce account ${name(out.accounts.nonceAccount)} to ${name(out.accounts.to)}.` }); break; }
    case 6: { const authority = r.key(); out.accounts = roles(accts, ['nonceAccount']); out.args = { authority }; out.effects.push({ severity: 'info', text: `Sets up durable nonce account ${name(out.accounts.nonceAccount)} with authority ${name(authority)}.` }); break; }
    case 7: { const authority = r.key(); out.accounts = roles(accts, ['nonceAccount', 'nonceAuthority']); out.args = { newAuthority: authority };
      out.effects.push({ severity: 'danger', text: `Gives control of durable nonce account ${name(out.accounts.nonceAccount)} to ${name(authority)}.` }); break; }
    case 8: { const space = r.u64(); out.accounts = roles(accts, ['account']); out.args = { space: String(space) }; out.effects.push({ severity: 'info', text: `Allocates ${space} bytes for ${name(out.accounts.account)}.` }); break; }
    case 11: { const lamports = r.u64(); out.accounts = roles(accts, ['from', 'base', 'to']); out.args = { lamports: String(lamports) };
      ctx.flow('SOL', out.accounts.from, out.accounts.to, lamports, 9);
      out.effects.push({ severity: 'info', text: `Sends ${sol(lamports)} from ${name(out.accounts.from)} to ${name(out.accounts.to)}.` }); break; }
    default: out.effects.push({ severity: 'info', text: `System instruction ${ix}.` });
  }
  return out;
}

function decodeToken(data, accts, ctx, program) {
  const r = new Reader(data);
  const tag = r.u8('instruction');
  const ix = TOKEN_IX[tag] ?? (program === 'Token-2022' ? `Token-2022 extension instruction ${tag}` : `Instruction ${tag}`);
  const out = { name: ix, args: {}, accounts: {}, effects: [] };
  const amountText = (raw, decimals, mint) => (decimals !== undefined ? `${formatUnits(raw, decimals)}${MINTS[mint]?.symbol ? ' ' + MINTS[mint].symbol : ' tokens'}` : `${raw} base units of tokens`);
  switch (tag) {
    case 3: { const amount = r.u64(); out.accounts = roles(accts, ['source', 'destination', 'owner']); out.args = { amount: String(amount) };
      ctx.flow('token', out.accounts.source, out.accounts.destination, amount, undefined, null);
      out.effects.push({ severity: 'info', text: `Moves ${amountText(amount)} from token account ${name(out.accounts.source)} to ${name(out.accounts.destination)}.` }); break; }
    case 12: { const amount = r.u64(), decimals = r.u8(); out.accounts = roles(accts, ['source', 'mint', 'destination', 'owner']); out.args = { amount: String(amount), decimals };
      ctx.flow('token', out.accounts.source, out.accounts.destination, amount, decimals, out.accounts.mint);
      out.effects.push({ severity: 'info', text: `Moves ${amountText(amount, decimals, out.accounts.mint)} (mint ${name(out.accounts.mint)}) from ${name(out.accounts.source)} to ${name(out.accounts.destination)}.` }); break; }
    case 4: case 13: { const amount = r.u64(); const decimals = tag === 13 ? r.u8() : undefined;
      out.accounts = roles(accts, tag === 4 ? ['source', 'delegate', 'owner'] : ['source', 'mint', 'delegate', 'owner']); out.args = { amount: String(amount), ...(decimals !== undefined ? { decimals } : {}) };
      const unlimited = amount === U64_MAX;
      out.effects.push({ severity: unlimited ? 'danger' : 'caution', text: `Lets ${name(out.accounts.delegate)} spend ${unlimited ? 'ALL tokens (unlimited approval)' : `up to ${amountText(amount, decimals, out.accounts.mint)}`} from token account ${name(out.accounts.source)} — later, without asking you again, until you revoke it.` }); break; }
    case 5: out.accounts = roles(accts, ['source', 'owner']); out.effects.push({ severity: 'info', text: `Removes the spending approval on ${name(out.accounts.source)}.` }); break;
    case 6: { const type = r.u8('authority type'); const has = r.u8('option'); const newAuthority = has ? r.key() : null;
      const kind = AUTHORITY_TYPES[type] ?? `authority type ${type}`;
      out.accounts = roles(accts, ['account', 'currentAuthority']); out.args = { authorityType: kind, newAuthority };
      const severe = ['AccountOwner', 'CloseAccount', 'PermanentDelegate'].includes(kind) || (newAuthority && !ctx.mine(newAuthority));
      out.effects.push({ severity: severe ? 'danger' : 'caution', text: newAuthority ? `Changes the ${kind} authority of ${name(out.accounts.account)} to ${name(newAuthority)}.${kind === 'AccountOwner' ? ' The new owner can move every token in it.' : ''}` : `Removes the ${kind} authority of ${name(out.accounts.account)} for good.` }); break; }
    case 7: case 14: { const amount = r.u64(); const decimals = tag === 14 ? r.u8() : undefined; out.accounts = roles(accts, ['mint', 'destination', 'mintAuthority']); out.args = { amount: String(amount) };
      out.effects.push({ severity: 'info', text: `Mints ${amountText(amount, decimals, out.accounts.mint)} of ${name(out.accounts.mint)} into ${name(out.accounts.destination)}.` }); break; }
    case 8: case 15: { const amount = r.u64(); const decimals = tag === 15 ? r.u8() : undefined; out.accounts = roles(accts, ['account', 'mint', 'owner']); out.args = { amount: String(amount) };
      out.effects.push({ severity: ctx.mine(out.accounts.owner) ? 'caution' : 'info', text: `Burns (destroys) ${amountText(amount, decimals, out.accounts.mint)} from ${name(out.accounts.account)}.` }); break; }
    case 9: { out.accounts = roles(accts, ['account', 'rentDestination', 'owner']);
      const away = out.accounts.rentDestination && !ctx.mine(out.accounts.rentDestination) && out.accounts.rentDestination !== out.accounts.owner;
      out.effects.push({ severity: away ? 'caution' : 'info', text: `Closes token account ${name(out.accounts.account)}; its rent deposit goes to ${name(out.accounts.rentDestination)}.` }); break; }
    case 10: case 11: out.accounts = roles(accts, ['account', 'mint', 'authority']); out.effects.push({ severity: 'caution', text: `${tag === 10 ? 'Freezes' : 'Unfreezes'} token account ${name(out.accounts.account)}.` }); break;
    case 0: case 20: { const decimals = r.u8(); const mintAuthority = r.key(); out.accounts = roles(accts, ['mint']); out.args = { decimals, mintAuthority };
      out.effects.push({ severity: 'info', text: `Creates token mint ${name(out.accounts.mint)} (${decimals} decimals, mint authority ${name(mintAuthority)}).` }); break; }
    case 1: case 16: case 18: out.accounts = roles(accts, ['account', 'mint']); out.effects.push({ severity: 'info', text: `Opens token account ${name(out.accounts.account)} for mint ${name(out.accounts.mint)}.` }); break;
    case 17: out.accounts = roles(accts, ['account']); out.effects.push({ severity: 'info', text: `Syncs the wrapped-SOL balance of ${name(out.accounts.account)}.` }); break;
    default: out.effects.push({ severity: tag > 24 ? 'caution' : 'info', text: `${program} instruction ${ix}.` });
  }
  return out;
}

function decodeAta(data, accts) {
  const tag = data.length ? data[0] : 0;
  const ix = ['Create', 'CreateIdempotent', 'RecoverNested'][tag] ?? `Instruction ${tag}`;
  const accounts = roles(accts, tag === 2 ? ['nestedAccount', 'nestedMint', 'destination', 'ownerAccount', 'ownerMint', 'wallet', 'tokenProgram'] : ['payer', 'associatedAccount', 'wallet', 'mint', 'systemProgram', 'tokenProgram']);
  return { name: ix, args: {}, accounts, effects: [{ severity: 'info', text: tag === 2 ? 'Recovers tokens from a nested associated token account.' : `Opens the token account for ${name(accounts.wallet)} and mint ${name(accounts.mint)} (if missing).` }] };
}

function decodeComputeBudget(data, accts, ctx) {
  const r = new Reader(data);
  const tag = r.u8('instruction');
  if (tag === 2) { const units = r.u32(); ctx.cuLimit = units; return { name: 'SetComputeUnitLimit', args: { units }, accounts: {}, effects: [] }; }
  if (tag === 3) { const microLamports = r.u64(); ctx.cuPrice = microLamports; return { name: 'SetComputeUnitPrice', args: { microLamports: String(microLamports) }, accounts: {}, effects: [] }; }
  if (tag === 1) return { name: 'RequestHeapFrame', args: { bytes: r.u32() }, accounts: {}, effects: [] };
  if (tag === 4) return { name: 'SetLoadedAccountsDataSizeLimit', args: { bytes: r.u32() }, accounts: {}, effects: [] };
  return { name: `Instruction ${tag}`, args: {}, accounts: {}, effects: [] };
}

function decodeMemo(data) {
  const text = data.toString('utf8');
  return { name: 'Memo', args: { text: text.length > 300 ? text.slice(0, 300) + '…' : text }, accounts: {}, effects: [{ severity: 'info', text: `Adds the public note "${text.length > 120 ? text.slice(0, 117) + '…' : text}".` }] };
}

function decodeStake(data, accts, ctx) {
  const r = new Reader(data);
  const tag = r.u32('instruction');
  const ix = STAKE_IX[tag] ?? `Instruction ${tag}`;
  const out = { name: ix, args: {}, accounts: {}, effects: [] };
  if (tag === 1 || tag === 8) {
    const newAuthority = r.key(); const type = r.u32('authority type') === 1 ? 'Withdrawer' : 'Staker';
    out.accounts = roles(accts, ['stakeAccount']); out.args = { newAuthority, type };
    out.effects.push({ severity: type === 'Withdrawer' || !ctx.mine(newAuthority) ? 'danger' : 'caution', text: `Gives the ${type} role of stake account ${name(out.accounts.stakeAccount)} to ${name(newAuthority)}.${type === 'Withdrawer' ? ' The withdrawer can take all the staked SOL.' : ''}` });
  } else if (tag === 10 || tag === 11) {
    const type = r.u32('authority type') === 1 ? 'Withdrawer' : 'Staker';
    out.accounts = roles(accts, tag === 10 ? ['stakeAccount', 'clock', 'currentAuthority', 'newAuthority'] : ['stakeAccount', 'base', 'clock', 'newAuthority']); out.args = { type };
    out.effects.push({ severity: type === 'Withdrawer' || !ctx.mine(out.accounts.newAuthority) ? 'danger' : 'caution', text: `Gives the ${type} role of stake account ${name(out.accounts.stakeAccount)} to ${name(out.accounts.newAuthority)}.` });
  } else if (tag === 4) {
    const lamports = r.u64(); out.accounts = roles(accts, ['stakeAccount', 'to', 'clock', 'stakeHistory', 'withdrawAuthority']); out.args = { lamports: String(lamports) };
    ctx.flow('SOL', out.accounts.stakeAccount, out.accounts.to, lamports, 9);
    out.effects.push({ severity: ctx.mine(out.accounts.to) ? 'info' : 'caution', text: `Withdraws ${sol(lamports)} from stake account ${name(out.accounts.stakeAccount)} to ${name(out.accounts.to)}.` });
  } else out.effects.push({ severity: 'info', text: `Stake instruction ${ix}.` });
  return out;
}

function decodeLoader(data, accts) {
  const r = new Reader(data);
  const tag = r.u32('instruction');
  const ix = LOADER_IX[tag] ?? `Instruction ${tag}`;
  const out = { name: ix, args: {}, accounts: {}, effects: [] };
  if (tag === 3) { out.accounts = roles(accts, ['programData', 'program', 'buffer', 'spill', 'rent', 'clock', 'authority']); out.effects.push({ severity: 'caution', text: `Replaces the code of program ${name(out.accounts.program)} with the code in buffer ${name(out.accounts.buffer)}.` }); }
  else if (tag === 4 || tag === 7) { out.accounts = roles(accts, ['account', 'currentAuthority', 'newAuthority']); out.effects.push({ severity: 'danger', text: out.accounts.newAuthority ? `Gives upgrade control of ${name(out.accounts.account)} to ${name(out.accounts.newAuthority)}.` : `Makes ${name(out.accounts.account)} immutable (no upgrade authority).` }); }
  else if (tag === 5) { out.accounts = roles(accts, ['account', 'recipient', 'authority', 'program']); out.effects.push({ severity: 'danger', text: `Closes ${name(out.accounts.account)} and sends its SOL to ${name(out.accounts.recipient)}; a closed program cannot run any more.` }); }
  else out.effects.push({ severity: 'info', text: `Upgradeable loader instruction ${ix}.` });
  return out;
}

const BUILTIN_DECODERS = {
  '11111111111111111111111111111111': decodeSystem,
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: (d, a, c) => decodeToken(d, a, c, 'SPL Token'),
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: (d, a, c) => decodeToken(d, a, c, 'Token-2022'),
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: decodeAta,
  ComputeBudget111111111111111111111111111111: decodeComputeBudget,
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: decodeMemo,
  Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo: decodeMemo,
  Stake11111111111111111111111111111111111111: decodeStake,
  BPFLoaderUpgradeab1e11111111111111111111111: decodeLoader,
};

// ---------------------------------------------------------------------------------------------------- IDL (Anchor)
/** Normalize a legacy (≤0.29) or new (0.30+) Anchor IDL into one shape with discriminators. */
export function normalizeIdl(idl) {
  if (!idl || typeof idl !== 'object' || !Array.isArray(idl.instructions)) throw new RPError('INVALID_ARGUMENT', 'Not an Anchor IDL (no instructions list).');
  const types = new Map((idl.types ?? []).map(t => [t.name, t.type]));
  const flatten = (list, prefix = '') => (list ?? []).flatMap(a => (Array.isArray(a.accounts) ? flatten(a.accounts, `${prefix}${a.name}.`) : [{ name: prefix + a.name, writable: !!(a.writable ?? a.isMut), signer: !!(a.signer ?? a.isSigner) }]));
  const instructions = idl.instructions.map(ix => ({ name: ix.name, discriminator: Buffer.from(ix.discriminator ?? anchorDiscriminator('global', toSnake(ix.name))), args: ix.args ?? [], accounts: flatten(ix.accounts) }));
  const accounts = (idl.accounts ?? []).map(a => ({ name: a.name, discriminator: Buffer.from(a.discriminator ?? anchorDiscriminator('account', a.name)), type: a.type ?? types.get(a.name) }));
  return { name: idl.metadata?.name ?? idl.name ?? null, version: idl.metadata?.version ?? idl.version ?? null, address: idl.address ?? idl.metadata?.address ?? null, instructions, accounts, types, errors: (idl.errors ?? []).map(e => ({ code: e.code, name: e.name, msg: e.msg })) };
}

const MAX_DEPTH = 12, MAX_ITEMS = 256;
/** Decode a borsh value of an IDL type. */
export function borshDecode(r, type, types, depth = 0) {
  if (depth > MAX_DEPTH) throw new RPError('MALFORMED', 'Type nesting too deep.');
  if (typeof type === 'string') {
    switch (type) {
      case 'bool': return r.u8('bool') !== 0;
      case 'u8': return r.u8(); case 'i8': { const v = r.u8(); return v > 127 ? v - 256 : v; }
      case 'u16': return r.u16(); case 'i16': { const v = r.u16(); return v > 32767 ? v - 65536 : v; }
      case 'u32': return r.u32(); case 'i32': { r.need(4, 'i32'); const v = r.b.readInt32LE(r.o); r.o += 4; return v; }
      case 'f32': { r.need(4, 'f32'); const v = r.b.readFloatLE(r.o); r.o += 4; return v; }
      case 'f64': { r.need(8, 'f64'); const v = r.b.readDoubleLE(r.o); r.o += 8; return v; }
      case 'u64': return String(r.u64()); case 'i64': return String(r.i64());
      case 'u128': case 'i128': { const lo = r.u64(), hi = r.u64(); let v = (hi << 64n) | lo; if (type === 'i128' && hi >> 63n) v -= 2n ** 128n; return String(v); }
      case 'pubkey': case 'publicKey': return r.key();
      case 'string': return r.bytes(r.u32('string length'), 'string').toString('utf8');
      case 'bytes': return r.bytes(r.u32('bytes length'), 'bytes').toString('base64');
      default: throw new RPError('UNSUPPORTED', `IDL type ${type} is not supported.`);
    }
  }
  if (type.vec) { const n = r.u32('vec length'); if (n > 1_000_000) throw new RPError('MALFORMED', 'Vector length is implausible.'); const out = []; for (let i = 0; i < n; i++) { const v = borshDecode(r, type.vec, types, depth + 1); if (i < MAX_ITEMS) out.push(v); } return n > MAX_ITEMS ? { items: out, total: n } : out; }
  if (type.option !== undefined || type.coption !== undefined) { const tag = type.option !== undefined ? r.u8('option') : r.u32('coption'); return tag ? borshDecode(r, type.option ?? type.coption, types, depth + 1) : null; }
  if (type.array) { const [inner, n] = type.array; const count = typeof n === 'number' ? n : NaN; if (!Number.isFinite(count)) throw new RPError('UNSUPPORTED', 'Generic array lengths are not supported.'); if (inner === 'u8') return r.bytes(count, 'array').toString('hex'); const out = []; for (let i = 0; i < count; i++) out.push(borshDecode(r, inner, types, depth + 1)); return out; }
  if (type.defined) { const n = typeof type.defined === 'string' ? type.defined : type.defined.name; const t = types.get(n); if (!t) throw new RPError('UNSUPPORTED', `IDL type ${n} is not defined.`); return borshDecode(r, t, types, depth + 1); }
  if (type.kind === 'struct') {
    const fields = type.fields ?? [];
    if (fields.length && typeof fields[0] === 'object' && fields[0] !== null && 'name' in fields[0]) return Object.fromEntries(fields.map(f => [f.name, borshDecode(r, f.type, types, depth + 1)]));
    return fields.map(f => borshDecode(r, f, types, depth + 1));
  }
  if (type.kind === 'enum') {
    const i = r.u8('enum variant'); const v = type.variants?.[i];
    if (!v) throw new RPError('MALFORMED', `Enum variant ${i} does not exist.`);
    if (!v.fields?.length) return v.name;
    return { [v.name]: borshDecode(r, { kind: 'struct', fields: v.fields }, types, depth + 1) };
  }
  if (type.kind === 'type' || type.alias) return borshDecode(r, type.alias ?? type.value, types, depth + 1);
  throw new RPError('UNSUPPORTED', `IDL type ${JSON.stringify(type).slice(0, 80)} is not supported.`);
}

function decodeWithIdl(idl, data, accts) {
  if (data.length < 8) return null;
  const ix = idl.instructions.find(i => i.discriminator.length && data.subarray(0, i.discriminator.length).equals(i.discriminator));
  if (!ix) return null;
  const accounts = Object.fromEntries(ix.accounts.map((a, i) => [a.name, accts[i]?.address ?? null]));
  let args = {}, argError = null;
  try { const r = new Reader(data, ix.discriminator.length); for (const a of ix.args) args[a.name] = borshDecode(r, a.type, idl.types); }
  catch (e) { argError = e.message; }
  return { name: ix.name, args, accounts, effects: [], ...(argError ? { argError } : {}) };
}

// ---------------------------------------------------------------------------------------------------- RPC
const redact = url => { try { const u = new URL(url); return `${u.protocol}//${u.host}${u.pathname === '/' ? '' : '/…'}`; } catch { return 'custom RPC'; } };
export function rpcEndpoint({ rpc, cluster } = {}) {
  if (rpc) { try { const u = new URL(rpc); if (!/^https?:$/.test(u.protocol)) throw new Error(); } catch { throw new RPError('INVALID_ARGUMENT', 'rpc must be an http(s) URL.'); } return rpc; }
  const c = cluster ?? 'mainnet';
  if (c === 'mainnet' && process.env.REVERSEPORT_SOLANA_RPC) return process.env.REVERSEPORT_SOLANA_RPC;
  if (!CLUSTERS[c]) throw new RPError('INVALID_ARGUMENT', `cluster must be one of ${Object.keys(CLUSTERS).join(', ')}.`);
  return CLUSTERS[c];
}

export async function rpc(url, method, params, { timeout = 25000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try { res = await globalThis.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ctrl.signal }); }
  catch (e) { throw new RPError('NETWORK', `${redact(url)} ${method}: ${e.name === 'AbortError' ? 'timed out' : (e.cause?.code ?? e.message)}`); }
  finally { clearTimeout(timer); }
  if (res.status === 429) throw new RPError('RATE_LIMITED', `${redact(url)} is rate-limiting (HTTP 429). Pass rpc with your own endpoint (Helius, Triton, QuickNode…) or set REVERSEPORT_SOLANA_RPC.`);
  let body;
  try { body = JSON.parse(await res.text()); } catch { throw new RPError('SOURCE_ERROR', `${redact(url)} ${method}: HTTP ${res.status}, not JSON.`); }
  if (body.error) throw new RPError('SOURCE_ERROR', `${redact(url)} ${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}

async function getAccount(url, address) {
  const res = await rpc(url, 'getAccountInfo', [address, { encoding: 'base64', commitment: 'confirmed' }]);
  const v = res?.value;
  if (!v) return null;
  return { address, owner: v.owner, lamports: BigInt(v.lamports), executable: !!v.executable, data: Buffer.from(v.data?.[0] ?? '', 'base64') };
}

async function getAccounts(url, addresses) {
  const out = new Map();
  for (let i = 0; i < addresses.length; i += 100) {
    const chunk = addresses.slice(i, i + 100);
    const res = await rpc(url, 'getMultipleAccounts', [chunk, { encoding: 'base64', commitment: 'confirmed' }]);
    (res?.value ?? []).forEach((v, j) => out.set(chunk[j], v ? { address: chunk[j], owner: v.owner, lamports: BigInt(v.lamports), executable: !!v.executable, data: Buffer.from(v.data?.[0] ?? '', 'base64') } : null));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- IDL cache
async function idlCacheFile(programId) { return path.join(await workspaceDir('solana', 'idl'), `${programId}.json`); }
async function cachedIdl(programId) { const f = await idlCacheFile(programId); return { file: f, idl: await readJson(f, null) }; }

/** Read the Anchor IDL a program published on-chain (null when there is none). */
export async function fetchAnchorIdl(url, programId) {
  const address = b58encode(anchorIdlAddress(pubkey(programId)));
  const acc = await getAccount(url, address);
  if (!acc || acc.owner !== programId || acc.data.length < 44) return { address, idl: null };
  const r = new Reader(acc.data, 8);
  const authority = r.key();
  const len = r.u32('IDL length');
  let json;
  try { json = JSON.parse(zlib.inflateSync(r.bytes(len, 'IDL data')).toString('utf8')); }
  catch (e) { return { address, authority, idl: null, error: `IDL account exists but could not be read: ${e.message}` }; }
  return { address, authority, idl: json };
}

// ---------------------------------------------------------------------------------------------------- program analysis
const SECURITY_BEGIN = Buffer.from('=======BEGIN SECURITY.TXT V1=======\0');
const SECURITY_END = Buffer.from('=======END SECURITY.TXT V1=======\0');

export function parseSecurityTxt(buf) {
  const start = buf.indexOf(SECURITY_BEGIN);
  if (start < 0) return null;
  const end = buf.indexOf(SECURITY_END, start);
  if (end < 0) return null;
  const parts = buf.subarray(start + SECURITY_BEGIN.length, end).toString('utf8').split('\0');
  const out = {};
  for (let i = 0; i + 1 < parts.length; i += 2) if (parts[i]) out[parts[i]] = parts[i + 1];
  return out;
}

function asciiStrings(buf, min = 4, cap = 200000) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= buf.length && out.length < cap; i++) {
    const b = i < buf.length ? buf[i] : 0;
    if (b >= 0x20 && b < 0x7f) { if (start < 0) start = i; }
    else { if (start >= 0 && i - start >= min) out.push(buf.toString('latin1', start, i)); start = -1; }
  }
  return out;
}

const SYSCALL_CAPS = [
  [/sol_invoke_signed/, 'calls other programs (CPI)'], [/sol_(?:try_find|create)_program_address/, 'derives program addresses (PDAs)'],
  [/sol_get_clock_sysvar/, 'reads the clock'], [/sol_secp256k1_recover/, 'recovers secp256k1 (Ethereum-style) signatures'],
  [/sol_curve_|sol_alt_bn128|sol_poseidon|sol_big_mod_exp/, 'does on-chain cryptography (curves, zk, big numbers)'],
  [/sol_set_return_data|sol_get_return_data/, 'returns data to callers'], [/sol_log_data/, 'emits events (sol_log_data)'],
  [/sol_get_stack_height|sol_get_processed_sibling_instruction/, 'inspects how it was called (stack height / sibling instructions)'],
];
const IMPORTANT_CRATES = /^(anchor-lang|anchor-spl|solana-program|solana-sdk|pinocchio|steel|spl-token|spl-token-2022|spl-associated-token-account|mpl-token-metadata|borsh|bytemuck|switchboard[a-z0-9-]*|pyth[a-z0-9-]*|light[a-z0-9-]*)$/;

/** What a deployed program's ELF reveals: framework, crate versions, instruction names, capabilities, references. */
export function analyzeProgramElf(elf) {
  const warnings = [];
  const isElf = elf.length >= 64 && elf.readUInt32BE(0) === 0x7f454c46;
  if (!isElf) return { elf: false, warnings: ['program data is not an ELF file'] };
  let info = null;
  try { info = parseELF(elf); } catch (e) { warnings.push(`ELF headers could not be read: ${e.message}`); }
  const machine = elf.readUInt16LE(18);
  const sbpf = machine === 247 || machine === 263;
  if (!sbpf) warnings.push(`ELF machine ${machine} is not BPF/SBF`);
  const flags = elf.readUInt32LE(48);
  const strings = asciiStrings(elf);
  const all = strings.join('\n');
  const crates = new Map();
  for (const m of all.matchAll(/(?:^|[/\\])([a-z][a-z0-9_-]{1,40})-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)[/\\]src[/\\]/gm)) {
    if (!crates.has(m[1])) crates.set(m[1], new Set());
    crates.get(m[1]).add(m[2]);
  }
  const crateList = [...crates].map(([n, v]) => ({ name: n, versions: [...v].sort() }));
  const keyCrates = crateList.filter(c => IMPORTANT_CRATES.test(c.name));
  const instructions = [...new Set(strings.map(s => s.match(/^Instruction: ([A-Za-z][A-Za-z0-9_]{0,63})$/)?.[1]).filter(Boolean))];
  const anchor = crates.has('anchor-lang') || /AnchorError|anchor[-_]lang/.test(all);
  const framework = anchor ? 'Anchor' : crates.has('pinocchio') || /pinocchio/.test(all) ? 'Pinocchio' : crates.has('steel') ? 'Steel' : /solana[-_]program/.test(all) ? 'native (solana-program)' : 'unknown';
  const sourceFiles = [...new Set(strings.filter(s => /^(?:programs\/[\w.-]+\/)?src\/[\w/.-]+\.rs$/.test(s)))].slice(0, 80);
  const syscallNames = [...new Set([...(info?.imports?.[0]?.functions ?? []), ...strings.filter(s => /^sol_[a-z0-9_]+$/.test(s))])];
  const capabilities = SYSCALL_CAPS.filter(([re]) => syscallNames.some(s => re.test(s))).map(([, t]) => t);
  const references = [];
  for (const [addr, nm] of KNOWN_PROGRAMS) if (!addr.startsWith('Sysvar') && elf.indexOf(b58decode(addr)) >= 0) references.push({ address: addr, name: nm });
  for (const [addr, m] of Object.entries(MINTS)) if (elf.indexOf(b58decode(addr)) >= 0) references.push({ address: addr, name: `${m.symbol} mint` });
  let end = elf.length;
  while (end > 0 && elf[end - 1] === 0) end--;
  return {
    elf: true, sbpf, sbpfVersion: sbpf ? (flags & 0xff) || 'v0/v1' : null, size: elf.length,
    executableHash: crypto.createHash('sha256').update(elf.subarray(0, end)).digest('hex'),
    stripped: info?.stripped ?? null, functionSymbols: info?.functionSymbols ?? null,
    sections: (info?.sections ?? []).filter(s => s.name).map(s => ({ name: s.name, size: s.size })),
    framework, crates: keyCrates, otherCrates: crateList.length - keyCrates.length,
    instructions, sourceFiles, capabilities, syscalls: syscallNames.slice(0, 60), references,
    securityTxt: parseSecurityTxt(elf), warnings,
  };
}

/** Layout of the account behind a program id, per loader. */
function programLayout(acc) {
  if (acc.owner === 'BPFLoaderUpgradeab1e11111111111111111111111') {
    if (acc.data.length < 36 || acc.data.readUInt32LE(0) !== 2) return { loader: 'upgradeable', error: 'program account is not in the Program state' };
    return { loader: 'upgradeable', programData: b58encode(acc.data.subarray(4, 36)) };
  }
  if (acc.owner === 'BPFLoader2111111111111111111111111111111111' || acc.owner === 'BPFLoader1111111111111111111111111111111111') return { loader: acc.owner.startsWith('BPFLoader2') ? 'v2' : 'v1', elf: acc.data, upgradeable: false };
  if (acc.owner === 'LoaderV411111111111111111111111111111111111') {
    if (acc.data.length < 48) return { loader: 'v4', error: 'program account too short' };
    const status = Number(acc.data.readBigUInt64LE(40));
    const authority = b58encode(acc.data.subarray(8, 40));
    return { loader: 'v4', slot: Number(acc.data.readBigUInt64LE(0)), status: ['retracted', 'deployed', 'finalized'][status] ?? `status ${status}`, upgradeable: status !== 2, authority: status === 2 ? null : authority, nextVersion: status === 2 ? authority : null, elf: acc.data.subarray(48) };
  }
  if (acc.owner === 'NativeLoader1111111111111111111111111111111') return { loader: 'native', builtin: true };
  return { loader: 'unknown', error: `owned by ${acc.owner}, not a known loader` };
}

function parseProgramData(data) {
  if (data.length < 45 || data.readUInt32LE(0) !== 3) return { error: 'program data account is not in the ProgramData state' };
  const slot = Number(data.readBigUInt64LE(4));
  const has = data[12] === 1;
  return { slot, authority: has ? b58encode(data.subarray(13, 45)) : null, elf: data.subarray(45) };
}

function authorityFinding(authority) {
  if (!authority) return { severity: 'ok', text: 'Immutable: nobody can change this program\'s code any more.' };
  const onCurve = isOnCurve(b58decode(authority));
  return onCurve
    ? { severity: 'caution', text: `Upgradeable by one wallet key (${authority}): whoever holds that key can replace the code at any time, including code that moves funds held by the program.` }
    : { severity: 'info', text: `Upgradeable by ${authority}, a program-derived address — usually a multisig (e.g. Squads) or a DAO. Check which program owns it and how many signers it needs.` };
}

async function programTool(args) {
  const { address, file } = args;
  const result = { action: 'program' };
  const findings = [];
  let elf;
  const url = address ? rpcEndpoint(args) : null;
  if (file) {
    const { abs } = await requireFile(file, 'program file');
    let buf = await fs.readFile(abs);
    if (buf.length < 64) throw new RPError('MALFORMED', 'File is too small to be a program.');
    if (buf.readUInt32BE(0) !== 0x7f454c46 && buf.length > 49 && buf.readUInt32LE(0) === 3 && buf.readUInt32BE(45) === 0x7f454c46) { const pd = parseProgramData(buf); result.programData = { lastDeploySlot: pd.slot, upgradeAuthority: pd.authority }; findings.push(authorityFinding(pd.authority)); buf = pd.elf; }
    elf = buf;
    result.file = abs;
  }
  if (address) {
    const pk = pubkey(address, 'address');
    result.address = b58encode(pk);
    result.network = redact(url);
    const acc = await getAccount(url, result.address);
    if (!acc) throw new RPError('NOT_FOUND', `No account at ${result.address} on ${redact(url)}. Wrong cluster? Pass cluster:"devnet" or another rpc.`);
    if (!acc.executable) return { ...result, executable: false, owner: acc.owner, next: 'This address is not a program. For what it is: re_solana {action:"account", address}.', nextCall: { tool: 're_solana', args: { action: 'account', address: result.address } } };
    if (KNOWN_PROGRAMS.has(result.address)) result.knownAs = KNOWN_PROGRAMS.get(result.address);
    const layout = programLayout(acc);
    result.loader = layout.loader;
    if (layout.error) findings.push({ severity: 'caution', text: layout.error });
    if (layout.builtin) { result.builtin = true; findings.push({ severity: 'ok', text: 'Built into the validator (native program); its code ships with Solana itself.' }); }
    if (layout.loader === 'upgradeable' && layout.programData) {
      const pdAcc = await getAccount(url, layout.programData);
      if (!pdAcc) findings.push({ severity: 'danger', text: `Program data account ${layout.programData} is gone: the program was closed and cannot run.` });
      else {
        const pd = parseProgramData(pdAcc.data);
        if (pd.error) findings.push({ severity: 'caution', text: pd.error });
        else {
          result.programData = { address: layout.programData, lastDeploySlot: pd.slot, upgradeAuthority: pd.authority };
          findings.push(authorityFinding(pd.authority));
          if (pd.authority) {
            const authAcc = await getAccount(url, pd.authority).catch(() => null);
            if (authAcc && authAcc.owner !== '11111111111111111111111111111111') result.programData.authorityOwner = { address: authAcc.owner, name: label(authAcc.owner) ?? null };
          }
          if (!elf) elf = pd.elf;
          const slot = await rpc(url, 'getSlot', [{ commitment: 'confirmed' }]).catch(() => null);
          if (typeof slot === 'number') {
            const days = Math.max(0, (slot - pd.slot) * 0.4 / 86400);
            result.programData.lastDeployApprox = days < 1 ? 'less than a day ago' : `about ${Math.round(days)} days ago`;
            if (days < 7) findings.push({ severity: 'caution', text: `Code was deployed or changed ${result.programData.lastDeployApprox} (slot ${pd.slot}). New code has had little time to be tested in the wild.` });
          }
        }
      }
    } else if (layout.elf) {
      if (!elf) elf = layout.elf;
      if (layout.loader === 'v4') { result.programData = { lastDeploySlot: layout.slot, status: layout.status, upgradeAuthority: layout.authority }; findings.push(authorityFinding(layout.authority)); }
      else findings.push(authorityFinding(null));
    }
    if (!layout.builtin) {
      try {
        const { address: idlAddress, authority, idl, error } = await fetchAnchorIdl(url, result.address);
        if (error) findings.push({ severity: 'info', text: error });
        if (idl) {
          const norm = normalizeIdl(idl);
          const { file: idlFile } = await cachedIdl(result.address);
          await writeJson(idlFile, idl);
          result.idl = { onChain: idlAddress, authority, name: norm.name, version: norm.version, instructions: norm.instructions.map(i => i.name), accounts: norm.accounts.map(a => a.name), errors: norm.errors.length, savedTo: idlFile };
        } else result.idl = { onChain: null, note: 'No Anchor IDL published on-chain. Pass idl:"path/to/idl.json" to decode its transactions if you have one.' };
      } catch (e) { result.idl = { error: e.message }; }
    }
  }
  if (!address && !file) throw new RPError('INVALID_ARGUMENT', 'Give address (a program id) or file (a .so, or a program data dump).');
  if (elf?.length) {
    const a = analyzeProgramElf(elf);
    result.code = a;
    if (a.elf) {
      if (!a.securityTxt) findings.push({ severity: 'info', text: 'No security.txt embedded: there is no published way to report bugs to the team.' });
      else result.contact = a.securityTxt;
      if (a.framework === 'Anchor' && a.instructions.length && !result.idl?.name) findings.push({ severity: 'info', text: `Instruction names recovered from the code (${a.instructions.length}); without an IDL their arguments stay undecoded.` });
      if (a.capabilities.includes('calls other programs (CPI)')) findings.push({ severity: 'info', text: `Calls other programs${a.references.length ? ` (references ${a.references.map(r => r.name).join(', ')})` : ''}.` });
    }
  }
  result.findings = findings;
  result.verdict = verdictOf(findings);
  result.summary = programSummary(result);
  result.notes = ['Static facts from the deployed bytes and accounts. A clean result is not an audit: it does not prove the code is safe.'];
  return result;
}

function programSummary(r) {
  const bits = [];
  bits.push(r.knownAs ? `${r.knownAs}.` : r.idl?.name ? `${r.idl.name}${r.idl.version ? ' ' + r.idl.version : ''}.` : 'Unlabelled program.');
  if (r.code?.framework && r.code.framework !== 'unknown') bits.push(`Built with ${r.code.framework}${r.code.crates?.find(c => c.name === 'anchor-lang') ? ' ' + r.code.crates.find(c => c.name === 'anchor-lang').versions.join('/') : ''}.`);
  const top = r.findings?.find(f => f.severity === 'danger') ?? r.findings?.find(f => f.severity === 'caution') ?? r.findings?.[0];
  if (top) bits.push(top.text);
  return bits.join(' ');
}

// ---------------------------------------------------------------------------------------------------- accounts
const TOKEN_EXT = ['Uninitialized', 'TransferFeeConfig', 'TransferFeeAmount', 'MintCloseAuthority', 'ConfidentialTransferMint', 'ConfidentialTransferAccount', 'DefaultAccountState', 'ImmutableOwner', 'MemoTransfer', 'NonTransferable', 'InterestBearingConfig', 'CpiGuard', 'PermanentDelegate', 'NonTransferableAccount', 'TransferHook', 'TransferHookAccount', 'ConfidentialTransferFeeConfig', 'ConfidentialTransferFeeAmount', 'MetadataPointer', 'TokenMetadata', 'GroupPointer', 'TokenGroup', 'GroupMemberPointer', 'TokenGroupMember'];
const optKey = b => (b.every(x => x === 0) ? null : b58encode(b));

function tokenExtensions(data, findings) {
  const out = [];
  if (data.length <= 166) return out;
  let o = 166;
  while (o + 4 <= data.length) {
    const type = data.readUInt16LE(o), len = data.readUInt16LE(o + 2);
    if (type === 0 && len === 0) break;
    const v = data.subarray(o + 4, o + 4 + len);
    const nm = TOKEN_EXT[type] ?? `Extension ${type}`;
    const ext = { type: nm };
    try {
      if (nm === 'TransferFeeConfig' && v.length >= 108) { ext.feeBasisPoints = v.readUInt16LE(106); ext.maximumFee = String(v.readBigUInt64LE(98)); ext.feeAuthority = optKey(v.subarray(0, 32));
        if (ext.feeBasisPoints) findings.push({ severity: 'caution', text: `Every transfer pays a fee of ${ext.feeBasisPoints / 100}% to the issuer${ext.feeAuthority ? ', and the fee authority can change it' : ''}.` }); }
      else if (nm === 'PermanentDelegate' && v.length >= 32) { ext.delegate = optKey(v.subarray(0, 32)); if (ext.delegate) findings.push({ severity: 'danger', text: `Permanent delegate ${ext.delegate} can move or burn this token out of ANY holder's account at any time.` }); }
      else if (nm === 'TransferHook' && v.length >= 64) { ext.authority = optKey(v.subarray(0, 32)); ext.program = optKey(v.subarray(32, 64)); if (ext.program) findings.push({ severity: 'caution', text: `Every transfer runs program ${ext.program} (transfer hook); that program can block or change transfers${ext.authority ? ', and the hook can be swapped by its authority' : ''}.` }); }
      else if (nm === 'DefaultAccountState' && v.length >= 1) { ext.state = ['uninitialized', 'initialized', 'frozen'][v[0]] ?? v[0]; if (v[0] === 2) findings.push({ severity: 'caution', text: 'New holder accounts start frozen: the issuer decides who may transfer.' }); }
      else if (nm === 'NonTransferable') findings.push({ severity: 'info', text: 'Non-transferable (soulbound) token.' });
      else if (nm === 'MintCloseAuthority' && v.length >= 32) ext.closeAuthority = optKey(v.subarray(0, 32));
      else if (nm === 'MetadataPointer' && v.length >= 64) { ext.authority = optKey(v.subarray(0, 32)); ext.metadata = optKey(v.subarray(32, 64)); }
      else if (nm === 'TokenMetadata' && v.length >= 64) { const r = new Reader(v, 64); ext.updateAuthority = optKey(v.subarray(0, 32)); ext.name = r.bytes(r.u32(), 'name').toString('utf8'); ext.symbol = r.bytes(r.u32(), 'symbol').toString('utf8'); ext.uri = r.bytes(r.u32(), 'uri').toString('utf8'); }
    } catch { ext.note = 'could not decode'; }
    out.push(ext);
    o += 4 + len;
  }
  return out;
}

function describeAccount(acc, idl) {
  const findings = [];
  const out = { address: acc.address, owner: { address: acc.owner, name: label(acc.owner) ?? null }, lamports: String(acc.lamports), balance: sol(acc.lamports), dataLength: acc.data.length, executable: acc.executable, isPda: !isOnCurve(b58decode(acc.address)) };
  if (acc.executable) { out.kind = 'program'; return { out, findings, next: { tool: 're_solana', args: { action: 'program', address: acc.address } } }; }
  if (acc.owner === '11111111111111111111111111111111' && acc.data.length === 0) {
    out.kind = out.isPda ? 'program-derived address holding SOL' : 'wallet';
    return { out, findings };
  }
  if (isTokenProgram(acc.owner)) {
    const d = acc.data;
    const accountType = d.length > 165 ? d[165] : null;
    if (d.length === 82 || accountType === 1) {
      out.kind = 'token mint';
      const mintAuthority = d.readUInt32LE(0) ? b58encode(d.subarray(4, 36)) : null;
      const freezeAuthority = d.readUInt32LE(46) ? b58encode(d.subarray(50, 82)) : null;
      out.mint = { supply: String(d.readBigUInt64LE(36)), decimals: d[44], initialized: d[45] === 1, mintAuthority, freezeAuthority, supplyFormatted: formatUnits(d.readBigUInt64LE(36), d[44]) };
      if (MINTS[acc.address]) out.mint.knownAs = MINTS[acc.address].symbol;
      findings.push(mintAuthority ? { severity: 'caution', text: `Mint authority ${mintAuthority} can create more of this token at any time (supply is not fixed).` } : { severity: 'ok', text: 'Fixed supply: the mint authority is removed.' });
      if (freezeAuthority) findings.push({ severity: 'caution', text: `Freeze authority ${freezeAuthority} can freeze any holder's tokens so they cannot be moved or sold.` });
      if (accountType === 1) out.extensions = tokenExtensions(d, findings);
      return { out, findings };
    }
    if (d.length >= 165) {
      out.kind = 'token account';
      const mint = b58encode(d.subarray(0, 32)), owner = b58encode(d.subarray(32, 64));
      const delegate = d.readUInt32LE(72) ? b58encode(d.subarray(76, 108)) : null;
      const closeAuthority = d.readUInt32LE(129) ? b58encode(d.subarray(133, 165)) : null;
      out.token = { mint, mintName: MINTS[mint]?.symbol ?? null, owner, amount: String(d.readBigUInt64LE(64)), state: ['uninitialized', 'initialized', 'frozen'][d[108]] ?? d[108], delegate, delegatedAmount: delegate ? String(d.readBigUInt64LE(121)) : null, closeAuthority, isAta: b58encode(associatedTokenAddress(b58decode(owner), b58decode(mint), b58decode(acc.owner))) === acc.address };
      if (MINTS[mint]) out.token.amountFormatted = `${formatUnits(out.token.amount, MINTS[mint].decimals)} ${MINTS[mint].symbol}`;
      if (delegate) findings.push({ severity: 'caution', text: `${delegate} is approved to spend ${out.token.delegatedAmount === String(U64_MAX) ? 'all' : out.token.delegatedAmount + ' base units of'} these tokens. Revoke it if you do not use that app any more.` });
      if (closeAuthority && closeAuthority !== owner) findings.push({ severity: 'caution', text: `${closeAuthority} (not the owner) may close this account once empty.` });
      if (out.token.state === 'frozen') findings.push({ severity: 'caution', text: 'This token account is frozen: its tokens cannot move until the issuer thaws it.' });
      if (accountType === 2) out.extensions = tokenExtensions(d, findings);
      return { out, findings };
    }
  }
  if (acc.owner === 'BPFLoaderUpgradeab1e11111111111111111111111' && acc.data.length >= 4) {
    const tag = acc.data.readUInt32LE(0);
    out.kind = ['uninitialized loader account', 'program upload buffer', 'program', 'program data'][tag] ?? 'loader account';
    if (tag === 3) { const pd = parseProgramData(acc.data); out.programData = { lastDeploySlot: pd.slot, upgradeAuthority: pd.authority }; }
    if (tag === 1 && acc.data.length >= 37) out.bufferAuthority = acc.data[4] ? b58encode(acc.data.subarray(5, 37)) : null;
    return { out, findings };
  }
  if (acc.owner === 'AddressLookupTab1e1111111111111111111111111') {
    out.kind = 'address lookup table';
    out.lookupTable = { authority: acc.data.length >= 54 && acc.data[21] ? b58encode(acc.data.subarray(22, 54)) : null, addresses: lookupAddresses(acc.data).length };
    return { out, findings };
  }
  out.kind = `data account of ${label(acc.owner) ?? 'program ' + acc.owner}`;
  if (acc.data.length >= 8) {
    out.discriminator = acc.data.subarray(0, 8).toString('hex');
    if (idl) {
      const t = idl.accounts.find(a => acc.data.subarray(0, a.discriminator.length).equals(a.discriminator));
      if (t) {
        out.anchorType = t.name;
        if (t.type) { try { out.decoded = borshDecode(new Reader(acc.data, t.discriminator.length), t.type, idl.types); } catch (e) { out.decodeError = e.message; } }
      }
    }
  }
  return { out, findings };
}

async function accountTool(args) {
  const url = rpcEndpoint(args);
  const address = b58encode(pubkey(args.address, 'address'));
  const acc = await getAccount(url, address);
  if (!acc) {
    const onCurve = isOnCurve(b58decode(address));
    return { action: 'account', address, network: redact(url), exists: false, kind: onCurve ? 'empty wallet address (no SOL, never used or fully emptied)' : 'program-derived address with no account yet', findings: [], verdict: 'ok', summary: `Nothing is stored at ${address} on ${redact(url)}.` };
  }
  let idl = null;
  if (!acc.executable && !KNOWN_PROGRAMS.has(acc.owner)) idl = await loadIdl(url, acc.owner, args.idl, args.fresh).catch(() => null);
  const { out, findings, next } = describeAccount(acc, idl?.norm);
  const result = { action: 'account', network: redact(url), ...out, findings, verdict: verdictOf(findings) };
  result.summary = `${address} is a ${out.kind}${out.token ? ` holding ${out.token.amountFormatted ?? out.token.amount + ' base units'} of ${out.token.mintName ?? out.token.mint}` : ''}${out.mint ? ` (supply ${out.mint.supplyFormatted})` : ''}${out.anchorType ? ` (${out.anchorType})` : ''}. ${findings.find(f => f.severity === 'danger')?.text ?? findings.find(f => f.severity === 'caution')?.text ?? ''}`.trim();
  if (next) { result.next = 'This is a program: inspect it with re_solana {action:"program"}.'; result.nextCall = next; }
  return result;
}

// ---------------------------------------------------------------------------------------------------- address (offline)
function addressTool({ address, seeds, programId }) {
  if (programId && seeds) {
    const pid = pubkey(programId, 'programId');
    const parts = seeds.map(s => (/^0x[0-9a-f]*$/i.test(s) ? Buffer.from(s.slice(2), 'hex') : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) && b58decode(s).length === 32 ? b58decode(s) : Buffer.from(s, 'utf8')));
    const { address: pda, bump } = findProgramAddress(parts, pid);
    return { action: 'address', derived: b58encode(pda), bump, programId: b58encode(pid), seeds: seeds.map((s, i) => ({ input: s, bytes: parts[i].toString('hex') })), note: 'Seeds: "0x…" is hex, a 32-byte base58 value is an address, anything else is UTF-8 text.' };
  }
  const bytes = pubkey(address, 'address');
  const text = b58encode(bytes);
  const onCurve = isOnCurve(bytes);
  const out = { action: 'address', address: text, onCurve, kind: onCurve ? 'a keypair address (a wallet or other account someone holds the private key for)' : 'a program-derived address (no private key: only its program can sign for it)' };
  if (KNOWN_PROGRAMS.has(text)) { out.knownAs = KNOWN_PROGRAMS.get(text); out.kind = `the address of ${out.knownAs}`; }
  if (MINTS[text]) out.knownAs = `${MINTS[text].symbol} mint`;
  out.anchorIdlAddress = b58encode(anchorIdlAddress(bytes));
  return out;
}

// ---------------------------------------------------------------------------------------------------- tx
async function loadIdl(url, programId, idlFile, fresh) {
  if (idlFile) {
    const { abs } = await requireFile(idlFile, 'IDL file');
    let idl;
    try { idl = JSON.parse(await fs.readFile(abs, 'utf8')); } catch (e) { throw new RPError('INVALID_ARGUMENT', `IDL file is not JSON: ${e.message}`); }
    const norm = normalizeIdl(idl);
    // A 0.30+ IDL names its program; skip it for other programs. Older IDLs apply to every undecoded program.
    if (!norm.address || norm.address === programId) return { source: 'file', norm };
  }
  const cached = await cachedIdl(programId);
  if (cached.idl && !fresh) return { source: 'cache', norm: normalizeIdl(cached.idl) };
  if (!url) return null;
  const { idl } = await fetchAnchorIdl(url, programId);
  if (!idl) return null;
  await writeJson(cached.file, idl);
  return { source: 'on-chain', norm: normalizeIdl(idl) };
}

function readTxInput(text) {
  const t = String(text).trim();
  if (/^[1-9A-HJ-NP-Za-km-z]{86,88}$/.test(t)) { const b = b58decode(t); if (b.length === 64) return { signature: t }; }
  if (/^[A-Za-z0-9+/=\s]+$/.test(t) && !/^[1-9A-HJ-NP-Za-km-z]+$/.test(t.replace(/=+$/, ''))) return { bytes: Buffer.from(t, 'base64') };
  if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(t)) {
    // base58 and base64 overlap; try base58 first, fall back to base64.
    try { const b = b58decode(t); parseTransaction(b); return { bytes: b }; } catch { /* try base64 */ }
    return { bytes: Buffer.from(t, 'base64') };
  }
  throw new RPError('INVALID_ARGUMENT', 'transaction must be a base64 or base58 serialized transaction (or message), or a transaction signature.');
}

async function txTool(args) {
  const offline = !!args.offline;
  const url = offline ? null : rpcEndpoint(args);
  const warnings = [];
  const input = readTxInput(args.transaction);
  let parsed, meta = null, landed = null;
  if (input.signature) {
    if (offline) throw new RPError('INVALID_ARGUMENT', 'A signature needs the network; remove offline or pass the serialized transaction.');
    const res = await rpc(url, 'getTransaction', [input.signature, { encoding: 'base64', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
    if (!res) throw new RPError('NOT_FOUND', `Transaction ${input.signature} not found on ${redact(url)} (wrong cluster, or too old for this RPC).`);
    parsed = parseTransaction(Buffer.from(res.transaction[0], 'base64'));
    meta = res.meta;
    landed = { slot: res.slot, blockTime: res.blockTime ? new Date(res.blockTime * 1000).toISOString() : null, status: meta?.err ? 'failed' : 'succeeded', error: meta?.err ?? null, fee: meta ? sol(BigInt(meta.fee)) : null };
  } else parsed = parseTransaction(input.bytes);
  const { message } = parsed;
  let loaded = meta?.loadedAddresses ?? null;
  if (!loaded && message.lookups.length) {
    if (offline) warnings.push('Some accounts come from address lookup tables and stay unresolved offline.');
    else {
      try {
        const tables = await getAccounts(url, message.lookups.map(l => l.table));
        loaded = { writable: [], readonly: [] };
        for (const kind of ['writable', 'readonly']) for (const l of message.lookups) { const acc = tables.get(l.table); const addrs = acc ? lookupAddresses(acc.data) : []; for (const i of l[kind]) loaded[kind].push(addrs[i] ?? null); }
      } catch (e) { warnings.push(`Lookup tables could not be read: ${e.message}`); }
    }
  }
  const accounts = accountList(message, loaded);
  const feePayer = accounts[0]?.address;
  const wallet = args.wallet ? b58encode(pubkey(args.wallet, 'wallet')) : feePayer;
  const signers = accounts.filter(a => a.signer).map(a => a.address);
  // The wallet's own token accounts: the ATAs it owns as seen in the transaction, plus any token account the tx says it owns.
  const ownedTokenAccounts = new Set();
  const ctx = {
    durableNonce: null, cuLimit: null, cuPrice: null, flows: [],
    mine: a => !!a && (a === wallet || ownedTokenAccounts.has(a)),
    flow(kind, from, to, amount, decimals, mint) { this.flows.push({ kind, from, to, amount: BigInt(amount), decimals, mint }); },
  };
  // First pass: learn which token accounts belong to the wallet (instructions where the wallet signs as owner).
  for (const ix of message.instructions) {
    const prog = accounts[ix.programIndex]?.address;
    if (!isTokenProgram(prog)) continue;
    const tag = ix.data[0];
    const a = ix.accounts.map(i => accounts[i]?.address);
    const ownerIdx = { 3: 2, 4: 2, 5: 1, 6: 1, 8: 2, 9: 2, 12: 3, 13: 3, 15: 2 }[tag];
    if (ownerIdx !== undefined && a[ownerIdx] === wallet) ownedTokenAccounts.add(a[0]);
    const mint = { 12: a[1], 13: a[1], 15: a[1], 8: a[1] }[tag];
    if (mint && wallet) ownedTokenAccounts.add(b58encode(associatedTokenAddress(b58decode(wallet), b58decode(mint), b58decode(prog))));
  }
  for (const ix of message.instructions) {
    if (accounts[ix.programIndex]?.address !== 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL') continue;
    const a = ix.accounts.map(i => accounts[i]?.address);
    if (a[2] === wallet && a[1]) ownedTokenAccounts.add(a[1]);
  }
  const idls = new Map();
  const instructions = [];
  for (const [n, ix] of message.instructions.entries()) {
    const program = accounts[ix.programIndex]?.address ?? null;
    const accts = ix.accounts.map(i => accounts[i] ?? { address: null });
    const entry = { index: n, program, programName: label(program) ?? null };
    let decoded = null;
    try {
      if (BUILTIN_DECODERS[program]) decoded = BUILTIN_DECODERS[program](ix.data, accts, ctx);
      else if (program) {
        if (!idls.has(program)) idls.set(program, await loadIdl(url, program, args.idl, args.fresh).catch(e => { warnings.push(`IDL for ${program}: ${e.message}`); return null; }));
        const idl = idls.get(program);
        if (idl) { decoded = decodeWithIdl(idl.norm, ix.data, accts); if (decoded) { entry.decodedWith = `Anchor IDL (${idl.source})`; if (idl.norm.name) entry.programName ??= idl.norm.name; } }
      }
    } catch (e) { entry.error = e.message; }
    if (decoded) Object.assign(entry, decoded);
    else {
      const writableMine = accts.filter(a => a.writable && ctx.mine(a.address)).map(a => a.address);
      entry.name = entry.name ?? 'unknown';
      entry.data = ix.data.length > 64 ? ix.data.subarray(0, 64).toString('hex') + '…' : ix.data.toString('hex');
      entry.accounts = accts.map(a => ({ address: a.address, writable: a.writable, signer: a.signer }));
      entry.effects = [{ severity: writableMine.length ? 'caution' : 'info', text: `Calls ${name(program)} (${accts.length} accounts${writableMine.length ? `, can change your accounts ${writableMine.join(', ')}` : ''}); its instruction could not be decoded${idls.get(program) ? ' with its IDL' : ' (no IDL found)'}.` }];
    }
    instructions.push(entry);
  }
  const findings = instructions.flatMap(i => (i.effects ?? []).map(e => ({ ...e, instruction: i.index })));
  if (ctx.durableNonce && message.instructions.length && accounts[message.instructions[0].programIndex]?.address !== '11111111111111111111111111111111') findings.push({ severity: 'caution', text: 'The durable nonce instruction is not the first one, so the network will reject this transaction.' });
  const unknownPrograms = [...new Set(instructions.filter(i => i.name === 'unknown' && i.program).map(i => i.program))];
  // Net movement as written in the instructions (simulation or a landed transaction gives the real numbers).
  const net = new Map();
  for (const f of ctx.flows) {
    for (const [acct, sign] of [[f.from, -1n], [f.to, 1n]]) {
      if (!ctx.mine(acct)) continue;
      const key = f.kind === 'SOL' ? 'SOL' : f.mint ?? `token account ${acct}`;
      const cur = net.get(key) ?? { amount: 0n, decimals: f.decimals, mint: f.mint };
      cur.amount += sign * f.amount;
      net.set(key, cur);
    }
  }
  const fee = { signatures: message.header.requiredSignatures, baseLamports: String(5000n * BigInt(message.header.requiredSignatures)) };
  if (ctx.cuPrice !== null) { const units = BigInt(ctx.cuLimit ?? 200000 * message.instructions.filter(ix => accounts[ix.programIndex]?.address !== 'ComputeBudget111111111111111111111111111111').length); fee.priorityLamports = String((units * ctx.cuPrice + 999_999n) / 1_000_000n); fee.computeUnitLimit = ctx.cuLimit; }
  const totalFee = BigInt(fee.baseLamports) + BigInt(fee.priorityLamports ?? 0);
  fee.total = sol(totalFee);
  if (totalFee > 50_000_000n) findings.push({ severity: 'caution', text: `Fee is ${sol(totalFee)} — unusually high.` });
  const result = {
    action: 'tx', network: url ? redact(url) : 'offline', version: message.version, wallet, feePayer, signers,
    signed: parsed.signatures.length ? parsed.signatures.map((s, i) => ({ signer: accounts[i]?.address, signed: !!s })) : 'message only (no signatures)',
    ...(landed ? { landed } : {}), recentBlockhash: message.recentBlockhash, fee,
    instructions, intendedChanges: [...net].map(([k, v]) => ({ asset: k === 'SOL' ? 'SOL' : MINTS[v.mint]?.symbol ?? k, change: v.decimals !== undefined && v.decimals !== null ? formatUnits(v.amount, v.decimals) : `${v.amount} base units`, raw: String(v.amount) })),
    unknownPrograms, findings, warnings,
  };
  if (wallet !== feePayer) result.note = `Fee is paid by ${feePayer}, not by ${wallet}.`;
  if (meta) result.actualChanges = landedChanges(accounts, meta, wallet);
  if (args.simulate && !landed && !offline) {
    try { result.simulation = await simulate(url, parsed, accounts, wallet, findings); }
    catch (e) { warnings.push(`Simulation failed: ${e.message}`); }
  } else if (!landed && !args.simulate) result.next = 'For the real balance changes before signing: run again with simulate:true (sends the unsigned transaction to the RPC for a dry run; nothing is submitted).';
  result.verdict = verdictOf(findings);
  result.summary = txSummary(result);
  return result;
}

function landedChanges(accounts, meta, wallet) {
  const out = [];
  accounts.forEach((a, i) => { const pre = meta.preBalances?.[i], post = meta.postBalances?.[i]; if (pre !== undefined && post !== undefined && pre !== post) out.push({ account: a.address, asset: 'SOL', change: formatUnits(BigInt(post) - BigInt(pre), 9), mine: a.address === wallet }); });
  const tok = new Map();
  for (const [list, sign] of [[meta.preTokenBalances ?? [], -1n], [meta.postTokenBalances ?? [], 1n]]) for (const t of list) {
    const k = `${t.accountIndex}:${t.mint}`;
    const cur = tok.get(k) ?? { account: accounts[t.accountIndex]?.address, owner: t.owner, mint: t.mint, decimals: t.uiTokenAmount?.decimals, delta: 0n };
    cur.delta += sign * BigInt(t.uiTokenAmount?.amount ?? 0);
    tok.set(k, cur);
  }
  for (const t of tok.values()) if (t.delta) out.push({ account: t.account, owner: t.owner, asset: MINTS[t.mint]?.symbol ?? t.mint, change: formatUnits(t.delta, t.decimals), mine: t.owner === wallet });
  return out;
}

async function simulate(url, parsed, accounts, wallet, findings) {
  const watch = [...new Set(accounts.filter(a => a.writable && a.address && !KNOWN_PROGRAMS.has(a.address)).map(a => a.address))].slice(0, 25);
  const before = await getAccounts(url, watch);
  const n = Math.max(1, parsed.message.header.requiredSignatures);
  const wire = Buffer.concat([Buffer.from([n]), Buffer.alloc(64 * n), parsed.messageBytes]);
  const res = await rpc(url, 'simulateTransaction', [wire.toString('base64'), { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: watch } }]);
  const v = res?.value ?? {};
  const changes = [];
  (v.accounts ?? []).forEach((post, i) => {
    const address = watch[i], pre = before.get(address);
    const preL = pre?.lamports ?? 0n, postL = post ? BigInt(post.lamports) : 0n;
    if (preL !== postL) changes.push({ account: address, asset: 'SOL', change: formatUnits(postL - preL, 9), mine: address === wallet });
    const postData = post ? Buffer.from(post.data?.[0] ?? '', 'base64') : Buffer.alloc(0);
    if (pre && post && pre.owner !== post.owner) {
      findings.push({ severity: address === wallet || pre.owner === '11111111111111111111111111111111' ? 'danger' : 'caution', text: `Simulation: ${address} changes owner from ${name(pre.owner)} to ${name(post.owner)}.` });
    }
    const tokenOwner = isTokenProgram(post?.owner ?? pre?.owner);
    if (tokenOwner && postData.length >= 165) {
      const preData = pre?.data ?? Buffer.alloc(0);
      const mint = b58encode(postData.subarray(0, 32)), owner = b58encode(postData.subarray(32, 64));
      const preAmt = preData.length >= 165 ? preData.readBigUInt64LE(64) : 0n, postAmt = postData.readBigUInt64LE(64);
      if (preAmt !== postAmt) changes.push({ account: address, owner, asset: MINTS[mint]?.symbol ?? mint, change: MINTS[mint] ? formatUnits(postAmt - preAmt, MINTS[mint].decimals) : `${postAmt - preAmt} base units`, mine: owner === wallet });
      if (preData.length >= 165) {
        const preOwner = b58encode(preData.subarray(32, 64));
        if (preOwner !== owner) findings.push({ severity: 'danger', text: `Simulation: token account ${address} gets a new owner, ${owner}.` });
        const preDel = preData.readUInt32LE(72) ? b58encode(preData.subarray(76, 108)) : null, postDel = postData.readUInt32LE(72) ? b58encode(postData.subarray(76, 108)) : null;
        if (postDel && postDel !== preDel) findings.push({ severity: 'danger', text: `Simulation: ${postDel} becomes approved to spend from token account ${address}.` });
      }
    }
  });
  if (v.err) findings.push({ severity: 'caution', text: `Simulation: the transaction would fail (${JSON.stringify(v.err)}).` });
  const logs = v.logs ?? [];
  return { error: v.err ?? null, unitsConsumed: v.unitsConsumed ?? null, changes, logs: logs.length > 40 ? [...logs.slice(0, 40), `… ${logs.length - 40} more lines`] : logs, watched: watch.length };
}

function txSummary(r) {
  const lines = [];
  const mine = (r.simulation?.changes ?? r.actualChanges ?? []).filter(c => c.mine);
  if (mine.length) lines.push(`Your balance changes: ${mine.map(c => `${c.change} ${c.asset}`).join(', ')}.`);
  else if (r.intendedChanges.length) lines.push(`As written, your balances change by: ${r.intendedChanges.map(c => `${c.change} ${c.asset}`).join(', ')}.`);
  const top = r.findings.filter(f => f.severity === 'danger').concat(r.findings.filter(f => f.severity === 'caution'));
  for (const f of top.slice(0, 3)) lines.push(f.text);
  if (r.unknownPrograms.length) lines.push(`${r.unknownPrograms.length} program(s) could not be decoded: ${r.unknownPrograms.join(', ')}.`);
  const verdictText = { danger: 'DANGER: do not sign unless you meant exactly this.', caution: 'Caution: read the points above before signing.', ok: 'Nothing unusual found in what could be decoded.' }[r.verdict];
  return [verdictText, ...lines].join(' ');
}

function verdictOf(findings) {
  if (findings.some(f => f.severity === 'danger')) return 'danger';
  if (findings.some(f => f.severity === 'caution')) return 'caution';
  return 'ok';
}

// ---------------------------------------------------------------------------------------------------- entry point
export async function solanaTool(input = {}) {
  // CLI: `sol tx <transaction>` arrives as the second positional (address).
  const args = input.action === 'tx' && !input.transaction && input.address ? { ...input, transaction: input.address, address: undefined } : input;
  const action = args.action ?? (args.transaction ? 'tx' : args.file ? 'program' : null);
  switch (action) {
    case 'program': return programTool(args);
    case 'account': if (!args.address) throw new RPError('INVALID_ARGUMENT', 'Missing address.'); return accountTool(args);
    case 'tx': if (!args.transaction) throw new RPError('INVALID_ARGUMENT', 'Missing transaction (base64/base58 transaction or a signature).'); return txTool(args);
    case 'address': if (!args.address && !(args.seeds && args.programId)) throw new RPError('INVALID_ARGUMENT', 'Give address, or seeds with programId to derive a PDA.'); return addressTool(args);
    default: throw new RPError('INVALID_ARGUMENT', `Missing action. One of: ${ACTIONS.join(', ')}.`);
  }
}
