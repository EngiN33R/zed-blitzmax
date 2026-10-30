import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { requireGrammar } from '../scripts/grammar-path.mjs';
import { loadManifest, parseManifest } from '../scripts/manifest.mjs';
import { checkRelease } from '../scripts/check-release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('production manifest pins a public grammar and rejects local URLs or floating revisions', () => {
  const text = readFileSync(join(root, 'extension.toml'), 'utf8');
  const manifest = checkRelease(root);
  assert.match(manifest.grammarRepository, /^https:\/\/github.com\//);
  assert.throws(() => parseManifest(text.replace(manifest.grammarRepository, 'file:///local/grammar')));
  assert.throws(() => parseManifest(text.replace(manifest.grammarRevision, 'main')));
});

test('development staging leaves the production manifest unchanged and excludes external tools', () => {
  const scratch = join(root, 'work/publication-tests');
  mkdirSync(scratch, { recursive: true });
  const checkout = mkdtempSync(join(scratch, 'checkout with spaces $-'));
  mkdirSync(join(checkout, 'scripts'));
  const grammar = join(checkout, 'external grammar with spaces');
  mkdirSync(grammar);
  for (const file of ['extension.toml', 'Cargo.toml', 'Cargo.lock', 'build.rs', 'src', 'languages', 'snippets', 'debug_adapter_schemas', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'scripts/prepare-dev.mjs', 'scripts/grammar-path.mjs', 'scripts/manifest.mjs']) {
    cpSync(join(root, file), join(checkout, file), { recursive: true });
  }
  for (const file of ['grammar.js', 'src']) cpSync(join(requireGrammar(), file), join(grammar, file), { recursive: true });
  const production = readFileSync(join(checkout, 'extension.toml'), 'utf8');
  const prepare = () => execFileSync(process.execPath, [join(checkout, 'scripts/prepare-dev.mjs')], { windowsHide: true, env: { ...process.env, BLITZMAX_GRAMMAR_DIR: grammar } });
  prepare();
  const stage = join(checkout, 'work/dev-extension');
  const manifest = readFileSync(join(stage, 'extension.toml'), 'utf8');
  assert.ok(manifest.includes(`repository = ${JSON.stringify(pathToFileURL(join(checkout, '.grammar-repository')).href)}`));
  const revision = execFileSync('git', ['-C', join(checkout, '.grammar-repository'), 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
  assert.ok(manifest.includes(`rev = "${revision}"`));
  assert.equal(existsSync(join(stage, 'tools')), false);
  assert.equal(existsSync(join(stage, 'src/lib.rs')), true);
  prepare();
  assert.equal(readFileSync(join(stage, 'extension.toml'), 'utf8'), manifest);
  assert.equal(readFileSync(join(checkout, 'extension.toml'), 'utf8'), production);
  assert.equal(loadManifest(checkout).grammarRevision, loadManifest(root).grammarRevision);
});

test('server build requires an explicit SDK instead of a developer-specific default', () => {
  const env = { ...process.env };
  delete env.BLITZMAX_SDK;
  const result = spawnSync(process.execPath, [join(root, 'scripts/build-server.mjs')], { env, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pnpm server:build <sdk-path>/);
});
