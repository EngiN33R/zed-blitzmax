import { DapTransport } from '../tools/blitzmax-dap.mjs';
import { spawn } from 'node:child_process';

export class ProtocolClient {
  requests = new Map();
  messages = [];
  waiting = [];
  stderr = '';
  constructor(command, args, options = {}) {
    this.child = spawn(command, args, { stdio: 'pipe', windowsHide: true, ...options });
    this.transport = new DapTransport(this.child.stdout, this.child.stdin);
    this.transport.on('error', error => this.fail(error));
    this.child.on('error', error => this.fail(error));
    this.child.stderr.on('data', data => { this.stderr += data.toString(); });
    this.child.on('exit', () => this.fail(new Error(`Server exited: ${this.stderr}`)));
    this.transport.on('message', message => {
      const id = message.type === 'response' ? message.request_seq : message.id;
      if ((message.type === 'response' || 'result' in message || 'error' in message) && this.requests.has(id)) {
        const { resolve, reject, timer } = this.requests.get(id);
        this.requests.delete(id);
        clearTimeout(timer);
        if (message.success === false || message.error) reject(new Error(message.message || JSON.stringify(message.error)));
        else resolve(message.type === 'response' ? message.body : message.result);
      } else if (message.method && message.id !== undefined) {
        let result = null;
        if (message.method === 'workspace/configuration') {
          result = message.params.items.map(() => ({}));
        }
        this.transport.send({ jsonrpc: '2.0', id: message.id, result });
      } else {
        const index = this.waiting.findIndex(waiter => waiter.test(message));
        if (index >= 0) {
          const [waiter] = this.waiting.splice(index, 1);
          clearTimeout(waiter.timer);
          waiter.resolve(message);
        } else { this.messages.push(message); }
      }
    });
  }
  fail(error) {
    for (const pending of [...this.requests.values(), ...this.waiting]) { clearTimeout(pending.timer); pending.reject(error); }
    this.requests.clear(); this.waiting = [];
  }
  request(command, args = {}, lsp = false, timeout = 15000) {
    const id = this.transport.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.requests.delete(id); reject(new Error(`Timed out: ${command}\n${this.stderr}`)); }, timeout);
      this.requests.set(id, { resolve, reject, timer });
      this.transport.send(lsp ? { jsonrpc: '2.0', id, method: command, params: args }
        : { type: 'request', command, arguments: args });
    });
  }
  notify(method, params) { this.transport.send({ jsonrpc: '2.0', method, params }); }
  wait(test, timeout = 15000) {
    const index = this.messages.findIndex(test);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { test, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => { this.waiting = this.waiting.filter(w => w !== waiter); reject(new Error(`Timed out waiting for server event\n${this.stderr}`)); }, timeout);
      this.waiting.push(waiter);
    });
  }
  event(name) { return this.wait(message => message.event === name).then(message => message.body); }
  close() { this.child.stdin.end(); this.child.kill(); this.fail(new Error('Test client closed')); }
}
