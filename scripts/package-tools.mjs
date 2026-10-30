import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export function packageTools(checkout = root, output = resolve(checkout, 'work/releases')) {
  const { version } = JSON.parse(readFileSync(resolve(checkout, 'tools/package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid tools version');
  const directory = resolve(output, `blitzmax-tools-v${version}`);
  mkdirSync(directory, { recursive: true });
  const files = ['blitzmax-dap.mjs', 'blitzmax-lsp.mjs', 'protocol.mjs', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md'];
  for (const file of files) {
    copyFileSync(resolve(checkout, file.endsWith('.md') || file === 'LICENSE' ? file : `tools/${file}`), resolve(directory, file));
  }
  const asset = resolve(output, `blitzmax-tools-v${version}.tar.gz`);
  execFileSync('tar', ['-czf', asset, '-C', directory, ...files], { windowsHide: true });
  const checksum = asset + '.sha256';
  writeFileSync(checksum, `${createHash('sha256').update(readFileSync(asset)).digest('hex')}  ${basename(asset)}\n`);
  return { version, asset, checksum, directory };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { asset, checksum } = packageTools();
  console.log(`External tools release assets:\n${asset}\n${checksum}`);
}
