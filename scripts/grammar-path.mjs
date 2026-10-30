import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const grammarRoot = resolve(process.env.BLITZMAX_GRAMMAR_DIR || resolve(root, '../tree-sitter-blitzmax'));
export function requireGrammar() {
  for (const file of ['grammar.js', 'src/parser.c', 'src/scanner.c']) {
    if (!existsSync(resolve(grammarRoot, file))) {
      throw new Error(`BlitzMax grammar missing at ${grammarRoot}. Clone tree-sitter-blitzmax beside zed-blitzmax, or set BLITZMAX_GRAMMAR_DIR to its checkout.`);
    }
  }
  return grammarRoot;
}