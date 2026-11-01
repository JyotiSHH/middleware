import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireAdminKey } from '../src/auth.js';
import { cfg } from './helpers.js';

const expect = (fn, code, status) => {
  assert.throws(fn, (err) => {
    assert.equal(err.code, code);
    assert.equal(err.status, status);
    return true;
  });
};

test('accepts the configured key', () => {
  assert.equal(requireAdminKey(cfg, 'admin-key'), undefined);
});

test('rejects a wrong, missing or prefix key', () => {
  for (const provided of ['nope', '', 'admin-ke', 'admin-key-extra', undefined, null, 123]) {
    expect(() => requireAdminKey(cfg, provided), 'UNAUTHORIZED', 401);
  }
});

test('fails closed when ADMIN_API_KEY is unset', () => {
  expect(() => requireAdminKey({ ...cfg, adminApiKey: null }, 'anything'), 'CONFIG_ERROR', 500);
});

test('UNAUTHORIZED is not advertised as retryable', () => {
  assert.throws(
    () => requireAdminKey(cfg, 'nope'),
    (err) => err.toJSON().retryable === false,
  );
});
