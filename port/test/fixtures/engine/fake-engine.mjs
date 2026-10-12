// A stand-in deep-analysis engine for the relay tests: a tiny MCP server on stdio.
import { createInterface } from 'node:readline';

const send = m => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
const waiting = new Map();
let nextId = 1;
const tools = [
  { name: 'decompile', description: 'fake', inputSchema: { type: 'object', properties: { address: { type: 'string' } } } },
  { name: 'slow', description: 'fake', inputSchema: { type: 'object' } },
  { name: 'ask_roots', description: 'fake', inputSchema: { type: 'object' } },
  { name: 're_scan', description: 'shadowed', inputSchema: { type: 'object' } },
  { name: 'crash', description: 'fake: exits the engine', inputSchema: { type: 'object' } },
];
createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  if (m.method === undefined) { const w = waiting.get(m.id); waiting.delete(m.id); if (w) w(m); return; }
  if (m.method === 'initialize') return send({ id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: { listChanged: true }, prompts: {} }, serverInfo: { name: 'engine', version: '0' }, instructions: 'ENGINE ROUTING' } });
  if (m.method === 'notifications/initialized') return;
  if (m.method === 'notifications/cancelled') return send({ method: 'notifications/message', params: { level: 'info', data: `cancelled ${m.params.requestId}` } });
  if (m.method === 'tools/list') return m.params?.cursor ? send({ id: m.id, result: { tools: tools.slice(2) } }) : send({ id: m.id, result: { tools: tools.slice(0, 2), nextCursor: 'p2' } });
  if (m.method === 'prompts/list') return send({ id: m.id, result: { prompts: [{ name: 'investigate' }] } });
  if (m.method === 'tools/call') {
    const { name, arguments: args, _meta } = m.params;
    if (name === 'decompile') {
      if (_meta?.progressToken !== undefined) send({ method: 'notifications/progress', params: { progressToken: _meta.progressToken, progress: 1 } });
      return send({ id: m.id, result: { content: [{ type: 'text', text: `code at ${args.address}` }], isError: false } });
    }
    if (name === 'slow') return; // answered never; the client cancels it
    if (name === 'ask_roots') {
      const id = nextId++;
      waiting.set(id, r => send({ id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(r.result) }], isError: false } }));
      return send({ id, method: 'roots/list' });
    }
    if (name === 'crash') process.exit(3);
    return send({ id: m.id, error: { code: -32602, message: `no tool ${name}` } });
  }
  if (m.id !== undefined) send({ id: m.id, error: { code: -32601, message: 'nope' } });
});
