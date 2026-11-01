// Fixes for CodeQL findings in ReversePort's own code: no regular expression that can hang on hostile input, one-pass
// unescaping, and no internal error details in HTTP answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePo } from '../src/strings.mjs';
import { stripHtml } from '../src/lookup.mjs';
import { constantName } from '../src/binary.mjs';
import { extractSymbols } from '../src/symbols.mjs';

test('.po: continued strings, one-pass escapes, header and plural entries left out', () => {
  const po = [
    'msgid ""', 'msgstr "Content-Type: text/plain\\n"', '',
    '#: main.gd:3', 'msgid "Hello"', 'msgstr "Hallo"', '',
    'msgid ""', '"Two "', '"lines"', 'msgstr ""', '"Twee "', '"regels"', '',
    'msgid "A \\\\n is not a newline"', 'msgstr "Een \\\\n is geen nieuwe regel"', '',
    'msgid "Say \\"hi\\""', 'msgstr "Zeg \\"hoi\\""', '',
    'msgid "Coin"', 'msgid_plural "Coins"', 'msgstr[0] "Munt"', 'msgstr[1] "Munten"', '',
    'msgid "Untranslated"', 'msgstr ""',
  ].join('\r\n');
  assert.deepEqual(new Map(parsePo(po)), new Map([
    ['Hello', 'Hallo'],
    ['Two lines', 'Twee regels'],
    ['A \\n is not a newline', 'Een \\n is geen nieuwe regel'],
    ['Say "hi"', 'Zeg "hoi"'],
  ]));
});

test('HTML to text: tags and stray brackets out, entities decoded once', () => {
  assert.equal(stripHtml('<p>Tom &amp; Jerry</p><scr<b>ipt>x'), 'Tom & Jerry\niptx', 'a broken tag never glues back into "<script"');
  assert.equal(stripHtml('5 &amp;lt; 6'), '5 &lt; 6', '"&amp;lt;" is the text "&lt;", not "<"');
  assert.equal(stripHtml('a&nbsp;b&#39;s &quot;c&quot; &lt;d&gt;'), 'a b\'s "c" <d>');
});

test('constant-style names are recognised in linear time', () => {
  for (const t of ['GL_TEXTURE_2D', 'SDL_INIT.Video', 'ABC.def', 'GODOT_VERSION']) assert.equal(constantName(t), true, t);
  for (const t of ['ABC', 'AB_C', 'ABC_', 'abc_DEF', 'ABC..x', 'ABC.']) assert.equal(constantName(t), false, t);
  const start = Date.now();
  constantName(`AAA${'_'.repeat(5000)}!`);
  assert.ok(Date.now() - start < 50, 'a long underscore run does not backtrack');
});

test('C++ function scan stays fast on a line of type-like tokens with no function', () => {
  const hostile = `${'a* '.repeat(3000)}x`;
  const start = Date.now();
  extractSymbols(hostile, 'cpp');
  assert.ok(Date.now() - start < 2000, `took ${Date.now() - start} ms`);
  const found = extractSymbols('const std::string& Player::name() const {\n  return n;\n}\nvoid* make(int a, int b) {\n}\n', 'cpp');
  assert.ok(JSON.stringify(found).includes('name') && JSON.stringify(found).includes('make'));
});

test('HTTP: an unexpected error answers 500 with a plain message, never the stack or internal paths', async () => {
  const { createServer } = await import('../server.mjs');
  const boom = Object.assign(new Error('secret at /home/someone/internal.mjs'), { stack: 'Error: secret\n    at /home/someone/internal.mjs:1:1' });
  const relay = { ensureStarted: async () => {}, listTools: () => { throw boom; }, view: () => ({}), info: () => ({}) };
  const server = createServer({ relay });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const errors = [];
  const write = process.stderr.write;
  process.stderr.write = chunk => { errors.push(String(chunk)); return true; };
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/agent/tools`);
    const text = await res.text();
    assert.equal(res.status, 500);
    assert.doesNotMatch(text, /secret|internal\.mjs/);
    assert.match(JSON.parse(text).error.message, /server log/);
    assert.match(errors.join(''), /internal\.mjs/, 'the details go to the log');
  } finally { process.stderr.write = write; server.close(); }
});
