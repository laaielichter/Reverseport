#!/usr/bin/env node
// ReversePort over HTTP (localhost only) for agents that do not speak MCP over stdio — every vendor and framework:
//   GET  /api/health
//   GET  /api/agent/tools?format=mcp|openai|openai-strict|responses|anthropic|gemini|json-schema
//   POST /api/agent/call                {name, arguments}
//   POST /api/agent/tools/{name}        {…arguments}
//   GET  /api/openapi.json              (GPT Actions, LangChain/LlamaIndex OpenAPI tools, n8n, Semantic Kernel)
//   POST /mcp                           MCP Streamable HTTP (JSON responses) for URL-based MCP clients: the legacy
//                                       initialize session and stateless MCP 2026-07-28 requests
// The same tools as `reverseport mcp`: ReversePort's own plus the deep-analysis engine's (when built).
// REVERSEPORT_TOKEN=… requires `Authorization: Bearer …`. Browser pages on localhost may call it (CORS).
// Reaching it from Docker or a tunnel: REVERSEPORT_HOST=0.0.0.0 plus REVERSEPORT_ALLOWED_HOSTS=host1,host2 — only
// together with REVERSEPORT_TOKEN; without a token it refuses to listen beyond this machine.
import http from 'node:http';
import crypto from 'node:crypto';
import { VERSION } from './src/tools.mjs';
import { workspaceRoot } from './src/workspace.mjs';
import { isMainModule } from './src/main-module.mjs';
import { createRelay, PROFILES } from './src/relay.mjs';
import { formatTools, FORMATS, errorPayload, portableSchema, fit } from './src/agent.mjs';
import { RPError } from './src/util.mjs';

export const DEFAULT_PORT = 32147;
const LOCAL_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;
const allowedHosts = () => new Set(['127.0.0.1', 'localhost', '[::1]', ...String(process.env.REVERSEPORT_ALLOWED_HOSTS ?? '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean)]);
const STATUS = { UNKNOWN_TOOL: 404, UNKNOWN_ENDPOINT: 404, ENGINE_UNAVAILABLE: 503, ENGINE_OFF: 503, ENGINE_STOPPED: 503, ENGINE_RESTART_LIMIT: 503, NETWORK: 503, SOURCE_ERROR: 502, TOOL_FAILED: 500, TOO_LARGE: 413, UNAUTHORIZED: 401, FORBIDDEN_HOST: 403, FORBIDDEN_ORIGIN: 403 };

/** Hosted agent builders (GPT Actions among them) take at most 300 characters per operation description. */
export const OPENAPI_DESCRIPTION_MAX = 300;
const MAX_SESSIONS = 200;

export function openapiFor(tools, port, { fullDescriptions = false } = {}) {
  const paths = {};
  for (const t of tools) {
    paths[`/api/agent/tools/${t.name}`] = { post: {
      operationId: t.name, summary: t.title ?? t.name, description: fullDescriptions ? t.description : fit(t.description, OPENAPI_DESCRIPTION_MAX),
      requestBody: { required: true, content: { 'application/json': { schema: portableSchema(t.inputSchema) } } },
      responses: {
        200: { description: 'Tool result (JSON).', content: { 'application/json': { schema: { type: 'object' } } } },
        400: { description: 'Error with a next step.', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, category: { type: 'string' }, retryable: { type: 'boolean' }, message: { type: 'string' }, remediation: { type: 'object', properties: { action: { type: 'string' } } } } } } } } } },
      },
    } };
  }
  const secured = !!process.env.REVERSEPORT_TOKEN;
  return { openapi: '3.1.0', info: { title: 'ReversePort', version: VERSION, description: 'Reverse engineer anything. Port it anywhere. Local tools for agents.' }, servers: [{ url: `http://127.0.0.1:${port}` }], paths,
    ...(secured ? { components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } }, security: [{ bearer: [] }] } : {}) };
}

