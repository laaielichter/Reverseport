// Agent-facing helpers: error shape, suggestions, formats for every vendor, portable schemas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { errorPayload, closest, formatTools, portableSchema } from '../src/agent.mjs';
import { dropDisallowedNulls } from '../src/relay.mjs';
import { RPError } from '../src/util.mjs';
import { coerceArgs } from '../src/tools.mjs';

test('errors: one shape with a next step, Node errors mapped', () => {
  const e = errorPayload(new RPError('NOT_FOUND', 'x not found'));
  assert.deepEqual(Object.keys(e), ['code', 'category', 'retryable', 'message', 'remediation']);
  assert.ok(e.remediation.action.length > 10);
  assert.equal(errorPayload(Object.assign(new Error('denied'), { code: 'EACCES' })).code, 'ACCESS_DENIED');
  assert.equal(errorPayload(new Error('boom')).code, 'TOOL_FAILED');
  assert.equal(errorPayload(new Error('boom')).retryable, true);
});

test('suggestions', () => {
  assert.equal(closest('scna', ['scan', 'graph']), 'scan');
  assert.equal(closest('zzzzzz', ['scan', 'graph']), null);
});

test('portable schemas: refs, unions, const, dropped keywords; strict when possible', () => {
  const schema = { type: 'object', $defs: { A: { type: 'string' } }, properties: { a: { $ref: '#/$defs/A' }, b: { anyOf: [{ type: 'integer' }, { type: 'null' }] }, c: { const: 'x' }, d: { type: 'string', format: 'uri', pattern: '^h' } }, required: ['a'], dependentRequired: { b: ['a'] }, minProperties: 1 };
  const p = portableSchema(schema);
  const keys = new Set();
  const walk = v => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
  walk(p);
  for (const bad of ['$ref', '$defs', 'anyOf', 'const', 'dependentRequired', 'minProperties', 'format', 'pattern']) assert.equal(keys.has(bad), false, bad);
  assert.match(p.properties.d.description, /format: uri/, 'what helps the model moves into the description');
  assert.deepEqual(p.properties.b.type, ['integer', 'null']);
  const [strict] = formatTools([{ name: 't', description: 'd', inputSchema: schema }], 'openai-strict');
  assert.equal(strict.function.strict, true);
  assert.deepEqual([...strict.function.parameters.required].sort(), ['a', 'b', 'c', 'd']);
  const [gemini] = formatTools([{ name: 't', description: 'd', inputSchema: schema }], 'gemini');
  assert.equal(JSON.stringify(gemini).includes('additionalProperties'), false);
  const freeSchema = { type: 'object', properties: { args: { type: 'object', description: 'Tool arguments.' } } };
  const free = formatTools([{ name: 'f', description: 'd', inputSchema: freeSchema }], 'openai-strict')[0];
  assert.equal(free.function.strict, true, 'a free-form object becomes a JSON string, so the tool stays strict');
  assert.deepEqual(free.function.parameters.properties.args.type, ['string', 'null']);
  assert.match(free.function.parameters.properties.args.description, /JSON object as a string/);
  assert.deepEqual(coerceArgs(freeSchema, { args: '{"path":"/game"}' }), { args: { path: '/game' } }, 'the string is read back as the object');
});

test('unions keep every option: shared fields keep all their values, a list beats a single value, shapes are named', () => {
  const target = { type: 'object', properties: {
    target: { oneOf: [
      { type: 'object', properties: { kind: { const: 'file' }, path: { type: 'string', minLength: 1 } }, required: ['kind', 'path'] },
      { type: 'object', properties: { kind: { const: 'pid' }, pid: { type: 'integer', exclusiveMinimum: 0 } }, required: ['kind', 'pid'] },
    ] },
    names: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, uniqueItems: true }] },
    position: { type: 'array', prefixItems: [{ type: 'number' }, { type: 'number' }, { type: 'number' }] },
    loose: { description: 'Any value.' },
    step: { type: 'number', multipleOf: 0.5 },
  }, required: ['target'] };
  const p = portableSchema(target);
  assert.deepEqual(p.properties.target.properties.kind.enum, ['file', 'pid'], 'both kinds stay choosable');
  assert.deepEqual(p.properties.target.required, ['kind']);
  assert.match(p.properties.target.description, /kind "file": path; kind "pid": pid/);
  assert.equal(p.properties.names.type, 'array', 'a list can also carry one name');
  assert.match(p.properties.names.description, /also accepts a string/);
  assert.deepEqual([p.properties.position.items.type, p.properties.position.minItems, p.properties.position.maxItems], ['number', 3, 3]);

  const tools = [{ name: 't', description: 'd', inputSchema: target }];
  const keysOf = v => { const out = new Set(); const walk = x => { if (x && typeof x === 'object') for (const [k, y] of Object.entries(x)) { out.add(k); walk(k === 'properties' ? Object.values(y) : y); } }; walk(v); return out; };
  const [strict] = formatTools([{ ...tools[0], inputSchema: { ...target, properties: { ...target.properties, loose: { type: 'string' } } } }], 'openai-strict');
  assert.equal(strict.function.strict, true);
  for (const k of ['minLength', 'exclusiveMinimum', 'uniqueItems', 'multipleOf', 'minItems', 'maxItems', 'prefixItems']) assert.equal(keysOf(strict.function.parameters).has(k), false, `strict: ${k}`);
  assert.match(strict.function.parameters.properties.step.description, /multipleOf 0.5/, 'limits survive as words');
  const gemini = formatTools(tools, 'gemini')[0].functionDeclarations[0].parameters;
  for (const k of ['exclusiveMinimum', 'uniqueItems', 'multipleOf', 'prefixItems', 'additionalProperties']) assert.equal(keysOf(gemini).has(k), false, `gemini: ${k}`);
  assert.equal(gemini.properties.loose.type, 'string', 'Gemini needs a type on every property');
  assert.equal(gemini.properties.position.maxItems, 3, 'Gemini keeps list bounds');
});

test('function-calling formats keep descriptions within 1024 characters, cut at a sentence', () => {
  const long = `First sentence. ${'A longer sentence that keeps going. '.repeat(60)}`;
  for (const format of ['openai', 'openai-strict', 'responses']) {
    const [t] = formatTools([{ name: 'long', description: long, inputSchema: { type: 'object', properties: { a: { type: 'string' } } } }], format);
    const d = (t.function ?? t).description;
    assert.ok(d.length <= 1024 && d.endsWith('.'), format);
  }
  assert.equal(formatTools([{ name: 'long', description: long, inputSchema: { type: 'object' } }], 'mcp')[0].description, long, 'MCP keeps the full text');
});

test('null means "not given" unless the schema allows null', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' }, b: { type: ['string', 'null'] }, n: { type: 'object', properties: { x: { type: 'integer' } } } } };
  assert.deepEqual(dropDisallowedNulls(schema, { a: null, b: null, n: { x: null }, keep: 1 }), { b: null, n: {}, keep: 1 });
});
