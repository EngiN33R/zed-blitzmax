import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));

test('snippets retain useful templates without VS Code comment variables', () => {
  const snippets = read('snippets/blitzmax.json');
  assert.equal(Object.keys(snippets).length, 30);
  for (const name of ['Function', 'Method', 'Type', 'Struct', 'Interface', 'For EachIn', 'Try']) assert.ok(snippets[name]);
  assert.ok(snippets['Rem Block'].body.join('\n').includes('End Rem'));
  assert.doesNotMatch(JSON.stringify(snippets), /\$(BLOCK_COMMENT|LINE_COMMENT)/);
});

test('build tasks save edits, pass file paths as arguments and use consistent modes', () => {
  const tasks = read('languages/blitzmax/tasks.json');
  for (const task of tasks.filter(task => task.args[0] === 'makeapp')) {
    assert.equal(task.save, 'all');
    assert.ok(task.args.includes('$ZED_FILE'));
    assert.ok(task.args.includes('-d') || task.args.includes('-r'));
    assert.equal(task.env.BMXPATH, '');
  }
  assert.ok(tasks.some(task => task.tags?.includes('blitzmax-run')));
  assert.ok(read('debug_adapter_schemas/BlitzMax.json').required.includes('program'));
});

test('example settings retain the extension launcher and debug configurations are arrays', () => {
  const settings = read('examples/.zed/settings.json.example').lsp.blitzmax;
  assert.equal(settings.binary?.path, undefined);
  assert.equal(settings.initialization_options.blitzmax.serverPath, '/absolute/path/to/bls');
  const debug = read('examples/.zed/debug.json.example');
  assert.equal(Array.isArray(debug), true);
  assert.equal(debug[0].adapter, 'BlitzMax');
});
