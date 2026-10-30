# BlitzMax for Zed

A Zed extension for **BlitzMax NG**, modelled after
[Hezkore's VS Code extension](https://github.com/Hezkore/vscode-blitzmax-support).

## Features

| Feature | Implementation |
| --- | --- |
| `.bmx` recognition and syntax highlighting | A bundled, case-insensitive Tree-sitter grammar, including `Rem` documentation, strings, numeric literals and conditional compilation |
| Outline, bracket matching and text objects | Tree-sitter queries for types, structs, interfaces, enums, functions, methods and declarations |
| Comments and indentation | Apostrophe comments, `Rem` blocks, tab indentation and block indentation rules |
| Snippets | 30 adapted upstream snippets, including loops, declarations, documentation, console and MaxGUI templates |
| Build and run | Eight language tasks, including debug/release, GUI, module builds and a toolchain version task |
| Language intelligence | The SDK's `bls` server: diagnostics, completion, hover, navigation, rename and other features **when supported by that server** |
| Older server compatibility | A small stdio bridge fixes stringified request IDs, older configuration requests and malformed capability fields |
| Debugging | A standalone DAP adapter for compiled debug executables: `DebugStop`, stack traces, locals, object fields, variable watches, continue and stepping |

The grammar intentionally accepts expressions permissively; the language server
provides semantic checking. Control-flow indentation uses line patterns. The
extension does not implement a compiler, formatter or substitute language server.

## Install locally

Requirements: Zed with extension API 0.7 support and Rust installed with rustup.
For development scripts, use host Node.js 22+ and pnpm 10.8.0.

`extension.toml` is the production manifest. It pins a public grammar commit and
can be used directly with **zed: install dev extension** from this directory.
Use `pnpm install --frozen-lockfile` and `pnpm build` for a standalone WASM build;
building does not modify the manifest.

The debugger and compatibility bridge are external tools, not part of the
extension binary. Published versions download `blitzmax-tools-v0.1.0.tar.gz`
from the `tools-v0.1.0` GitHub release on first use, then reuse a versioned cache
in Zed's work directory. A host Node on PATH is preferred; otherwise Zed's Node
runtime is used.

Before the first public tools release, or when editing those tools locally, set
this option under `lsp.blitzmax.initialization_options.blitzmax`:

```json
"toolsPath": "/absolute/path/to/zed-blitzmax/tools"
```

Alternatively set `BLITZMAX_TOOLS_PATH` in Zed's shell environment. An existing
debug-adapter executable override is also respected. A standards-compliant
language server can bypass the compatibility bridge with
`"useCompatibilityBridge": false` under the same BlitzMax options.

For local grammar changes, clone `tree-sitter-blitzmax` beside this checkout
and run `pnpm prepare:dev`. Install the generated `work/dev-extension` directory
as the dev extension. Its local grammar URL is confined to ignored staging;
the production manifest remains unchanged. Set `BLITZMAX_GRAMMAR_DIR` if the
grammar checkout is elsewhere. Update `toolsPath` in your project or user
settings when changing the tools directory.

Template snippets use numbered editable fields for project/file names and dates.
Zed does not expand VS Code named variables or transforms.

## Configure BlitzMax

Install [BlitzMax NG](https://blitzmax.org/downloads/). The language server is a
separate requirement: use `bin/bls` if your SDK supplies it, or configure a
standalone server. On Windows its executable is `bls.exe`. Some SDK releases
supply the compiler and builder without a language server.

The extension searches in this order:

1. `initialization_options.blitzmax.serverPath`, or the same key under `settings`.
2. `initialization_options.blitzmax.sdkPath`, or the same key under `settings`.
3. A usable `BMXPATH` installation.
4. A `bls` alongside `bmk` found on Zed's PATH.
5. `bls` on PATH.

Put this in your project's `.zed/settings.json` or your Zed user settings:

```json
{
  "lsp": {
    "blitzmax": {
      "initialization_options": {
        "blitzmax": {
          "serverPath": "/absolute/path/to/bls",
          "sdkPath": "/absolute/path/to/BlitzMax",
          "buildMode": "debug"
        }
      }
    }
  }
}
```

Replace the example paths with your installation paths, including `.exe` on
Windows where needed. Remove `serverPath` if your SDK contains the
server you want to use. For a locally built standalone server, use the absolute
path to this checkout's `.local/bin/bls` (or `.local/bin/bls.exe` on Windows).
The SDK root is the
directory containing `bin` and `mod`. No SDK is downloaded or upgraded by this
extension.

Use `serverArguments` beside `serverPath` for custom server arguments. Keep
`lsp.blitzmax.binary.path` and `binary.arguments` unset when using the bridge:
those are Zed-level overrides that bypass or replace the extension command.
`binary.env` can still supply additional environment variables.

Per-project settings are read for the current Zed worktree. Initialization options
are forwarded after removing extension-only server/tool controls. The current upstream server accepts options such as
`rootSourcePath`, `buildMode`, `targetPlatform`, `targetArchitecture`,
`conditionalSymbols`, `requireCoreInterface`, `useDependencySnapshots` and
`warnImplicitDefaultReturns` under `blitzmax`. Only send options your server
supports. For changes after startup, the matching `lsp.blitzmax.settings` object
is merged into workspace configuration. Restart the language server after
changing its executable, SDK or startup options.

The compatibility bridge uses the external tools bundle described above. Use
"useCompatibilityBridge": false for a standards-compliant server that does not
need the bridge.

### Build a standalone server

For an SDK without `bls`, the optional helper builds the upstream standalone
[BlitzMax language server](https://github.com/Hezkore/blitzmax-language-server):

```powershell
pnpm server:build /absolute/path/to/BlitzMax
```

Alternatively, set `BLITZMAX_SDK` to your SDK root and run `pnpm server:build`.
An SDK argument or that environment variable is required; the helper has no
machine-specific default.

It checks out a pinned upstream revision and its compiler frontend, applies the
upstream editor patch, enables binary stdio on Windows, and adds explicit
`Size_T` arguments for compatibility with the installed compiler. Everything
stays under ignored `.local/`, with build provenance in `.local/server-build.json`.
It does not copy a server into the SDK or change system settings. The standalone
server is an independent upstream application and is not part of the published
extension package. Keep its source and check its upstream terms separately if
redistributing it. This server supplies the diagnostics, hover, definition,
completion, rename and formatting exercised by the local integration checks.

The example Zed configurations are templates. Copy the three files in
`examples/.zed` ending in `.json.example` to the corresponding `.json` names,
then edit the SDK and server paths in `settings.json`. Put your SDK's `bin` on
Zed's PATH for the example tasks, or replace their `bmk` command with its full
path. The configured `.json` files are ignored and remain local to your checkout.
Open `examples` as a Zed project after configuring them.

### Older server compatibility

An older server reporting `0.4 build 146` was tested. It initializes
through the bridge, but exits when the integration test asks for document
symbols. This is a server limitation observed here, not a successful symbol or
diagnostics check. Its advertised capabilities contain synchronization and
document symbols only.

An alternative server reporting `v0.2` successfully answered completion requests
through the bridge. If using an SDK that supplies `lsp` instead of `bls`, set:

```json
"serverPath": "/absolute/path/to/lsp"
```

under `lsp.blitzmax.initialization_options.blitzmax` and select the SDK it belongs to. Full language features
require a more capable server, such as the locally built standalone server.
Syntax highlighting, snippets, tasks and the Tree-sitter outline work independently.

## Build and run programs

With a `.bmx` file open, run **task: spawn** and select a **BlitzMax:** task.
The task saves edited buffers and passes the active file to `bmk`. A runnable
indicator on a leading `Strict`/`SuperStrict` statement runs the debug task.

Put your SDK's `bin` on the PATH seen by Zed. Tasks use `bmk` on that PATH and
clear `BMXPATH` for that process, so `bmk` discovers its own installation rather
than an unrelated stale environment override. They do not inherit the language
server's `sdkPath`. For multiple SDKs, copy a language task into your project's
`.zed/tasks.json` and set `command` to the selected SDK's full `bmk` path.

Defaults use `-quick` and the compiler's native architecture. Remove `-quick`
to scan module dependencies; add `-g x64`, `-t gui`, `-l <platform>`, `-o <output>`
or other BMK options in project tasks as needed. Build a project's root source
file by replacing `$ZED_FILE` with `$ZED_WORKTREE_ROOT/main.bmx` in that task.

Compiler output remains in Zed's terminal. VS Code's problem matcher, build
options sidebar, progress UI and automatic jump to the first build error are
not ported. Live diagnostics come from the language server.

## Debugging

Build with `bmk makeapp -d`, add a `DebugStop` statement where execution should
stop, then launch the executable with the **BlitzMax** adapter. The external tools
bundle and Node.js are resolved as described under installation.

After configuring the example templates, open `examples` as a Zed project and
select its Windows debug configuration in `.zed/debug.json`. It builds
`debug.bmx` before launching `debug.exe`. The
same configuration works on Linux/macOS console builds after removing `.exe`
from its output and program paths. For a macOS GUI application, launch the
executable inside the `.app/Contents/MacOS` directory.

The adapter translates the same runtime commands as the VS Code extension.
It supports stack traces, locals, expanding object fields, variable-name watches,
continue, next, step in, step out and terminate. It launches existing executables;
the optional Zed debug `build` step handles compilation.

BlitzMax's runtime stops at compiled `DebugStop` statements. The adapter verifies
gutter breakpoints on those lines and explains why other lines are unverified.
It does not insert or remove source text. Removing a gutter marker does not
remove a compiled `DebugStop`. Pause, attach, arbitrary expression evaluation,
conditional breakpoints, stop-on-entry and multi-thread debugging are unsupported.
Programs using interactive standard input should be run as terminal tasks;
debug mode uses stdin for the runtime command protocol.

## Formatting and documentation

If your server advertises formatting, Zed can use it directly. Otherwise configure
an installed external formatter in your Zed settings:

```json
{
  "languages": {
    "BlitzMax": {
      "formatter": {
        "external": {
          "command": "bfm",
          "arguments": ["-stdin", "-stdout"]
        }
      }
    }
  }
}
```

This assumes a formatter on PATH with the `bfm` stdin/stdout interface; use its
absolute executable path if needed. The formatter is
not bundled. Hovers and signature help use the server's documentation when
available. The VS Code documentation sidebar and custom documentation commands
are not available in Zed; the [online language and API reference](https://blitzmax.org/docs/)
is the documentation fallback.

## Develop and verify

```powershell
pnpm grammar:generate
pnpm check
pnpm build

# Optional checks against an existing SDK:
$env:BLITZMAX_SDK = '/absolute/path/to/BlitzMax'
$env:BLITZMAX_LANGUAGE_SERVER = "$PWD/.local/bin/bls.exe"
pnpm test:integration
```

Generated parser sources are included in the separate grammar repository, so normal dev installation does not require
Tree-sitter generation. Tests cover corpus parsing, Zed query compilation,
outline captures, configuration, snippets, task definitions, fragmented DAP/LSP
transport, debug lifecycle and optional real SDK build/server/debug scenarios.
Rust native tests require a C compiler and the host Rust linker.

The implementation and adapted snippets are MIT-licensed. See `LICENSE` and
`THIRD_PARTY_NOTICES.md`.

## Publishing

Commit `extension.toml`, extension/tool source, queries, snippets, example
templates, lockfiles and license notices. Keep `.local/`, `work/`, compiler
outputs and configured example files ignored. External tool source in this
repository is built and distributed separately; it is not embedded in WASM or
copied into the development extension staging directory.

`pnpm tools:package` creates a standalone `.tar.gz` and checksum under
`work/releases/`. Publish those assets at the matching `tools-v0.1.0` release
before submitting the extension to Zed. The `release-tools.yml` workflow does
this when the matching tools tag is pushed. Increment `tools/package.json` and
`TOOLS_VERSION` in `src/lib.rs` together for subsequent external tool versions.

`pnpm build` and `pnpm release:check` reject local grammar URLs, floating grammar
revisions, mismatched tool versions and embedded adapter source. CI checks out
the exact public grammar revision from the production manifest, runs the tests
and build, and produces the external tools release artifacts.

The extension still requires a public source repository and a submission to
`zed-industries/extensions`. The manifest points at the intended
`EngiN33R/zed-blitzmax` repository. Preparing a build does not create that
repository, publish releases, or submit a registry pull request.
