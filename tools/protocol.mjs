import { EventEmitter } from 'node:events';

export class DapTransport extends EventEmitter {
  buffer = Buffer.alloc(0);
  seq = 1;
  constructor(input, output) {
    super();
    this.output = output;
    input.on('data', chunk => {
      try { this.feed(chunk); } catch (error) { this.emit('error', error); }
    });
  }
  feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length) {
      const end = this.buffer.indexOf('\r\n\r\n');
      if (end < 0) {
        if (this.buffer.length > 8192) throw new Error('DAP header too large');
        return;
      }
      const match = /^Content-Length: (\d+)$/mi.exec(this.buffer.subarray(0, end).toString('ascii'));
      const length = Number(match?.[1]);
      if (!Number.isSafeInteger(length) || length < 1 || length > 16 * 1024 * 1024) throw new Error('Invalid DAP Content-Length');
      if (this.buffer.length < end + 4 + length) return;
      const message = JSON.parse(this.buffer.subarray(end + 4, end + 4 + length).toString('utf8'));
      this.buffer = this.buffer.subarray(end + 4 + length);
      this.emit('message', message);
    }
  }
  send(message) {
    const body = Buffer.from(JSON.stringify({ seq: this.seq++, ...message }));
    this.output.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
  }
  event(event, body = {}) { this.send({ type: 'event', event, body }); }
  response(request, body = {}, error) {
    this.send({ type: 'response', request_seq: request.seq, command: request.command,
      success: !error, ...(error ? { message: error.message } : { body }) });
  }
}
