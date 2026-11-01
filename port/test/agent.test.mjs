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
  const text = JSON.stringify(p);
  for (const bad of ['$ref', '$defs', 'anyOf', 'const', 'dependentRequired', 'minProperties', 'format', 'pattern']) assert.equal(text.includes(bad), false, bad);
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

test('null means "not given" unless the schema allows null', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' }, b: { type: ['string', 'null'] }, n: { type: 'object', properties: { x: { type: 'integer' } } } } };
  assert.deepEqual(dropDisallowedNulls(schema, { a: null, b: null, n: { x: null }, keep: 1 }), { b: null, n: {}, keep: 1 });
});
