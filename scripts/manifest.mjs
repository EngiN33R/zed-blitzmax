import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function field(text, name) {
  return new RegExp(`^${name}\\s*=\\s*"([^"]+)"\\s*(?:#.*)?$`, 'm').exec(text)?.[1];
}

export function parseManifest(text) {
  const header = text.split(/^\[/m)[0];
  const grammar = text.split('[grammars.blitzmax]')[1]?.split(/^\[/m)[0] || '';
  const result = {
    id: field(header, 'id'), version: field(header, 'version'), repository: field(header, 'repository'),
    grammarRepository: field(grammar, 'repository'), grammarRevision: field(grammar, 'rev'),
  };
  if (result.id !== 'blitzmax' || !/^\d+\.\d+\.\d+$/.test(result.version || '')) throw new Error('Invalid extension id/version');
  for (const url of [result.repository, result.grammarRepository]) {
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(url || '')) throw new Error('Release manifests require public HTTPS GitHub repository URLs');
  }
  if (!/^[0-9a-f]{40}$/.test(result.grammarRevision || '')) throw new Error('Release grammar must be pinned to a full commit SHA');
  if (/@GRAMMAR_|file:\/\//.test(text)) throw new Error('Release manifest contains a local grammar or template placeholder');
  return result;
}

export function loadManifest(root) {
  return parseManifest(readFileSync(resolve(root, 'extension.toml'), 'utf8'));
}
