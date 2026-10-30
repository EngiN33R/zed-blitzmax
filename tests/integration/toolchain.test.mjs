import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ProtocolClient } from '../helpers.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const sdk = process.env.BLITZMAX_SDK;
const exe = name => join(sdk, 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
const work = resolve(root, 'work/integration with spaces');
const env = { ...process.env, BMXPATH: sdk };
const skip = !sdk && 'Set BLITZMAX_SDK to run against a real BlitzMax installation';
const binary = name => join(work, name + (process.platform === 'win32' ? '.exe' : ''));

test('real bmk builds and executes a BlitzMax program with spaces in its output path', { skip, timeout: 120000 }, async () => {
  mkdirSync(work, { recursive: true });
  await exec(exe('bmk'), ['makeapp', '-quick', '-d', '-o', binary('hello'), join(root, 'examples/hello.bmx')], { env, windowsHide: true, timeout: 100000 });
  const { stdout } = await exec(binary('hello'), [], { windowsHide: true, timeout: 10000 });
  assert.match(stdout, /Hello, Zed!/);
});

test('real BlitzMax language server initializes and answers supported requests', { skip, timeout: 60000 }, async t => {
  const client = new ProtocolClient(process.execPath, [join(root, 'tools/blitzmax-lsp.mjs'), process.env.BLITZMAX_LANGUAGE_SERVER || exe('bls')], { env, cwd: root });
  t.after(() => client.close());
  const uri = pathToFileURL(join(root, 'examples/hello.bmx')).href;
  const initialized = await client.request('initialize', {
    processId: process.pid,
    rootUri: pathToFileURL(join(root, 'examples')).href,
    workspaceFolders: [{ uri: pathToFileURL(join(root, 'examples')).href, name: 'zed-blitzmax examples' }],
    initializationOptions: { blitzmax: { sdkPath: sdk, buildMode: 'debug' } },
    capabilities: { workspace: { configuration: true }, textDocument: {
      synchronization: { didSave: true }, hover: { contentFormat: ['markdown', 'plaintext'] },
      completion: { completionItem: { snippetSupport: true } },
      documentSymbol: { hierarchicalDocumentSymbolSupport: true },
      diagnostic: { relatedDocumentSupport: true },
    } },
  }, true, 30000);
  assert.ok(initialized.capabilities);
  t.diagnostic(`Server: ${JSON.stringify(initialized.serverInfo)}; capabilities: ${JSON.stringify(initialized.capabilities)}`);
  client.notify('initialized', {});
  client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'blitzmax', version: 1,
    text: readFileSync(join(root, 'examples/hello.bmx'), 'utf8') } });
  if (initialized.capabilities.documentSymbolProvider) {
    const symbols = await client.request('textDocument/documentSymbol', { textDocument: { uri } }, true, 30000);
    assert.ok(Array.isArray(symbols));
    t.diagnostic(`Document symbols: ${JSON.stringify(symbols).slice(0, 500)}`);
  }
  if (initialized.capabilities.completionProvider) {
    const completion = await client.request('textDocument/completion', { textDocument: { uri }, position: { line: 7, character: 2 } }, true, 30000);
    assert.ok(completion !== undefined);
  }
  if (initialized.capabilities.hoverProvider) {
    const hover = await client.request('textDocument/hover', { textDocument: { uri }, position: { line: 7, character: 9 } }, true, 30000);
    assert.ok(hover?.contents, 'Hover should describe Greeting');
  }
  if (initialized.capabilities.definitionProvider) {
    const definition = await client.request('textDocument/definition', { textDocument: { uri }, position: { line: 7, character: 9 } }, true, 30000);
    assert.ok(definition && (!Array.isArray(definition) || definition.length > 0), 'Greeting should resolve to its declaration');
  }
  if (initialized.capabilities.renameProvider) {
    const edit = await client.request('textDocument/rename', { textDocument: { uri }, position: { line: 7, character: 9 }, newName: 'Salutation' }, true, 30000);
    assert.ok(edit?.changes || edit?.documentChanges, 'Rename should return a workspace edit');
  }
  if (initialized.capabilities.documentFormattingProvider) {
    const edits = await client.request('textDocument/formatting', { textDocument: { uri }, options: { tabSize: 4, insertSpaces: false } }, true, 30000);
    assert.ok(Array.isArray(edits), 'Formatting should return edits');
  }
  if (initialized.capabilities.diagnosticProvider) {
    client.notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [
      { text: readFileSync(join(root, 'examples/hello.bmx'), 'utf8') + '\nLocal broken:Int = UnknownBlitzMaxSymbol\n' },
    ] });
    const diagnostics = await client.request('textDocument/diagnostic', { textDocument: { uri } }, true, 30000);
    assert.ok(diagnostics.items.some(diagnostic => diagnostic.severity === 1), 'An undefined name should produce an error diagnostic');
  }
  client.notify('textDocument/didClose', { textDocument: { uri } });
  await client.request('shutdown', null, true);
  client.notify('exit');
});

test('real BlitzMax debug build stops, exposes locals, steps and resumes through the adapter', { skip, timeout: 120000 }, async t => {
  mkdirSync(work, { recursive: true });
  await exec(exe('bmk'), ['makeapp', '-quick', '-d', '-o', binary('debug'), join(root, 'examples/debug.bmx')], { env, windowsHide: true, timeout: 100000 });
  const client = new ProtocolClient(process.execPath, [join(root, 'tools/blitzmax-dap.mjs')]);
  t.after(() => client.close());
  await client.request('initialize', { adapterID: 'BlitzMax', linesStartAt1: true, columnsStartAt1: true });
  await client.event('initialized');
  const launch = client.request('launch', { program: binary('debug'), cwd: work });
  await client.request('configurationDone');
  await launch;
  assert.equal((await client.event('stopped')).reason, 'breakpoint');
  const stack = await client.request('stackTrace', { threadId: 1 });
  assert.ok(stack.stackFrames.length > 0);
  t.diagnostic(`Real runtime stack: ${JSON.stringify(stack)}`);
  let answer;
  for (const frame of stack.stackFrames) {
    const { scopes } = await client.request('scopes', { frameId: frame.id });
    for (const scope of scopes) {
      const { variables } = await client.request('variables', { variablesReference: scope.variablesReference });
      answer ??= variables.find(variable => variable.name === 'answer');
    }
  }
  assert.equal(answer?.value, '42');
  await client.request('next', { threadId: 1 });
  assert.equal((await client.event('stopped')).reason, 'step');
  await client.request('continue', { threadId: 1 });
  const output = await client.wait(message => message.event === 'output' && message.body.output.includes('43'));
  assert.match(output.body.output, /43/);
  assert.equal((await client.event('exited')).exitCode, 0);
});
