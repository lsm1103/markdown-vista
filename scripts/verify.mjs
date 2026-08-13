/**
 * Static checks for the three failure modes that make a Markdown-preview
 * extension silently do nothing. Each one is a real risk that cannot be caught
 * by a type check, so it is asserted against the built artefacts instead.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checks = []

function check(name, detail, ok) {
  checks.push({ name, detail, ok })
}

function size(path) {
  return `${(statSync(path).size / 1024).toFixed(0)} KB`
}

// --- 1. Mermaid must be inlined into one IIFE, with no chunk to fetch -------

const previewPath = resolve(root, 'media/preview.js')
const preview = readFileSync(previewPath, 'utf8')
const mediaScripts = readdirSync(resolve(root, 'media')).filter((file) => file.endsWith('.js'))

check(
  'preview bundle is a single file',
  `media/ contains: ${mediaScripts.join(', ')} (${size(previewPath)})`,
  mediaScripts.length === 1 && mediaScripts[0] === 'preview.js'
)
check(
  'no runtime dynamic import survives bundling',
  'a surviving import() would resolve against vscode-webview:// and fail',
  !/\bimport\s*\(/.test(preview)
)
check(
  'no bare ESM import/export in the IIFE',
  'the preview loads it as a classic script, not a module',
  !/^\s*(import|export)\s/m.test(preview)
)
check('mermaid is bundled in', 'searching for a mermaid runtime marker', /mermaid/i.test(preview))
check(
  'mermaid runs in strict security mode',
  'securityLevel: strict — the preview sanitizes diagram output',
  preview.includes('strict')
)

check(
  'our own chrome is excluded from the zoomable set',
  'the toolbar/outline icons are inline SVG; without this they zoom themselves',
  preview.includes('.markdown-vista-toc-toggle') &&
    preview.includes('.markdown-vista-viewer, .markdown-vista-toc')
)
// Asserted against the source, not the bundle: Mermaid legitimately uses
// animation frames internally, so a bundle-wide grep would always trip.
const previewMain = readFileSync(resolve(root, 'src/preview/main.ts'), 'utf8')
check(
  'the refresh loop is not driven by requestAnimationFrame',
  'a hidden webview gets no animation frames — a preview opened in a background editor group would never render',
  !/requestAnimationFrame\s*\(/.test(previewMain)
)

// Comments are stripped first — they explain precisely the markup we must not
// emit, and would otherwise trip the check they document.
const tocSource = readFileSync(resolve(root, 'src/preview/toc.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
check(
  'table-of-contents entries are buttons, not anchors',
  'an <a href="#…"> is claimed by the built-in preview\'s link handling and scrolls the document away',
  !/<a\b[^>]*href=/.test(tocSource)
)

// --- 2. No external resource may be requested (the preview CSP blocks it) ---

const cssPath = resolve(root, 'media/preview.css')
const css = readFileSync(cssPath, 'utf8')
const externalUrls = css.match(/url\(\s*['"]?(https?:)?\/\//g) ?? []

check(
  'stylesheet requests nothing off-host',
  externalUrls.length ? `found: ${externalUrls.join(', ')}` : `media/preview.css (${size(cssPath)}), no url() to a remote host`,
  externalUrls.length === 0
)
check(
  'no @import of a remote stylesheet',
  'KaTeX fonts are not shipped — VS Code renders math itself since 1.72',
  !/@import\s+url\(\s*['"]?https?:/.test(css)
)
check(
  'stylesheet is theme-driven',
  `${(css.match(/var\(--vscode-/g) ?? []).length} references to --vscode-* tokens`,
  (css.match(/var\(--vscode-/g) ?? []).length > 20
)

// --- 3. PNG export must degrade instead of failing silently ----------------

check(
  'PNG export has a clipboard fallback',
  'a download blocked by the preview CSP fails silently, so the toast offers the clipboard',
  preview.includes('clipboard') && preview.includes('ClipboardItem')
)
check(
  'PNG export uses a blob URL, not a data: navigation',
  'blob: downloads are far likelier to survive the preview CSP',
  preview.includes('createObjectURL')
)

// --- Extension host bundle -------------------------------------------------

const extensionPath = resolve(root, 'dist/extension.js')
const extension = readFileSync(extensionPath, 'utf8')
const externalRequires = [...extension.matchAll(/require\(["']([^"']+)["']\)/g)]
  .map((match) => match[1])
  .filter((id) => id !== 'vscode' && !id.startsWith('node:'))

check(
  'extension bundle only requires vscode',
  externalRequires.length
    ? `unbundled: ${[...new Set(externalRequires)].join(', ')}`
    : `dist/extension.js (${size(extensionPath)}), markdown-it plugins are bundled`,
  externalRequires.length === 0
)
check(
  'extension exposes extendMarkdownIt',
  'the markdown.markdownItPlugins contract',
  extension.includes('extendMarkdownIt')
)

// --- Manifest wiring -------------------------------------------------------

const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const contributes = manifest.contributes ?? {}

check(
  'manifest declares the three preview contribution points',
  'markdownItPlugins + previewScripts + previewStyles',
  contributes['markdown.markdownItPlugins'] === true &&
    Array.isArray(contributes['markdown.previewScripts']) &&
    Array.isArray(contributes['markdown.previewStyles'])
)
check(
  'manifest does not ship a competing math renderer',
  'VS Code renders KaTeX itself; a second renderer would double-render',
  !Object.keys(manifest.dependencies ?? {}).some((name) => /katex/i.test(name))
)

// --- Report ----------------------------------------------------------------

let failed = 0
for (const { name, detail, ok } of checks) {
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}\n        ${detail}`)
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
