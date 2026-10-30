// Standalone DAP transport for BlitzMax's stdio debugger. Protocol behaviour is
// based on Hezkore/vscode-blitzmax-support (MIT); see THIRD_PARTY_NOTICES.md.
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DapTransport } from './protocol.mjs';
export { DapTransport } from './protocol.mjs';

// The runtime writes ~>event{ / ~>data / ~> on stderr. Keep partial lines and
// UTF-8 sequences across arbitrary OS pipe chunks.
export class RuntimeProtocol extends EventEmitter {
  decoder = new StringDecoder('utf8');
  buffer = '';
  current = null;
  feed(chunk) {
    this.buffer += this.decoder.write(chunk);
    let end;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      this.line(this.buffer.slice(0, end).replace(/\r$/, ''));
      this.buffer = this.buffer.slice(end + 1);
    }
  }
  finish() {
    this.buffer += this.decoder.end();
    if (this.buffer) this.line(this.buffer.replace(/\r$/, ''));
    this.buffer = '';
  }
  line(line) {
    if (!line.startsWith('~>')) { this.emit('output', line + '\n'); return; }
    const text = line.slice(2);
    if (!this.current) {
      if (!text) return;
      this.current = { name: text.replace(/\{$/, ''), data: [] };
    } else if (text && text !== '}') {
      this.current.data.push(text);
    } else {
      const event = this.current;
      this.current = null;
      this.emit('event', event);
    }
  }
}

export function parseVariable(line) {
  const equal = line.indexOf('=');
  const declaration = (equal < 0 ? line : line.slice(0, equal)).trim();
  const value = equal < 0 ? '' : line.slice(equal + 1).trim();
  const name = declaration.replace(/^(Local|Global|Field|Const)\s+/i, '').replace(/:[^:]*$/, '');
  const type = declaration.includes(':') ? declaration.slice(declaration.lastIndexOf(':') + 1) : '';
  return { name, value, type, variablesReference: 0 };
}

