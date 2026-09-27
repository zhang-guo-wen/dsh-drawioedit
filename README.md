# dsh-drawioedit

English | [中文](README.zh.md)

## Background: DeepSeek Harness

DeepSeek Harness (`dsh`) is the open-source agent harness from DeepSeek AI, where nearly every capability is a plugin on [Cordis](https://github.com/cordiverse/cordis). It is in **developer preview** and iterating fast, so expect compatibility-breaking changes ([docs](https://deepseek-harness.github.io/deepseek-harness/), `0.1.7-alpha.*`); this plugin is a standalone third-party package that resolves `@deepseek-ai/*` from the running host.

## The problem this plugin solves

There was no way to edit a `.drawio` diagram inside DSH; this plugin opens it in the upstream draw.io editor in the Sidebar and writes every edit back to the same file.

## Screenshots

![The upstream draw.io editor with a .drawio file open](docs/example.png)

The capture shows the vendored editor in a tab: `example.drawio` in the title bar with `All changes saved` after a write, draw.io's own shape panel on the left, and the file's diagram on the canvas.

## Install

```sh
npx @deepseek-ai/dsh plugin --profile web add @guowenzhang/dsh-drawioedit
```

From the npm registry: <https://www.npmjs.com/package/@guowenzhang/dsh-drawioedit> — restart the host afterwards; local checkouts, git sources and troubleshooting are in [AGENTS.md](AGENTS.md).

## Usage

### Open a diagram in a tab

Clicking a `.drawio` file in the file tree opens a Sidebar tab running the full upstream draw.io editor, labelled with the file's name instead of "Untitled Diagram". The tab has draw.io's own menus, toolbar, and shape panel; the file is read from the session's workspace, and nothing is written until you change something.

### Save as you work

Every edit is written back to the same file the tab opened:

| Action in the editor | What happens |
|---|---|
| Any edit | Written back within a second, with no dialog |
| **Ctrl+S** | Written back immediately |
| The toolbar **Save** button | Written back immediately |
| **File → Save** and **File → Save As** | Written back to that same file |
| The editor's own "Unsaved changes. Click here to save." notice | Written back immediately |

**Export as** still downloads a copy, which is where a copy belongs. A write counts as saved only when the host confirms it, and that is when drawio's notice turns into "All changes saved"; if a write is refused — an agent edited the same file while the tab was open — the tab shows the reason above the editor instead of letting it claim success.

### Know which file you are editing

The diagram is named after the file the tab opened, so draw.io's title bar shows `example.drawio` rather than "Untitled Diagram". The tab holds exactly one file, so **Save As** writes that file back rather than creating a second one, and `Export as` is the way out of the workspace.

## Notes and caveats

- **The package is about 119 MB**, against about 1 MB for the read-only [dsh-drawio](https://github.com/zhang-guo-wen/dsh-drawio): the download carries the whole vendored editor.
- **It depends on draw.io internals.** The editor is driven by a small script injected into its page, which hooks the editor class and the one method every save command funnels into; a draw.io upgrade that renames either breaks editing until this plugin follows. The mechanism, field by field, is in [AGENTS.md](AGENTS.md).

## License

Apache-2.0. The bundled editor is Apache-2.0 with additional terms on its icon sets and stencil libraries; see [NOTICE](NOTICE).

Not affiliated with or endorsed by draw.io Ltd. "draw.io" is a trademark of draw.io Ltd. This package embeds their Apache-2.0 licensed editor.

## Further reading

- [AGENTS.md](AGENTS.md) — installation variants, the build, the iframe protocol, the vendored editor, the test suites, and troubleshooting.
- [dsh-drawio](https://github.com/zhang-guo-wen/dsh-drawio) — the sibling preview plugin: read-only, maxGraph, about 1 MB instead of 119 MB.
- [docs/example.drawio](docs/example.drawio) — the diagram in the screenshot, if you want a file to try editing.
- [DeepSeek Harness documentation](https://deepseek-harness.github.io/deepseek-harness/).
