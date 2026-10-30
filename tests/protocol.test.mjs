import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { DapTransport, RuntimeProtocol, parseVariable, BlitzMaxDebugAdapter } from '../tools/blitzmax-dap.mjs';

test('DAP framing accepts fragmented headers, coalesced messages and UTF-8 byte lengths', () => {
  const input = new PassThrough(); const output = new PassThrough();
  const transport = new DapTransport(input, output);
  const messages = []; transport.on('message', message => messages.push(message));
  const bodies = [{ type: 'request', command: 'evaluate', arguments: { expression: 'café 🎮' } }, { type: 'request', command: 'threads' }];
  const buffer = Buffer.concat(bodies.map(body => { const bytes = Buffer.from(JSON.stringify(body)); return Buffer.concat([Buffer.from(`Content-Length: ${bytes.length}\r\n\r\n`), bytes]); }));
  for (let i = 0; i < buffer.length; i += 3) transport.feed(buffer.subarray(i, i + 3));
  assert.deepEqual(messages, bodies);
  assert.throws(() => transport.feed(Buffer.from('Content-Length: x\r\n\r\n{}')), /Content-Length/);
});

test('runtime events survive arbitrary chunks, CRLF, Unicode and ordinary stderr', () => {
  const parser = new RuntimeProtocol(); const events = []; const output = [];
  parser.on('event', event => events.push(event)); parser.on('output', line => output.push(line));
  const bytes = Buffer.from('normal café\r\n~>DebugStop{\r\n~>\r\n~>Dump{\n~>Field text:String="été"\n~>\nlast');
  for (const byte of bytes) parser.feed(Buffer.from([byte]));
  parser.finish();
  assert.deepEqual(events, [{ name: 'DebugStop', data: [] }, { name: 'Dump', data: ['Field text:String="été"'] }]);
  assert.deepEqual(output, ['normal café\n', 'last\n']);
});

test('variable values keep equals signs and type names', () => {
  assert.deepEqual(parseVariable('Local message:String="x=y=z"'), { name: 'message', type: 'String', value: '"x=y=z"', variablesReference: 0 });
  assert.equal(parseVariable('Field object:TNode=$F00').name, 'object');
});

test('debug adapter reports unsupported operations honestly', async () => {
  const transport = new PassThrough(); transport.event = () => {};
  const adapter = new BlitzMaxDebugAdapter(transport);
  await assert.rejects(() => adapter.request({ command: 'pause' }), /cannot pause/);
  await assert.rejects(() => adapter.request({ command: 'attach' }), /Unsupported/);
  await assert.rejects(() => adapter.launch({ program: '' }), /program/);
  await assert.rejects(() => adapter.launch({ program: 'app', args: [1] }), /args/);
  await assert.rejects(() => adapter.launch({ program: 'app', stopOnEntry: true }), /stopOnEntry/);
  const caps = await adapter.request({ command: 'initialize' });
  assert.equal(caps.supportsConditionalBreakpoints, false);
  assert.equal(caps.supportsStepBack, false);
});
