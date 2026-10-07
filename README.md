# dsh-drawioedit

English | [中文](README.zh.md)

A trimmed upstream draw.io editor integrated into the DeepSeek Harness Web Sidebar, with offline `.drawio` editing and automatic saving back to the original file.

![A .drawio diagram open in the sidebar editor](docs/example.png)

## Install

```sh
npx @deepseek-ai/dsh plugin --profile web add @guowenzhang/dsh-drawioedit
```

Restart the host after installation.

## What this plugin adds

- **Sidebar integration**: connects the upstream editor to the DSH file tree and sidebar tabs to edit workspace `.drawio` files directly. Chinese file names display correctly, with no separate online editor or diagram upload required.
- **Package trimming**: removes server-side Java resources, uncompressed development sources, specialist stencil packs, and their icons and templates. Rebuilds a trimmed stencil bundle and cleans the template index while retaining everyday drawing tools. The trimmed local package is **12.1 MB compressed / 42.7 MiB unpacked** (`npm pack --dry-run`; the published version may differ).
- **Automatic saving**: bridges the editor to the host's file service, detects diagram changes, and writes them back to the original file without exporting, downloading, and replacing it manually. Saves run sequentially, retaining only the newest pending changes; successful writes update the editor's saved status.
- **Permission and conflict protection**: saves respect the session's workspace permissions and check file versions to avoid silently overwriting changes made by an agent or another program while the editor is open. Permission denials, version conflicts, and other save failures are shown in the tab.
- **Offline operation**: bundles the editor resources and disables cloud integrations, so startup does not load third-party services.

## Usage

1. Open a `.drawio` file from the file tree to enter the sidebar editor.
2. Edit the diagram. Changes are saved automatically to the original file; check the editor for its saved status.
3. **Save / Ctrl+S** triggers a manual save, **Save As** renames the file in its current directory, and **Export as** downloads a copy.

## Retained shapes and limitations

General and basic shapes, arrows, flowcharts, ER, UML, BPMN, DFD, C4, freehand drawing, and sketch styling are available. Specialist cloud and network stencil packs are excluded; diagrams using them may display incorrectly.

## License

Apache-2.0. See [NOTICE](NOTICE) for bundled editor terms. Not affiliated with draw.io Ltd. Build and troubleshooting details are in [AGENTS.md](AGENTS.md).
