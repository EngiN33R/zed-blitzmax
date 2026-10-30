# Third-party notices

This extension is modelled after [Hezkore/vscode-blitzmax-support](https://github.com/Hezkore/vscode-blitzmax-support).
The reference checkout used was `4cf4f857257390c67b83a44b99dc67fdef2de46a`.

- `snippets/blitzmax.json` is adapted from its snippet file. VS Code comment
  variables are replaced with BlitzMax comment delimiters.
- The debugger's command mapping and runtime event/stack/variable interpretation
  are adapted from `src/bmxruntime.ts` and `src/bmxdebugger.ts`. The standalone
  implementation uses Node built-ins and does not import the VS Code runtime.
- Server configuration keys and compiler task options follow the same reference.

The upstream copyright and MIT permission notice are retained in `LICENSE`.
Zed's extension API is distributed under Apache-2.0. Tree-sitter and its CLI are
MIT-licensed. Cargo and pnpm lockfiles record build dependencies.

`scripts/build-server.mjs` optionally downloads and builds the independent
upstream `Hezkore/blitzmax-language-server` application with its `bmx-ng/bcc`
frontend. Those checkouts and build outputs live in ignored `.local/`, are not
vendored as extension source, and are not included in registry publication.

The debugger, compatibility bridge and shared transport are distributed as a
separate versioned tools release. Its archive includes this notice and LICENSE.
