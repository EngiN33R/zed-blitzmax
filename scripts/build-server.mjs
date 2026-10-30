// Optional local build of the upstream standalone server for SDKs without bls.
// This server is kept outside the distributable extension in ignored .local/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sdkInput = process.argv[2] || process.env.BLITZMAX_SDK;
if (!sdkInput) {
  console.error('Pass the BlitzMax SDK root: pnpm server:build <sdk-path>, or set BLITZMAX_SDK.');
  process.exit(1);
}
const sdk = resolve(sdkInput);
const source = join(root, '.local/server-source');
const bin = join(root, '.local/bin');
const revision = 'da3263419067f5fbb31303edff546cb6bb6f1507';
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, env: { ...process.env, BMXPATH: sdk }, stdio: 'inherit', windowsHide: true });
const git = args => run('git', args, source);
mkdirSync(bin, { recursive: true });
if (!existsSync(join(source, '.git'))) run('git', ['clone', 'https://github.com/Hezkore/blitzmax-language-server.git', source]);
git(['checkout', revision]);
git(['submodule', 'update', '--init', '--depth', '1']);
try { execFileSync('git', ['-C', 'bcc', 'apply', '--reverse', '--check', '../patches/0001-bcc-for-editors.patch'], { cwd: source, stdio: 'pipe', windowsHide: true }); }
catch { git(['-C', 'bcc', 'apply', '../patches/0001-bcc-for-editors.patch']); }

// The upstream server was tested on Linux. Windows C stdio must be in binary
// mode so the CRLF LSP headers and byte counts survive unchanged.
writeFileSync(join(source, 'windows_stdio.c'), `#include <stdio.h>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
int bmx_lsp_binary_stdio(void) {
#ifdef _WIN32
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    return 0;
}
`);
const mainPath = join(source, 'bls.bmx');
let main = readFileSync(mainPath, 'utf8');
if (!main.includes('bmx_lsp_binary_stdio')) main = main.replace('Import "src/lsp/tserver.bmx"', `Import "src/lsp/tserver.bmx"
Import "windows_stdio.c"
Extern "C"
    Function bmx_lsp_binary_stdio:Int()
End Extern
bmx_lsp_binary_stdio()`);
writeFileSync(mainPath, main);
const transportPath = join(source, 'src/lsp/ttransport.bmx');
writeFileSync(transportPath, readFileSync(transportPath, 'utf8').replace(
  'fread_(Varptr buf[got], 1, length - got, stdin_)',
  'fread_(Varptr buf[got], Size_T(1), Size_T(length - got), stdin_)'));

const program = join(bin, process.platform === 'win32' ? 'bls.exe' : 'bls');
run(join(sdk, 'bin', process.platform === 'win32' ? 'bmk.exe' : 'bmk'), ['makeapp', '-quick', '-r', '-t', 'console', '-o', program, 'bls.bmx'], source);
writeFileSync(join(root, '.local/server-build.json'), JSON.stringify({ repository: 'https://github.com/Hezkore/blitzmax-language-server', revision,
  compilerRevision: 'f163255cffaf3fd9aeb84f49a1557c6743926c0e', sdk, program, adjustments: ['Windows binary stdio', 'explicit fread Size_T arguments'] }, null, 2) + '\n');
console.log(`Built ${program}. Configure lsp.blitzmax.binary.path to use it with sdkPath ${sdk}.`);