export class BlitzMaxDebugAdapter {
  process = null;
  stopped = false;
  frames = [];
  handles = new Map();
  nextHandle = 1;
  pending = null;
  configured = false;
  launching = false;
  terminating = false;
  constructor(transport) {
    this.transport = transport;
    this.configurationDone = new Promise(resolveDone => { this.resolveDone = resolveDone; });
    this.queryQueue = Promise.resolve();
    transport.on('message', message => {
      if (message.type !== 'request') return;
      Promise.resolve().then(() => this.request(message)).then(
        body => transport.response(message, body),
        error => transport.response(message, {}, error),
      );
    });
  }
  event(name, body) { this.transport.event(name, body); }
  output(output, category = 'console') { this.event('output', { output, category }); }
  async request(request) {
    const args = request.arguments ?? {};
    switch (request.command) {
      case 'initialize':
        // Emit after the initialize response has been written.
        setImmediate(() => this.event('initialized'));
        return { supportsConfigurationDoneRequest: true, supportsTerminateRequest: true,
          supportsEvaluateForHovers: true, supportsValueFormattingOptions: false,
          supportsConditionalBreakpoints: false, supportsFunctionBreakpoints: false,
          supportsStepBack: false, exceptionBreakpointFilters: [] };
      case 'launch': return this.launch(args);
      case 'configurationDone': this.configured = true; this.resolveDone(); return {};
      case 'setBreakpoints': return this.breakpoints(args);
      case 'setExceptionBreakpoints': return {};
      case 'threads': return { threads: this.process ? [{ id: 1, name: 'BlitzMax main thread' }] : [] };
      case 'stackTrace': return this.stackTrace(args);
      case 'scopes': return { scopes: this.frames.find(frame => frame.id === args.frameId)?.scopes ?? [] };
      case 'variables': return { variables: await this.variables(args.variablesReference) };
      case 'evaluate': {
        this.assertStopped();
        // Hover/watch reads values already exposed by the runtime; no arbitrary execution.
        if (!this.frames.length) await this.stackTrace({});
        for (const entry of this.handles.values()) {
          for (const variable of entry.variables ?? []) {
            if (variable.name.toLowerCase() === String(args.expression).toLowerCase()) {
              return { result: variable.value, type: variable.type, variablesReference: variable.variablesReference };
            }
          }
        }
        throw new Error('Value is not in the current stack. Expand its scope first. Only variable names can be evaluated.');
      }
      case 'continue': return this.resume('r');
      case 'next': return this.resume('s');
      case 'stepIn': return this.resume('e');
      case 'stepOut': return this.resume('l');
      case 'disconnect':
      case 'terminate': this.terminate(); return {};
      case 'pause': throw new Error('BlitzMax cannot pause a running program. Add DebugStop and rebuild with -d.');
      default: throw new Error(`Unsupported BlitzMax debug request: ${request.command}`);
    }
  }
  async launch(args) {
    if (this.launching || this.process) throw new Error('A BlitzMax program is already running');
    if (typeof args.program !== 'string' || !args.program) throw new Error('program must name a compiled BlitzMax debug executable');
    if (args.args !== undefined && (!Array.isArray(args.args) || args.args.some(arg => typeof arg !== 'string'))) throw new Error('args must be an array of strings');
    if (args.env !== undefined && (!args.env || typeof args.env !== 'object' || Array.isArray(args.env) || Object.values(args.env).some(v => typeof v !== 'string'))) throw new Error('env must map names to strings');
    if (args.stopOnEntry) throw new Error('stopOnEntry is unsupported. Add DebugStop at your entry point.');
    this.launching = true;
    try {
      await this.configurationDone;
      if (this.terminating) throw new Error('Launch was cancelled');
      const child = spawn(resolve(args.cwd || process.cwd(), args.program), args.args ?? [], {
        cwd: args.cwd || undefined, env: { ...process.env, ...args.env }, stdio: 'pipe', windowsHide: true,
      });
      this.process = child;
      const protocol = new RuntimeProtocol();
      protocol.on('output', text => this.output(text, 'stderr'));
      protocol.on('event', event => this.runtimeEvent(event));
      child.stdout.on('data', data => this.output(data.toString(), 'stdout'));
      child.stderr.on('data', data => protocol.feed(data));
      child.stdin.on('error', error => this.output(`${error.message}\n`, 'stderr'));
      child.once('close', code => {
        protocol.finish();
        this.process = null;
        this.rejectPending(new Error('Debug program exited'));
        this.event('exited', { exitCode: code ?? 1 });
        this.event('terminated');
      });
      await new Promise((resolveSpawn, rejectSpawn) => { child.once('spawn', resolveSpawn); child.once('error', rejectSpawn); });
      this.event('process', { name: basename(args.program), systemProcessId: child.pid, isLocalProcess: true, startMethod: 'launch' });
      return {};
    } finally { this.launching = false; }
  }
  breakpoints(args) {
    let lines = [];
    try { lines = readFileSync(args.source?.path, 'utf8').split(/\r?\n/); } catch { /* Unavailable source gets unverified breakpoints. */ }
    return { breakpoints: (args.breakpoints ?? []).map(bp => {
      const verified = /^\s*DebugStop(?:\s|;|$)/i.test(lines[bp.line - 1] ?? '');
      return { verified, line: bp.line, source: args.source,
        ...(!verified ? { message: 'Add DebugStop at the start of this line, then rebuild with -d. Gutter breakpoints do not modify source.' } : {}) };
    }) };
  }
  runtimeEvent(event) {
    if (/^(DebugStop|Debug|Unhandled Exception)(?:[:@]|$)/.test(event.name)) {
      this.rejectPending(new Error('Debug runtime stopped again'));
      this.stopped = true;
      this.frames = [];
      this.handles.clear();
      // Never recycle handles across stops: delayed requests must not see new values.
      const exception = event.name.startsWith('Unhandled Exception');
      this.event('stopped', { reason: exception ? 'exception' : event.name.startsWith('DebugStop') ? 'breakpoint' : 'step',
        description: event.name, threadId: 1, allThreadsStopped: true });
    } else if (this.pending) {
      const { resolveEvent, timer } = this.pending;
      this.pending = null;
      clearTimeout(timer);
      resolveEvent(event);
    } else { this.output(`BlitzMax: ${event.name}\n`); }
  }
  assertStopped() { if (!this.process || !this.stopped) throw new Error('The BlitzMax program must be stopped at DebugStop or a step'); }
  rejectPending(error) {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.rejectEvent(error);
    this.pending = null;
  }
  query(command) {
    const query = () => {
      this.assertStopped();
      return new Promise((resolveEvent, rejectEvent) => {
        const timer = setTimeout(() => {
          this.pending = null;
          rejectEvent(new Error('BlitzMax runtime did not answer within 5 seconds'));
        }, 5000);
        this.pending = { resolveEvent, rejectEvent, timer };
        this.process.stdin.write(command + '\n');
      });
    };
    const result = this.queryQueue.then(query);
    this.queryQueue = result.catch(() => {});
    return result;
  }
  handle(entry) { const id = this.nextHandle++; this.handles.set(id, entry); return id; }
  convertVariable(line) {
    const variable = parseVariable(line);
    if (/^\$[a-fA-F0-9]+$/.test(variable.value)) variable.variablesReference = this.handle({ address: variable.value.slice(1) });
    return variable;
  }
  async stackTrace(args) {
    this.assertStopped();
    if (!this.frames.length) {
      const event = await this.query('t');
      const frames = [];
      let location, scope;
      for (const line of event.data) {
        const match = /^@(.+)<(\d+),(\d+)>$/.exec(line);
        if (match) {
          location = { source: { name: basename(match[1]), path: match[1] }, line: Math.max(1, Number(match[2])), column: Math.max(1, Number(match[3])) };
        } else if (location) {
          if (line === 'Local <local>' && frames.length) {
            Object.assign(frames.at(-1), location);
            scope = this.handles.get(frames.at(-1).scopes[0].variablesReference);
          } else {
            scope = { variables: [] };
            frames.push({ id: this.nextHandle++, name: line.replace(/^\w+\s+/, ''), ...location,
              scopes: [{ name: 'Locals', expensive: false, variablesReference: this.handle(scope) }] });
          }
          location = null;
        } else if (scope) { scope.variables.push(this.convertVariable(line)); }
      }
      this.frames = frames.reverse();
    }
    const start = args.startFrame ?? 0;
    return { stackFrames: this.frames.slice(start, args.levels ? start + args.levels : undefined).map(({ scopes, ...frame }) => frame), totalFrames: this.frames.length };
  }
  async variables(reference) {
    this.assertStopped();
    const entry = this.handles.get(reference);
    if (!entry) throw new Error('Variable reference has expired');
    if (!entry.variables && entry.address) {
      const event = await this.query('d' + entry.address);
      entry.variables = event.data.map(line => this.convertVariable(line));
    }
    return entry.variables ?? [];
  }
  resume(command) {
    this.assertStopped();
    this.rejectPending(new Error('Program resumed'));
    this.stopped = false;
    this.frames = [];
    this.handles.clear();
    this.process.stdin.write(command + '\n');
    this.event('continued', { threadId: 1, allThreadsContinued: true });
    return { allThreadsContinued: true };
  }
  terminate() {
    this.terminating = true;
    this.resolveDone();
    this.rejectPending(new Error('Debug session terminated'));
    if (!this.process) return;
    const child = this.process;
    if (this.stopped) child.stdin.write('q\n');
    child.kill();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const transport = new DapTransport(process.stdin, process.stdout);
  const adapter = new BlitzMaxDebugAdapter(transport);
  transport.on('error', error => { process.stderr.write(error.message + '\n'); adapter.terminate(); process.exitCode = 1; process.stdin.destroy(); });
  process.stdin.on('end', () => adapter.terminate());
}
