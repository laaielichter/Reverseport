import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import { isInside, safeJoin, workspaceRoot } from '../src/workspace.mjs';

const root = path.resolve(os.tmpdir(), 'reverseport-workspace-test');
const home = path.join(root, 'home');

const unsafe = ['../x', 'a/../../x', 'a\\..\\..\\x', 'C:/Windows/x', 'c:x', 'bad\0name', 'res://../x', '', '.'];

test('safeJoin refuses paths that leave the root', () => {
  for (const rel of unsafe) {
    assert.throws(() => safeJoin(root, rel), error => error.code === 'UNSAFE_PATH', rel);
  }
});

test('safeJoin keeps normal paths inside the root', () => {
  const allowed = [
    ['a/b.txt', 'a/b.txt'],
    ['res://scenes/main.tscn', 'scenes/main.tscn'],
    ['/etc/passwd', 'etc/passwd'],
    ['..data/file.txt', '..data/file.txt'],
  ];
  for (const [rel, expected] of allowed) {
    assert.equal(safeJoin(root, rel), path.join(root, expected), rel);
  }
});

test('isInside compares path segments, not prefixes', () => {
  assert.equal(isInside(root, root), true);
  assert.equal(isInside(path.join(root, 'a', 'b'), root), true);
  assert.equal(isInside(path.join(root, '..data'), root), true);
  assert.equal(isInside(path.resolve(root, '..'), root), false);
  assert.equal(isInside(path.join(root, '..', 'sibling'), root), false);
  assert.equal(isInside(`${root}-other`, root), false);
});

test('workspaceRoot uses REVERSEPORT_HOME, and ignores one that is only spaces', () => {
  assert.equal(workspaceRoot({ REVERSEPORT_HOME: path.join(root, 'custom') }, home), path.resolve(root, 'custom'));
  assert.equal(workspaceRoot({ REVERSEPORT_HOME: '   ' }, home), path.resolve(home, '.reverseport'));
});
