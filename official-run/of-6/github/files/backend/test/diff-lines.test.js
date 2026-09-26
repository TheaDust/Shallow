'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { splitLines, diffLines, diffContent } = require('../src/diff');

test('splitLines drops a single trailing newline and handles empty content', () => {
  assert.deepEqual(splitLines('a\nb\n'), ['a', 'b']);
  assert.deepEqual(splitLines('a\nb'), ['a', 'b']);
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines(null), []);
  assert.deepEqual(splitLines(undefined), []);
});

test('diffLines returns context lines for identical content and zero counts', () => {
  const result = diffLines(['a', 'b'], ['a', 'b']);
  assert.deepEqual(result.lines, [
    { type: 'context', text: 'a' },
    { type: 'context', text: 'b' },
  ]);
  assert.equal(result.additions, 0);
  assert.equal(result.deletions, 0);
});

test('diffLines counts pure additions and deletions exactly', () => {
  const added = diffLines([], ['x', 'y']);
  assert.equal(added.additions, 2);
  assert.equal(added.deletions, 0);
  assert.deepEqual(added.lines, [
    { type: 'add', text: 'x' },
    { type: 'add', text: 'y' },
  ]);

  const removed = diffLines(['x', 'y'], []);
  assert.equal(removed.additions, 0);
  assert.equal(removed.deletions, 2);
  assert.deepEqual(removed.lines, [
    { type: 'del', text: 'x' },
    { type: 'del', text: 'y' },
  ]);
});

test('diffLines interleaves added and deleted lines inside a changed region', () => {
  const result = diffLines(['a', 'old', 'z'], ['a', 'new', 'z']);
  assert.equal(result.additions, 1);
  assert.equal(result.deletions, 1);
  assert.deepEqual(result.lines, [
    { type: 'context', text: 'a' },
    { type: 'del', text: 'old' },
    { type: 'add', text: 'new' },
    { type: 'context', text: 'z' },
  ]);
});

test('diffLines matches the longest common subsequence deterministically', () => {
  // a=[a b c d], b=[a c d b]: the LCS is a,c,d, so b is emitted as a
  // deletion right after a and re-added at the end.
  const result = diffLines(['a', 'b', 'c', 'd'], ['a', 'c', 'd', 'b']);
  assert.equal(result.additions, 1);
  assert.equal(result.deletions, 1);
  const types = result.lines.map((l) => l.type);
  assert.deepEqual(types, ['context', 'del', 'context', 'context', 'add']);
  assert.equal(result.lines[0].text, 'a');
  assert.equal(result.lines[1].text, 'b');
  assert.equal(result.lines[4].text, 'b');
});

test('diffContent treats null sides as empty files', () => {
  const added = diffContent(null, 'one\ntwo\n');
  assert.equal(added.additions, 2);
  assert.equal(added.deletions, 0);
  const removed = diffContent('one\ntwo\n', null);
  assert.equal(removed.additions, 0);
  assert.equal(removed.deletions, 2);
});
