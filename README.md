# Markdown Vista

Enhances VS Code's **built-in** Markdown preview instead of replacing it.

Derived from the rendering and diagram-viewer core of
[Moji](https://github.com/alexishida/Moji), a desktop Markdown viewer.

## What it adds

| | |
|---|---|
| **Mermaid diagrams** | ```` ```mermaid ```` fences render as diagrams, themed to your color theme, re-rendered when you switch themes. An invalid diagram degrades to a normal code block. |
| **Zoom / pan viewer** | Click any diagram, image or display formula: a resizable viewer with 10%–1000% zoom, drag-to-pan, a navigation minimap, keyboard control and PNG export. |
| **Table of contents** | A button in the top-right corner of the preview opens a nested heading outline: click to jump, collapsible branches, and the current section highlights as you scroll. |
| **Extended syntax** | `==mark==`, `++ins++`, `~sub~`, `^sup^`, footnotes, definition lists, abbreviations, `:emoji:`. |

## What it deliberately does **not** add

VS Code's preview already does these, and a second implementation would conflict:

- **Math** — KaTeX has been built in since VS Code 1.72 (`markdown.math.enabled`).
- **Section navigation in the editor** — the Outline view, breadcrumbs and `Ctrl/Cmd+Shift+O` already work on Markdown headings. The table of contents above lives *inside the preview*, for when the preview is the thing you are reading.
- **Scroll sync, theming, security policy, image paths, syntax highlighting** — all owned by the built-in preview. Mermaid blocks keep their `data-line` so they stay in sync with the editor.

## Install

```bash
code --install-extension markdown-vista-0.4.0.vsix
```

Then open any Markdown file and hit the preview (`Cmd/Ctrl+Shift+V`).

## Keyboard (viewer)

| Key | Action |
|---|---|
| `Esc` | close |
| `←` `→` | previous / next graphic |
| `+` `-` | zoom step |
| `0` | fit to view |
| wheel | zoom |
| drag | pan |

## Settings

| Setting | Default | |
|---|---|---|
| `markdownVista.mermaid.enabled` | `true` | render mermaid fences |
| `markdownVista.extendedSyntax.enabled` | `true` | mark/ins/sub/sup/footnotes/deflist/abbr/emoji — **needs a window reload** |
| `markdownVista.toc.enabled` | `true` | show the table-of-contents button |
| `markdownVista.toc.openByDefault` | `false` | open the panel when a preview opens |
| `markdownVista.toc.maxLevel` | `6` | deepest heading level listed |
| `markdownVista.viewer.enabled` | `true` | click-to-zoom |
| `markdownVista.viewer.includeImages` | `true` | include plain images |
| `markdownVista.viewer.includeMath` | `true` | include display formulas |
| `markdownVista.viewer.minimap` | `true` | minimap while zoomed in |
| `markdownVista.viewer.pngExport` | `auto` | `auto` / `download` / `clipboard` / `off` |

### About PNG export

A `markdown.previewScripts` script has **no message channel back to the extension**
(the built-in preview already consumed `acquireVsCodeApi()`), so it cannot open a
save dialog. Export therefore uses a `blob:` download, and — because a download
blocked by the preview's content security policy fails silently — always offers
*Copy to clipboard* as a one-click fallback. Set `markdownVista.viewer.pngExport` to
`clipboard` if downloads do not work in your setup.

Display formulas cannot be exported (rasterizing them would need the preview's
stylesheet inside the canvas); the button hides for those.

## Troubleshooting

If the preview shows no diagrams or no table-of-contents button, run
**Developer: Open Webview Developer Tools** from the command palette and inspect
`window.markdownVista` in the console:

| Result | Meaning |
|---|---|
| `undefined` | The preview script never loaded — the extension is not active, or an older version is installed. Check the version in the Extensions view and reload the window. |
| `{ version: "…" }` | The version actually running. If it is older than the VSIX you installed, reload the window. |
| `refreshes: 0` | The script loaded but never ran a pass. Report it. |
| `errors: [...]` | A subsystem failed; the message names which one. |
| `tocCorrections` high | Something keeps scrolling the preview away after a heading jump. Almost always the preview↔editor scroll sync: set `"markdown.preview.scrollPreviewWithEditor": false` to confirm. |

Installing a new VSIX always needs **Developer: Reload Window** before the
preview picks up the new scripts and styles.

## Conflicts

Disable other extensions that also render Mermaid or math in the Markdown preview
(*Markdown Preview Mermaid Support*, *Markdown+Math*, …). Multiple
`extendMarkdownIt` contributions stack, and two Mermaid renderers will fight over
the same fence.

## Develop

```bash
npm install
npm run build          # dist/extension.js + media/preview.js
npm run typecheck
node scripts/test-render.mjs   # markdown-it pipeline tests
npm run verify         # asserts the built artefacts (bundling, CSP, fallbacks)
npm run harness        # browser harness for media/preview.js
npm run package        # → markdown-vista-<version>.vsix
```

Press `F5` in VS Code to launch an Extension Development Host.

### Architecture

```
src/extension.ts        activate() → { extendMarkdownIt }   (extension host, Node)
src/markdown-plugins.ts markdown-it plugins + mermaid fence + config bridge
src/preview/main.ts     entry point for the preview webview  (bundled to media/preview.js)
src/preview/mermaid.ts  client-side Mermaid rendering + cache + theme refresh
src/preview/viewer.ts   zoom/pan/minimap/export viewer
src/preview/toc.ts      in-preview table of contents
media/preview.css       --vscode-* themed styles
```

Settings reach the preview through a `data-markdown-vista-config` attribute injected into
the rendered HTML, since the preview script cannot read the VS Code API.

The preview bundle is built as a single IIFE with `splitting: false` so
esbuild inlines `import('mermaid')`. A surviving chunk would be requested
against the `vscode-webview://` origin and fail — `npm run verify` asserts this.

## License

MIT
