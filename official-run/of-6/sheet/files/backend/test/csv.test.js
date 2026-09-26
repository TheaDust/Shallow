'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { parseCsv, cellCoordinate, INVALID_CSV_MESSAGE } = require('../csv');

test('parses rows and columns in original order', () => {
  assert.deepStrictEqual(parseCsv('a,b,c\nd,e,f'), [
    ['a', 'b', 'c'],
    ['d', 'e', 'f'],
  ]);
  assert.deepStrictEqual(parseCsv('single'), [['single']]);
});

test('preserves empty fields including leading, middle and trailing ones', () => {
  assert.deepStrictEqual(parseCsv('a,,c'), [['a', '', 'c']]);
  assert.deepStrictEqual(parseCsv('a,'), [['a', '']]);
  assert.deepStrictEqual(parseCsv(','), [['', '']]);
  assert.deepStrictEqual(parseCsv(',,'), [['', '', '']]);
});

test('supports UTF-8 Chinese, English and numeric text', () => {
  const rows = parseCsv('产品,价格\n苹果,3\n香蕉,5');
  assert.deepStrictEqual(rows, [
    ['产品', '价格'],
    ['苹果', '3'],
    ['香蕉', '5'],
  ]);
});

test('handles commas inside quoted fields', () => {
  assert.deepStrictEqual(parseCsv('a,"b,c",d'), [['a', 'b,c', 'd']]);
  assert.deepStrictEqual(parseCsv('"East,North",800'), [['East,North', '800']]);
});

test('handles escaped pairs of double quotes', () => {
  assert.deepStrictEqual(parseCsv('"he said ""hi"""'), [['he said "hi"']]);
  assert.deepStrictEqual(parseCsv('a,"x""y",b'), [['a', 'x"y', 'b']]);
});

test('handles line breaks within quoted fields', () => {
  assert.deepStrictEqual(parseCsv('a,"line1\nline2",b'), [['a', 'line1\nline2', 'b']]);
  assert.deepStrictEqual(parseCsv('"x\ry"'), [['x\ry']]);
  assert.deepStrictEqual(parseCsv('"x\r\ny"'), [['x\r\ny']]);
});

test('accepts CRLF and lone CR record separators outside quotes', () => {
  assert.deepStrictEqual(parseCsv('a,b\r\nc,d\r\n'), [
    ['a', 'b'],
    ['c', 'd'],
  ]);
  assert.deepStrictEqual(parseCsv('a\rb\r'), [['a'], ['b']]);
});

test('trailing newline does not create an extra empty row', () => {
  assert.deepStrictEqual(parseCsv('a,b\n'), [['a', 'b']]);
  assert.deepStrictEqual(parseCsv('a,b'), [['a', 'b']]);
});

test('rejects a quoted field that starts with a quote but has no closing quote', () => {
  assert.throws(() => parseCsv('"unclosed'), (err) => err.message === INVALID_CSV_MESSAGE);
  assert.throws(() => parseCsv('a,"unclosed\nb'), (err) => err.message === INVALID_CSV_MESSAGE);
  assert.throws(() => parseCsv('a,b,"never closed'), (err) => err.message === INVALID_CSV_MESSAGE);
});

test('empty input parses to no rows', () => {
  assert.deepStrictEqual(parseCsv(''), []);
});

test('cellCoordinate maps row and column to a cell name', () => {
  assert.strictEqual(cellCoordinate(0, 0), 'A1');
  assert.strictEqual(cellCoordinate(1, 1), 'B2');
  assert.strictEqual(cellCoordinate(0, 27), 'AB1');
  assert.strictEqual(cellCoordinate(9, 2), 'C10');
});
