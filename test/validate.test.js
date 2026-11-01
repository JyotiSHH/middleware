import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseOrderNumber } from '../src/validate.js';

test('accepts 1001 and #1001', () => {
  assert.equal(parseOrderNumber('1001'), '1001');
  assert.equal(parseOrderNumber('#1001'), '1001');
  assert.equal(parseOrderNumber('  #1001 '), '1001');
});

test('rejects everything else', () => {
  for (const bad of ['', ' ', '#', '##1001', '10O1', '1001a', '-1001', '1e3', '10 01', '12345678901', null, undefined, 1001]) {
    assert.equal(parseOrderNumber(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});
