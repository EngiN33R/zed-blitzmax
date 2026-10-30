// A transparent stdio bridge. Older BlitzMax servers stringify numeric request
// ids, send configuration items as params directly, or use serverinfo. Zed
// expects standard LSP messages; modern bls messages pass through unchanged.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DapTransport } from './protocol.mjs';

export function normalizeServerMessage(message, clientRequests) {
  if (('result' in message || 'error' in message) && clientRequests.has(String(message.id))) {
    const original = clientRequests.get(String(message.id));
    clientRequests.delete(String(message.id));
    message.id = original.id;
    if (original.method === 'initialize' && message.result) {
      const result = message.result;
      if (result.serverinfo && !result.serverInfo) { result.serverInfo = result.serverinfo; delete result.serverinfo; }
      const completion = result.capabilities?.completionProvider;
      if (typeof completion?.triggerCharacters === 'string') completion.triggerCharacters = [...completion.triggerCharacters];
    }
  }
  if (message.method === 'workspace/configuration' && Array.isArray(message.params)) message.params = { items: message.params };
  return message;
}

export function startBridge(command, args, input = process.stdin, output = process.stdout) {
  const child = spawn(command, args, { stdio: 'pipe', windowsHide: true });
  const clientRequests = new Map();
  const serverRequests = new Map();
  const write = (stream, value) => {
    const bytes = Buffer.from(JSON.stringify(value));
    stream.write(Buffer.concat([Buffer.from(`Content-Length: ${bytes.length}\r\n\r\n`), bytes]));
  };
  const server = new DapTransport(child.stdout, child.stdin);
  const client = new DapTransport(input, output);
  let sdk = process.env.BMXPATH;
  server.on('message', value => {
    const message = normalizeServerMessage(value, clientRequests);
    const items = message.method === 'workspace/configuration' ? message.params?.items : null;
    if (sdk && Array.isArray(items) && items.every(item => item.section === 'blitzmax.base.path')) {
      // The 2023 server asks for the VS Code SDK setting before initializing.
      write(child.stdin, { jsonrpc: '2.0', id: message.id, result: items.map(() => sdk) });
      return;
    }
    if (message.method && message.id !== undefined) serverRequests.set(String(message.id), message.id);
    write(output, message);
  });
  client.on('message', message => {
    if (message.method && message.id !== undefined) clientRequests.set(String(message.id), { id: message.id, method: message.method });
    if (message.method === 'initialize') sdk = message.params?.initializationOptions?.blitzmax?.sdkPath || sdk;
    if (('result' in message || 'error' in message) && serverRequests.has(String(message.id))) {
      const id = serverRequests.get(String(message.id)); serverRequests.delete(String(message.id)); message.id = id;
    }
    write(child.stdin, message);
  });
  const fail = error => {
    process.stderr.write(`BlitzMax LSP: ${error.message}\n`);
    for (const pending of clientRequests.values()) write(output, { jsonrpc: '2.0', id: pending.id, error: { code: -32603, message: error.message } });
    clientRequests.clear();
    child.kill();
  };
  child.on('error', fail);
  child.stdin.on('error', fail);
  client.on('error', fail);
  server.on('error', fail);
  child.stderr.on('data', bytes => process.stderr.write(bytes));
  child.on('close', code => { input.destroy(); process.exitCode = code ?? 1; });
  input.on('end', () => { child.stdin.end(); child.kill(); });
  return child;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (!command) { process.stderr.write('Usage: node blitzmax-lsp.mjs <language-server> [args...]\n'); process.exitCode = 1; }
  else startBridge(command, args);
}
