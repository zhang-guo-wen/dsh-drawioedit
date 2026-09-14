# dsh-drawioedit

English | [中文](README.zh.md)

A **standalone** plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) that edits `.drawio` diagrams in the Web Sidebar, using the upstream [draw.io](https://github.com/jgraph/drawio) editor. Edits are written back to the file the tab opened.

This is the editing companion to [`dsh-drawio`](https://github.com/zhang-guo-wen/dsh-drawio), which renders `.drawio` files read-only with maxGraph. The two are independent: install either, or both.

> Not affiliated with or endorsed by draw.io Ltd. "draw.io" is a trademark of draw.io Ltd. This package embeds their Apache-2.0 licensed editor; see [NOTICE](NOTICE).

## What it does

- A `.drawio` file opens in a Sidebar tab running the full upstream editor.
- Every edit is written back to the same file: on change (within a second), and on **Ctrl+S**, the toolbar Save button, File → Save / Save As, and the editor's own "Unsaved changes. Click here to save." notice.
- The editor labels the diagram with the file's name instead of "Untitled Diagram".
- The editor boots without contacting any third-party host, so a diagram never leaves the machine.

## Why a second plugin

maxGraph is a *library*, and it is not the same renderer draw.io uses. A `.drawio` file stores only the edge endpoints and an `edgeStyle` name — never the routed waypoints — so each viewer computes the route itself, and the two diverge. The visible symptom is an edge label landing on top of a node's text. The editor here renders with draw.io's own code, so its output matches draw.io exactly.

| | `dsh-drawio` | `dsh-drawioedit` |
|---|---|---|
| Read-only preview | ✅ 1 MB bundle | — |
| Editing | — | ✅ upstream draw.io editor |
| Writes back to the file | — | ✅ |
| Rendering fidelity | good | exact |
| Deployed size | ~1 MB | ~119 MB |

## Status

Every step is verified. The browser-driven suites are the evidence: `tests/boot.mjs` loads the editor exactly as the pane does and asserts what a user would see, and `tests/offline.mjs` asserts what the browser actually requested.

| Piece | State |
|---|---|
| The editor boots to its canvas and draws the diagram it was given | ✅ verified in a browser |
| Every editor asset the boot asks for exists (no 4xx) | ✅ verified in a browser |
| Edits are reported to the pane and written back to the file | ✅ verified in a browser (`reports`, `saved`) |
| Save commands write the file back instead of opening drawio's download flow | ✅ verified in a browser and in the shim suite |
| The diagram is labelled with the file's name | ✅ verified in a browser |
| A menu opens at its menu bar, inside the pane | ✅ verified in a browser |
| The editor contacts no remote host on boot | ✅ verified (browser network log) |
| Save endpoint with a version guard (`replaceIfVersion`) | ✅ verified (HTTP) |

### Restart or refresh?

The plugin is two halves, and they update differently.

| Half | What it is | How a change reaches the browser |
|---|---|---|
| Client bundle (`lib/client.js`) | the tab type, the iframe body, the save transport | hot-swapped by the harness, or a page refresh |
| Host half (`lib/index.mjs`) | the editor route, the save endpoint, **and the shim source** | **restart `dsh web`** |

The shim is host-half code: the host serves it from memory, so editing `src/shim.ts` changes nothing until the host restarts. That is easy to mistake for a broken editor, which is why the shim reports its own revision — `window.__dshShimState.revision` answers "which shim am I running".

## Install

```sh
cd "$DSH_HOME/profiles/web"
pnpm add link:C:/path/to/this-repo          # or: npm install <path-or-git-url>
```

Then register it as a profile bundle, in **both** lists of that profile's `package.json`:

```jsonc
{
  "dsh": { "profile": { "bundles": ["@zhang-guo-wen/dsh-drawioedit"] } },
  "dependencies": { "@zhang-guo-wen/dsh-drawioedit": "link:C:/path/to/this-repo" }
}
```

Verify the composition before booting:

```sh
dsh --profile web --dump-config | grep -A2 drawioedit
```

## How the editor is driven

The editor is an application, not a component, so it runs in an iframe served from the application origin. Same-origin is required — a cross-origin parent cannot reach the iframe at all.

**Load.** drawio's bootstrap reads URL parameters from a `#P` hash whose JSON may carry the diagram as a `hash` field, which it then restores as the real `location.hash` (`#R` + encoded XML):

```
/plugins/dsh-drawioedit/editor/index.html#P{"client":"1","hash":"#R<encoded xml>","dshTitle":"name.drawio"}
```

A bare `#R` hash is ignored, so both layers are required. `dshTitle` carries the file's name for the shim; drawio's own `title` parameter is not used for that, because drawio percent-decodes it and a file name may contain a percent sign.

**Save.** The shim reports each change as `{event:'autosave', xml}`, and the tab body POSTs it to `/plugins/dsh-drawioedit/save`. That endpoint writes through `ctx.fs` with the version the read observed as a freshness guard, so an agent write that landed while the editor was open is refused rather than overwritten. A confirmed write is sent back into the editor as `{action:'saved'}`, which is what turns drawio's own "Unsaved changes" notice into "All changes saved".

### Why a shim is needed

drawio's `#create=` handshake cannot be used from a same-origin iframe: its message listener returns before doing anything unless `evt.source == (window.opener || window.parent)` (App.js), an identity check written for the popup window its embed code opens. The editor also keeps its instance in a closure — the DOM carries no reference and no global exposes it, and `window.EditorUi` does not exist yet when the shim runs.

So the shim intercepts the assignment of `window.EditorUi` and captures the instance when it is constructed. The wrapper is a `Proxy` that forwards, never a function that copies: drawio assigns the class global *before* it finishes the class, the `mxEventSource` mixin replaces the prototype moments later, and a wrapper holding the prototype it saw at assignment time leaves every subclass constructed without `setEventSource` — which stops the editor on its splash page.

With the instance captured, the shim:

- reports edits as `{event:'autosave', xml}` and loads a diagram sent as `{action:'create', data}`;
- **owns `ui.saveFile`**, the one method every save command funnels into. Replacing the *actions* is not enough: the File menu captured its action when the menu was built, before the shim had an instance. Export as still produces a copy, which is where a copy belongs;
- names the diagram after the file the pane opened;
- keeps the document free of a scroll position and keeps an open popup inside the frame, because drawio fits popups against the document it measures.

The shim is injected at serve time, between `bootstrap.js` and `main.js`, so the vendored editor files stay pristine and the change lives in one place. **This depends on drawio internals**: a drawio upgrade that renames `EditorUi`, `saveFile`, or `getFileData` breaks it. The `shim` suite fails loudly if the source stops parsing or the hook stops capturing, but it cannot detect a renamed private API — `boot.mjs` is what notices, because it asserts the editor's end state in a browser.

### Nothing leaves the machine

The editor is served from the application origin and boots without any third-party request. That was not true by default: drawio loads a third-party SDK over the network for each of its cloud integrations unless told otherwise. Every one of them is switched off by name in `src/params.ts`, and the `offline` suite fails if any remote host is contacted while the editor boots.

## Tests

`npm test` runs eight keyless suites. Two of them drive a real headless Chrome, which they look for at their platform's default location; set `CHROME_PATH` to a Chrome or Chromium executable if it is installed elsewhere.

| Suite | What it proves |
|---|---|
| `artifact` | both committed bundles are at least as new as their sources |
| `smoke` | the built client bundle loads with a module table holding only `react`, and registers its tab type and body |
| `serve` | the editor route serves real files, rejects traversal, and injects the shim in the right place |
| `save` | the save endpoint guards writes with `replaceIfVersion` and refuses malformed requests |
| `shim` | the shim parses, hooks the editor class, captures an instance, reports edits, and owns the save funnel |
| `shimdelivery` | the shim reaches the editor through the plugin route, before the script that defines it |
| `boot` | the editor boots to its canvas, draws the diagram, reports it, names it, and opens a menu at its menu bar |
| `offline` | the editor boots having contacted no remote host, and every asset it asks for exists |

`offline`'s "every asset it asks for exists" is not decoration: `editor/mxgraph/css/common.css` was missing from this checkout, and it is the only place `div.mxPopupMenu { position: absolute }` is declared. Without it drawio's popup coordinates are ignored and every menu flows into the page below the toolbar. Nothing else failed — the editor still booted — so the 4xx assertion is what caught it.

`tests/debug/` holds browser-driving and bundle-scanning tools used while developing the embed protocol. They are not part of the suite, and `tests/debug/scan-assets.mjs` is deliberately noisy: most of what it reports are stencil icon names drawio resolves inside its own shape libraries.

## Diagnostics

Drop the editor frame in DevTools and read `window.__dshShimState`:

| Field | Meaning |
|---|---|
| `revision` | which shim the browser is running; it is host-half code, so this catches a stale host |
| `hooked` / `installs` | the class was intercepted and an instance captured (`installs` ≥ 1) |
| `reports` | the editor read the diagram and reported it — an edit or a save |
| `saved` | the host confirmed a write; without it drawio keeps saying "Unsaved changes" |
| `keys` | the Ctrl+S safety net saw the key |
| `errors` / `lastError` | reading the diagram threw, which every caller would otherwise swallow as "nothing changed" |
| `saveFileOwned` | the shim owns the save funnel; it must be `true` |
| `rebound` | what the shim patched: `save`, `saveAs`, `saveFile`, `mxUtils.fit` |

## Layout

```
editor/                      upstream draw.io webapp, trimmed (119 MB)
src/index.ts                 host half: the editor route and the save endpoint
src/serve.ts                 serves the editor, injects the shim, rejects traversal
src/save.ts                  the save endpoint and its version guard
src/shim.ts                  the shim source and its revision
src/params.ts                the editor URL: the integration opt-outs and the file name
src/client/index.ts          registers the tab type and the body
src/client/EditorBody.tsx    the iframe, the message bridge, the write serialisation
src/client/editor.ts         message parsing, base64 decoding, the save request
src/client/transports.ts     the file reader and save transport
tests/boot.mjs               drives the editor in headless Chrome and asserts what a user sees
tests/offline.mjs            boots the editor and asserts what the browser requested
tests/chrome.mjs             which browser the two browser-driven suites launch
build-client.mjs             bundles the browser half into the loader handoff
cordis.patch.yml             the composition row this package inserts
```

`editor/` is trimmed from the upstream webapp by dropping `WEB-INF/` (Java jars), `js/integrate.min.js`, the service worker, and the legacy unminified `mxgraph/src` sources — 148.6 MB down to 119.0 MB. `mxgraph/css/common.css` is kept, for the reason above.

## Build

```sh
npm install
npm run build      # host half via tsdown, browser half via build-client.mjs
npm run typecheck  # tsc against the PUBLISHED @deepseek-ai/* packages
npm test           # eight keyless suites, two of which drive a browser
```

`lib/` is committed so this repository installs from git without a build step.

### Why the browser half has its own bundler

The harness monorepo builds its client bundles with `packages/client/tsdown.client.ts`, which is not published. `platform: 'browser'` is stated explicitly here: under rolldown's `node` platform a dependency whose `exports` lists a platform condition before `import` gets its *server* entry inlined, and that entry can `require("module")` at module scope — a specifier the browser module table cannot answer.

## License

Apache-2.0. The bundled editor is Apache-2.0 with additional terms on its icon sets and stencil libraries; see [NOTICE](NOTICE).
