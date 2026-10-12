#!/usr/bin/env node
// ReversePort MCP server on stdio (JSON-RPC 2.0, one message per line): ReversePort's tools plus the deep-analysis
// engine's, through one connection. See src/relay.mjs for what is listed and how the engine is relayed.
import { StringDecoder } from 'node:string_decoder';
import { createRelay } from './src/relay.mjs';

const MAX_LINE = 32 * 1024 * 1024;
const write = msg => process.stdout.write(`${JSON.stringify(msg)}\n`);
const waiting = new Map(); // our requests to the client → resolver
let nextId = 1;

const relay = createRelay({
  notify: msg => write({ jsonrpc: '2.0', ...msg }),
  request: msg => new Promise(resolve => {
    const id = `rp-${nextId++}`;
    waiting.set(id, resolve);
    write({ jsonrpc: '2.0', id, ...msg });
  }),
});

const inFlight = new Set();
function dispatch(line) {
  const p = dispatchOne(line);
  if (p && typeof p.then === 'function') { inFlight.add(p); p.finally(() => inFlight.delete(p)); }
  return p;
}

function dispatchOne(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: each line must be one JSON-RPC message.' } }); }
  if (msg && msg.method === undefined && msg.id !== undefined && waiting.has(msg.id)) { // client answering our request
    const resolve = waiting.get(msg.id);
    waiting.delete(msg.id);
    return resolve(msg.error ? { error: msg.error } : { result: msg.result });
  }
  return relay.handle(msg).then(res => { if (res) write(res); }, e => { process.stderr.write(`reverseport: ${e.stack ?? e.message}\n`); if (msg?.id !== undefined) write({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } }); });
}

// initialize starts the engine; everything that arrives meanwhile waits for it, then requests run concurrently.
let gate = null;
const decoder = new StringDecoder('utf8');
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += decoder.write(chunk);
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    const isInit = /"method"\s*:\s*"initialize"/.test(line);
    if (isInit && !gate) gate = dispatch(line);
    else if (gate) gate.then(() => dispatch(line));
    else dispatch(line);
  }
  if (buffer.length > MAX_LINE) { write({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large (over 32 MiB).' } }); buffer = ''; }
});
process.stdin.on('end', async () => {
  if (buffer.trim()) await (gate ?? Promise.resolve()).then(() => dispatch(buffer.trim()));
  await gate;
  await Promise.allSettled([...inFlight]); // let running calls finish before the engine is closed
  relay.close();
});
