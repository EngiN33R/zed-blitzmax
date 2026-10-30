import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Parser, Language, Query } from 'web-tree-sitter';

test('WebAssembly grammar loads and parses declarations, strings and documentation', async () => {
  await Parser.init();
  const language = await Language.load(fileURLToPath(new URL('../../grammars/blitzmax.wasm', import.meta.url)));
  const parser = new Parser(); parser.setLanguage(language);
  const source = readFileSync(new URL('../fixtures/language.bmx', import.meta.url), 'utf8');
  const tree = parser.parse(source);
  assert.equal(tree.rootNode.hasError, false, tree.rootNode.toString());
  const query = new Query(language, readFileSync(new URL('../../languages/blitzmax/outline.scm', import.meta.url), 'utf8'));
  const names = query.captures(tree.rootNode).filter(capture => capture.name === 'name').map(capture => capture.node.text);
  assert.ok(names.includes('TExample'));
  assert.ok(names.includes('Name'));
  query.delete(); tree.delete(); parser.delete();
});
