import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServerMessage } from '../tools/blitzmax-lsp.mjs';

test('legacy language server responses regain original request ids and valid capabilities', () => {
  const pending = new Map([['7', { id: 7, method: 'initialize' }]]);
  const result = normalizeServerMessage({ jsonrpc: '2.0', id: '7', result: {
    capabilities: { completionProvider: { triggerCharacters: '.' } }, serverinfo: { name: 'BlitzMax' },
  } }, pending);
  assert.equal(result.id, 7);
  assert.equal(result.result.serverInfo.name, 'BlitzMax');
  assert.deepEqual(result.result.capabilities.completionProvider.triggerCharacters, ['.']);
  assert.equal(pending.size, 0);
  const config = normalizeServerMessage({ method: 'workspace/configuration', params: [{ section: 'blitzmax.base.path' }] }, new Map());
  assert.deepEqual(config.params, { items: [{ section: 'blitzmax.base.path' }] });
});

test('modern server messages and string ids keep their values', () => {
  const expected = { jsonrpc: '2.0', id: 'request-3', result: { capabilities: { completionProvider: { triggerCharacters: ['.'] } }, serverInfo: { name: 'bls' } } };
  const message = structuredClone(expected);
  assert.deepEqual(normalizeServerMessage(message, new Map([['request-3', { id: 'request-3', method: 'initialize' }]])), expected);
});
