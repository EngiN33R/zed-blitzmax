// A deterministic implementation of the documented BlitzMax stderr debugger.
import { createInterface } from 'node:readline';
const send = (name, data = []) => process.stderr.write(`~>${name}{\r\n${data.map(line => '~>' + line + '\r\n').join('')}~>\r\n`);
const start = Buffer.from('~>DebugStop{\r\n~>\r\n');
process.stderr.write(start.subarray(0, 8));
setTimeout(() => process.stderr.write(start.subarray(8)), 5);
createInterface({ input: process.stdin }).on('line', line => {
  switch (line[0]) {
    case 't': send('StackTrace', ['@C:/source with spaces/main.bmx<5,1>', 'Function Main:Int()', 'Local answer:Int=42', 'Local text:String="a=b"', 'Local item:TItem=$1234']); break;
    case 'd': send('Dump', ['Field name:String="café"']); break;
    case 's': case 'e': case 'l': send('Debug'); break;
    case 'r': process.stdout.write('continued café\n'); process.exit(0); break;
    case 'q': process.exit(0); break;
  }
});
