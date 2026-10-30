import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { requireGrammar } from './grammar-path.mjs';

const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [require.resolve('tree-sitter-cli/cli.js'), ...process.argv.slice(2)], {
  cwd: requireGrammar(), stdio: 'inherit', windowsHide: true,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);