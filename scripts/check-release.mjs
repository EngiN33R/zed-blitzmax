import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from './manifest.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export function checkRelease(checkout = root, requireWasm = false) {
  const manifest = loadManifest(checkout);
  const source = readFileSync(resolve(checkout, 'src/lib.rs'), 'utf8');
  if (/include_(?:str|bytes)!\s*\([^)]*\.mjs/s.test(source)) throw new Error('Extension must not embed adapter scripts');
  const tools = JSON.parse(readFileSync(resolve(checkout, 'tools/package.json'), 'utf8'));
  if (!source.includes(`const TOOLS_VERSION: &str = "${tools.version}";`)) throw new Error('Rust downloader and tools package versions differ');
  if (requireWasm) {
    const wasm = readFileSync(resolve(checkout, 'extension.wasm'));
    if (wasm[0] !== 0 || wasm.subarray(1, 4).toString() !== 'asm') throw new Error('Missing valid extension.wasm');
    for (const marker of ['export class BlitzMaxDebugAdapter', 'export function startBridge', 'export class DapTransport']) {
      if (wasm.includes(Buffer.from(marker))) throw new Error('Built extension contains embedded tool source');
    }
  }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkRelease(root, true);
  console.log('Production manifest and WebAssembly publication checks passed.');
}