/** MCP 2026-07-28 requests repeat their version and method in headers; when given, they must agree with the body. */
export function headerMismatch(headers, message) {
  const version = message?.params?._meta?.['io.modelcontextprotocol/protocolVersion'];
  if (version === undefined) return null;
  const sentVersion = headers['mcp-protocol-version'];
  if (sentVersion !== undefined && sentVersion !== version) return `MCP-Protocol-Version is ${sentVersion} but the body says ${version}.`;
  const sentMethod = headers['mcp-method'];
  if (sentMethod !== undefined && sentMethod !== message.method) return `Mcp-Method is ${sentMethod} but the body calls ${message.method}.`;
  return null;
}

const unwrap = result => {
  if (result?.structuredContent !== undefined) return result.structuredContent;
  const text = result?.content?.find(c => c.type === 'text')?.text;
  try { return JSON.parse(text); } catch { return { content: result?.content ?? [] }; }
};

export function createServer({ relay } = {}) {
  const shared = relay ?? createRelay();
  const ready = shared.ensureStarted();
  /** MCP session id → that client's view (profile, repeat guard). Other HTTP callers share nothing. */
  const sessions = new Map();
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const origin = req.headers.origin;
    const cors = origin && LOCAL_ORIGIN.test(origin) ? { 'access-control-allow-origin': origin, vary: 'origin', 'access-control-expose-headers': 'mcp-session-id' } : {};
    const json = (status, body, extra = {}) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors, ...extra }); res.end(JSON.stringify(body)); };
    const fail = (status, e) => json(status, { error: errorPayload(e) });
    const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
    if (!allowedHosts().has(host)) return fail(403, new RPError('FORBIDDEN_HOST', 'ReversePort only answers on localhost (or hosts listed in REVERSEPORT_ALLOWED_HOSTS).'));
    if (origin && !LOCAL_ORIGIN.test(origin)) return fail(403, new RPError('FORBIDDEN_ORIGIN', 'Only pages on localhost may call ReversePort.'));
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS', 'access-control-allow-headers': 'content-type, authorization, mcp-session-id, mcp-protocol-version, mcp-method, mcp-name', 'access-control-max-age': '600' }); return res.end(); }
    const token = process.env.REVERSEPORT_TOKEN;
    if (token && req.headers.authorization !== `Bearer ${token}`) return fail(401, new RPError('UNAUTHORIZED', 'Send Authorization: Bearer <REVERSEPORT_TOKEN>.'));
    const body = async () => {
      let text = '';
      for await (const chunk of req) { text += chunk; if (text.length > 32 * 1024 * 1024) throw new RPError('TOO_LARGE', 'Body over 32 MiB.'); }
      if (!text) return {};
      try { return JSON.parse(text); } catch { throw new RPError('INVALID_ARGUMENT', 'The body is not valid JSON.'); }
    };
    try {
      await ready;
      const profile = url.searchParams.get('profile');
      if (profile !== null && !PROFILES[profile]) throw new RPError('INVALID_ARGUMENT', `Unknown profile "${profile}". Profiles: ${Object.keys(PROFILES).join(', ')}.`);
      // Without a session nothing is remembered between requests: a fresh view each time, in the profile asked for.
      const oneOff = () => shared.view(profile ?? undefined, { stateless: true });
      if (req.method === 'GET' && url.pathname === '/api/health') return json(200, { ok: true, name: 'ReversePort', version: VERSION, ...shared.info(oneOff()), workspace: workspaceRoot() });
      if (req.method === 'GET' && url.pathname === '/api/agent/tools') {
        const format = url.searchParams.get('format') ?? 'mcp';
        if (!FORMATS.includes(format)) throw new RPError('INVALID_ARGUMENT', `Unknown format "${format}". Formats: ${FORMATS.join(', ')}.`);
        return json(200, formatTools(shared.listTools(oneOff()), format));
      }
      if (req.method === 'GET' && url.pathname === '/api/openapi.json') return json(200, openapiFor(shared.listTools(oneOff()), req.socket.localPort ?? DEFAULT_PORT, { fullDescriptions: url.searchParams.get('descriptions') === 'full' }));
      if (req.method === 'POST' && (url.pathname === '/api/agent/call' || url.pathname.startsWith('/api/agent/tools/'))) {
        const parsed = await body();
        const name = url.pathname === '/api/agent/call' ? parsed.name : decodeURIComponent(url.pathname.split('/').pop());
        const args = url.pathname === '/api/agent/call' ? parsed.arguments ?? {} : parsed;
        if (typeof name !== 'string' || !name) throw new RPError('INVALID_ARGUMENT', 'The body needs name (the tool) and arguments, e.g. {"name":"re_scan","arguments":{"path":"/game"}}. GET /api/agent/tools lists the tools.');
        const result = await shared.call(name, args, oneOff());
        const value = unwrap(result);
        if (!result?.isError) return json(200, value);
        return json(STATUS[value?.error?.code] ?? 400, value);
      }
      if (url.pathname === '/mcp') {
        if (req.method === 'GET') return json(405, { error: errorPayload(new RPError('INVALID_ARGUMENT', 'This server answers POST /mcp with JSON; it does not open an event stream.')) }, { allow: 'POST, DELETE' });
        const sent = req.headers['mcp-session-id'];
        if (req.method === 'DELETE') { const known = sessions.delete(sent); res.writeHead(known ? 204 : 404, cors); return res.end(); }
        if (req.method === 'POST') {
          let parsed;
          try { parsed = await body(); } catch (e) {
            if (e.code === 'INVALID_ARGUMENT') return json(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: the body is not valid JSON.' } });
            throw e;
          }
          const messages = Array.isArray(parsed) ? parsed : [parsed];
          const replies = [];
          let session = sent;
          // An ended or made-up session is not silently replaced: 404 tells the client to initialize again.
          if (sent !== undefined && !sessions.has(sent) && !messages.some(m => m?.method === 'initialize')) {
            return json(404, { jsonrpc: '2.0', id: messages[0]?.id ?? null, error: { code: -32001, message: 'Session not found: it ended or never existed. Send initialize again without Mcp-Session-Id.' } });
          }
          for (const m of messages) {
            const mismatch = headerMismatch(req.headers, m);
            if (mismatch) return json(400, { jsonrpc: '2.0', id: m?.id ?? null, error: { code: -32020, message: `Header mismatch: ${mismatch}` } });
            let view = session !== undefined ? sessions.get(session) : undefined;
            if (m?.method === 'initialize') view = shared.view(profile ?? undefined);
            const r = await shared.handle(m, view ?? oneOff());
            if (m?.method === 'initialize' && r?.result) {
              session = crypto.randomUUID();
              sessions.set(session, view);
              if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
            }
            if (r) replies.push(r);
          }
          const extra = session ? { 'mcp-session-id': session } : {};
          if (!replies.length) { res.writeHead(202, { ...cors, ...extra }); return res.end(); }
          return json(200, Array.isArray(parsed) ? replies : replies[0], extra);
        }
      }
      return fail(404, new RPError('UNKNOWN_ENDPOINT', `No ${req.method} ${url.pathname} here. Endpoints: GET /api/health, GET /api/agent/tools, POST /api/agent/call, POST /api/agent/tools/<name>, GET /api/openapi.json, POST /mcp.`));
    } catch (e) {
      return fail(STATUS[e.code] ?? 400, e);
    }
  });
}

let server;
export function start(port = Number(process.env.REVERSEPORT_PORT ?? DEFAULT_PORT)) {
  const host = process.env.REVERSEPORT_HOST ?? '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !process.env.REVERSEPORT_TOKEN) return Promise.reject(new RPError('UNAUTHORIZED', `Refusing to listen on ${host} without REVERSEPORT_TOKEN: set a token so only your agents can call it.`));
  server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

if (isMainModule(import.meta.url)) {
  const s = await start();
  console.log(`ReversePort ${VERSION} — http://127.0.0.1:${s.address().port}/api/agent/tools  ·  MCP: http://127.0.0.1:${s.address().port}/mcp`);
}
