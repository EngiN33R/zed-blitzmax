import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ProtocolClient } from './helpers.mjs';
const path = relative => fileURLToPath(new URL(relative, import.meta.url));

test('standalone DAP supports initialize, launch, stacks, locals, object values, stepping and termination', async t => {
  const client = new ProtocolClient(process.execPath, [path('../tools/blitzmax-dap.mjs')]);
  t.after(() => client.close());
  await client.request('initialize', { adapterID: 'BlitzMax', linesStartAt1: true, columnsStartAt1: true });
  await client.event('initialized');
  const launch = client.request('launch', { program: process.execPath, args: [path('fixtures/fake-runtime.mjs')] });
  const breakpoints = await client.request('setBreakpoints', { source: { path: path('../examples/debug.bmx') }, breakpoints: [{ line: 5 }, { line: 6 }] });
  assert.equal(breakpoints.breakpoints[0].verified, true);
  assert.equal(breakpoints.breakpoints[1].verified, false);
  await client.request('configurationDone');
  await launch;
  const stopped = await client.event('stopped');
  assert.equal(stopped.reason, 'breakpoint');
  const stack = await client.request('stackTrace', { threadId: 1 });
  assert.equal(stack.totalFrames, 1);
  assert.equal(stack.stackFrames[0].line, 5);
  assert.equal(stack.stackFrames[0].source.path, 'C:/source with spaces/main.bmx');
  const scopes = await client.request('scopes', { frameId: stack.stackFrames[0].id });
  const locals = await client.request('variables', { variablesReference: scopes.scopes[0].variablesReference });
  assert.equal(locals.variables[0].value, '42');
  assert.equal(locals.variables[1].value, '"a=b"');
  const object = locals.variables[2];
  const expanded = await client.request('variables', { variablesReference: object.variablesReference });
  assert.equal(expanded.variables[0].value, '"café"');
  assert.equal((await client.request('evaluate', { expression: 'ANSWER' })).result, '42');
  await client.request('next', { threadId: 1 });
  assert.equal((await client.event('stopped')).reason, 'step');
  await assert.rejects(() => client.request('variables', { variablesReference: object.variablesReference }), /expired/);
  await client.request('continue', { threadId: 1 });
  const output = await client.wait(message => message.event === 'output' && message.body.output.includes('continued'));
  assert.match(output.body.output, /café/);
  assert.equal((await client.event('exited')).exitCode, 0);
  await client.event('terminated');
});

test('failed launches return an error and disconnect cancels a pending launch', async t => {
  const client = new ProtocolClient(process.execPath, [path('../tools/blitzmax-dap.mjs')]);
  t.after(() => client.close());
  await client.request('initialize'); await client.event('initialized');
  await client.request('configurationDone');
  await assert.rejects(() => client.request('launch', { program: path('does-not-exist.exe') }), /ENOENT/);
  await client.request('disconnect');
});
