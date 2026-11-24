# Markdown Vista

Enhances VS Code's **built-in** Markdown preview instead of replacing it.

Derived from the rendering and diagram-viewer core of
[Moji](https://github.com/alexishida/Moji), a desktop Markdown viewer.

## What it adds

| | |
|---|---|
| **Mermaid diagrams** | ```` ```mermaid ```` fences render as diagrams (Mermaid 11), themed to your color theme and re-rendered when you switch themes. An invalid diagram degrades to a normal code block carrying the parser's own error and line number. Mermaid is loaded only when a document actually contains a diagram. |
| **Zoom / pan viewer** | Click any diagram, image or display formula: a resizable viewer with 10%–1000% zoom, drag-to-pan, a navigation minimap, keyboard control, PNG and SVG export, and the Mermaid source behind the diagram. |
| **Code blocks** | A copy button on every block, and a fold control on blocks longer than 60 lines so a long configuration listing stops burying the prose around it. |
| **Document references** | Plain-text mentions of another Markdown file — `《design.md》` by default, the pattern is configurable — become links that open the file. |
| **Breadcrumb** | A bar at the top of the preview showing the path of the section being read; click any level to jump to it. |
| **Section folding** | A fold control on every heading collapses that section in the preview. Independent of the drawer's collapsed branches, so navigating the outline never hides the text. |
| **Reading width** | An optional cap on body-text width; code, tables and diagrams keep the full pane. |
| **Export** | `Markdown Vista: Export to Self-Contained HTML` writes one HTML file with diagrams rendered and images inlined, for people who do not have VS Code. |
| **Insert table of contents** | `Markdown Vista: Insert Table of Contents` writes a linked outline into the document itself, for renderers that have no drawer. |
| **Table of contents** | A left drawer with the nested heading outline: click to jump, filter by name, collapsible branches, and the current section highlights as you scroll. It reserves space beside the text on a wide pane and floats over it on a narrow one. Drag its edge to resize; open state, width and collapsed branches are remembered. |
| **Extended syntax** | `==mark==`, `++ins++`, `~sub~`, `^sup^`, footnotes, definition lists, abbreviations, `:emoji:`. |

## What it deliberately does **not** add

VS Code's preview already does these, and a second implementation would conflict:

- **Math** — KaTeX has been built in since VS Code 1.72 (`markdown.math.enabled`).
- **Section navigation in the editor** — the Outline view, breadcrumbs and `Ctrl/Cmd+Shift+O` already work on Markdown headings. The table of contents above lives *inside the preview*, for when the preview is the thing you are reading.
- **Scroll sync, theming, security policy, image paths, syntax highlighting** — all owned by the built-in preview. Mermaid blocks keep their `data-line` so they stay in sync with the editor.

## Install

```bash
code --install-extension markdown-vista-0.6.0.vsix
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

## Keyboard (table of contents)

With the filter box focused:

| Key | Action |
|---|---|
| `↑` `↓` | move through the filtered headings |
| `Enter` | jump to the highlighted heading |
| `Esc` | clear the filter, then close the drawer |

## Settings

| Setting | Default | |
|---|---|---|
| `markdownVista.mermaid.enabled` | `true` | render mermaid fences |
| `markdownVista.extendedSyntax.enabled` | `true` | mark/ins/sub/sup/footnotes/deflist/abbr/emoji — **needs a window reload** |
| `markdownVista.toc.enabled` | `true` | show the table-of-contents button |
| `markdownVista.toc.openByDefault` | `false` | open the drawer for a preview that has no remembered state yet |
| `markdownVista.toc.maxLevel` | `6` | deepest heading level listed |
| `markdownVista.toc.jumpStrategy` | `guard` | `guard` scrolls and holds the position; `anchor` hands navigation to the built-in preview |
| `markdownVista.mermaid.errorDetails` | `true` | show the parser error on a failed diagram |
| `markdownVista.code.copyButton` | `true` | copy button on code blocks |
| `markdownVista.code.foldOver` | `60` | fold code blocks longer than this; `0` disables |
| `markdownVista.docLinks.enabled` | `true` | link plain-text document references |
| `markdownVista.docLinks.pattern` | `《([^》]+?\.md)》` | what a reference looks like; group 1 is the path |
| `markdownVista.reading.maxWidth` | `0` | cap body-text width in pixels; `0` uses the full pane |
| `markdownVista.breadcrumb.enabled` | `true` | current-section bar at the top |
| `markdownVista.sectionFolding.enabled` | `true` | fold controls on headings |
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

## Commands

| Command | |
|---|---|
| `Markdown Vista: Export to Self-Contained HTML` | One HTML file: diagrams rendered to SVG, images inlined as data URIs, styles embedded. A render window opens briefly — that is where Mermaid runs. KaTeX formulas are exported without KaTeX's stylesheet, so math is the one thing that does not survive. |
| `Markdown Vista: Insert Table of Contents` | Writes a linked outline at the cursor, wrapped in `<!-- markdown-vista-toc -->` markers. Running it again updates that block in place. |

## Conflicts

Disable other extensions that also render Mermaid or math in the Markdown preview
(*Markdown Preview Mermaid Support*, *Markdown+Math*, …). Multiple
`extendMarkdownIt` contributions stack, and two Mermaid renderers will fight over
the same fence.

## Develop

```bash
npm install
npm run build          # dist/extension.js + media/{preview,mermaid,export-runner}.js
npm run typecheck
npm test               # markdown-it pipeline + host helper tests
npm run verify         # asserts the built artefacts (bundling, CSP, fallbacks)
npm run harness        # browser harness for media/preview.js
npm run package        # → markdown-vista-<version>.vsix
```

Press `F5` in VS Code to launch an Extension Development Host.

### Architecture

```
src/extension.ts        activate() → { extendMarkdownIt }   (extension host, Node)
src/host/               commands that need the workspace: export, insert TOC
src/markdown-plugins.ts markdown-it plugins + mermaid fence + config bridge
src/preview/main.ts     entry point for the preview webview  (bundled to media/preview.js)
src/preview/navigate.ts heading jumps + the position guard, shared by drawer and breadcrumb
src/preview/headings.ts heading collection shared by drawer, breadcrumb and folding
src/preview/mermaid.ts  client-side Mermaid rendering + cache + theme refresh
src/preview/viewer.ts   zoom/pan/minimap/export viewer
src/preview/toc.ts      in-preview table of contents
media/preview.css       --vscode-* themed styles
```

Settings reach the preview through a `data-markdown-vista-config` attribute injected into
the rendered HTML, since the preview script cannot read the VS Code API.

Mermaid ships as a second IIFE (`media/mermaid.js`) that publishes itself on
`window`, injected as a plain `<script>` only when a document contains a
diagram — esbuild's code splitting would emit ESM whose relative imports
resolve against the `vscode-webview://` origin and fail. The loader copies the
preview's nonce so a nonce-based content security policy still admits it.
`npm run verify` asserts the split and the size of the always-loaded script.

Export renders in a webview the extension creates itself, which — unlike the
built-in preview — has a message channel back to the host. That is the only way
to get Mermaid SVG out of a browser and into a file.

## License

MIT
