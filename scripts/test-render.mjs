/**
 * Exercises the markdown-it side against a stand-in for VS Code's engine.
 * `markdown-it` is a devDependency here only — at runtime VS Code owns the
 * instance and hands it to `extendMarkdownIt`.
 */
import { build } from 'esbuild'
import MarkdownIt from 'markdown-it'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = mkdtempSync(join(tmpdir(), 'markdown-vista-test-'))
const outfile = join(outDir, 'plugins.mjs')

await build({
  entryPoints: [resolve(root, 'src/markdown-plugins.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['markdown-it'],
  logLevel: 'silent'
})

const { applyMarkdownVistaPlugins } = await import(pathToFileURL(outfile).href)

const settings = new Map(
  Object.entries({
    'extendedSyntax.enabled': true,
    'mermaid.enabled': true,
    'viewer.enabled': true,
    'viewer.includeImages': true,
    'viewer.includeMath': true,
    'viewer.minimap': true,
    'viewer.pngExport': 'auto',
    'toc.enabled': true,
    'toc.openByDefault': false,
    'toc.maxLevel': 6
  })
)
const config = { get: (key, fallback) => (settings.has(key) ? settings.get(key) : fallback) }

const md = applyMarkdownVistaPlugins(new MarkdownIt({ html: true, linkify: true }), () => config)

const failures = []
function expect(name, condition, detail = '') {
  if (condition) console.log(`  ok   ${name}`)
  else {
    failures.push(name)
    console.log(` FAIL  ${name}${detail ? `\n        ${detail}` : ''}`)
  }
}

// --- config bridge ---------------------------------------------------------

const empty = md.render('')
expect('config element is injected', empty.includes('id="markdown-vista-config"'), empty)
const payload = JSON.parse(
  empty
    .match(/data-markdown-vista-config="([^"]*)"/)[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
)
expect('config payload carries viewer settings', payload.viewerEnabled === true && payload.pngExport === 'auto')
expect(
  'config payload carries toc settings',
  payload.tocEnabled === true && payload.tocOpenByDefault === false && payload.tocMaxLevel === 6,
  JSON.stringify(payload)
)

// --- mermaid fence ---------------------------------------------------------

const mermaid = md.render('```mermaid\ngraph TD;\n  A["a & b"]-->B;\n```')
expect('mermaid fence becomes a candidate', mermaid.includes('class="mermaid-diagram-candidate code-line"'), mermaid)
expect('mermaid fence keeps the scroll-sync line', /data-line="0"/.test(mermaid), mermaid)
expect('mermaid source is html-escaped', mermaid.includes('&quot;a &amp; b&quot;'), mermaid)

const js = md.render('```js\nconst a = 1\n```')
expect('other fences are untouched', !js.includes('mermaid-diagram-candidate'), js)

settings.set('mermaid.enabled', false)
expect('mermaid can be disabled at render time', !md.render('```mermaid\ngraph TD;\nA-->B;\n```').includes('mermaid-diagram-candidate'))
settings.set('mermaid.enabled', true)

// --- extended syntax -------------------------------------------------------

const cases = [
  ['highlight', '==marked==', '<mark>marked</mark>'],
  ['insert', '++inserted++', '<ins>inserted</ins>'],
  ['subscript', 'H~2~O', '<sub>2</sub>'],
  ['superscript', 'x^2^', '<sup>2</sup>'],
  ['footnote', 'text[^1]\n\n[^1]: note', 'footnote-ref'],
  ['definition list', 'Term\n:   Definition', '<dl>'],
  ['emoji', ':tada:', '🎉']
]
for (const [name, source, expected] of cases) {
  const html = md.render(source)
  expect(name, html.includes(expected), html.trim())
}

const abbr = md.render('*[HTML]: HyperText Markup Language\n\nThe HTML spec')
expect('abbreviation', abbr.includes('<abbr title="HyperText Markup Language">HTML</abbr>'), abbr)

// --- things VS Code already owns must NOT be duplicated --------------------

expect('no math renderer of our own', !md.render('$x^2$').includes('katex'), md.render('$x^2$'))

rmSync(outDir, { recursive: true, force: true })
console.log(`\n${failures.length === 0 ? 'all render tests passed' : `${failures.length} failing`}`)
process.exit(failures.length === 0 ? 0 : 1)
