import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { requireGrammar } from './grammar-path.mjs';
import { loadManifest } from './manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadManifest(root);
const grammar = requireGrammar();
const repo = resolve(root, '.grammar-repository');
const output = resolve(root, 'work/dev-extension');
mkdirSync(repo, { recursive: true });
cpSync(resolve(grammar, 'src'), resolve(repo, 'src'), { recursive: true });
cpSync(resolve(grammar, 'grammar.js'), resolve(repo, 'grammar.js'));
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true }).trim();
git('init', '--quiet');
git('add', 'src', 'grammar.js');
if (git('status', '--porcelain')) {
  git('-c', 'user.name=BlitzMax grammar builder', '-c', 'user.email=builder@localhost', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'build: refresh local BlitzMax grammar');
}
mkdirSync(output, { recursive: true });
for (const file of ['Cargo.toml', 'Cargo.lock', 'build.rs', 'src', 'languages', 'snippets', 'debug_adapter_schemas', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  cpSync(resolve(root, file), resolve(output, file), { recursive: true });
}
let text = readFileSync(resolve(root, 'extension.toml'), 'utf8');
text = text.replace(/(\[grammars\.blitzmax\][\s\S]*?repository\s*=\s*)"[^"]+"/, (_, prefix) => prefix + JSON.stringify(pathToFileURL(repo).href))
  .replace(/(\[grammars\.blitzmax\][\s\S]*?rev\s*=\s*)"[^"]+"/, (_, prefix) => prefix + JSON.stringify(git('rev-parse', 'HEAD')));
writeFileSync(resolve(output, 'extension.toml'), text);
console.log(`Install Dev Extension: ${output}\nLocal toolsPath: ${resolve(root, 'tools')}`);
