/**
 * Tests the extension-host helpers that do not touch the `vscode` API:
 * heading parsing, slug generation and the generated table of contents.
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = mkdtempSync(join(tmpdir(), 'markdown-vista-host-'))
const outfile = join(outDir, 'host.mjs')

await build({
  entryPoints: [resolve(root, 'src/host/toc-markdown.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent'
})

const { buildToc } = await import(pathToFileURL(outfile).href)
const headings = await import(pathToFileURL(outfile).href)

const failures = []
function expect(name, condition, detail = '') {
  if (condition) console.log(`  ok   ${name}`)
  else {
    failures.push(name)
    console.log(` FAIL  ${name}${detail ? `\n        ${detail}` : ''}`)
  }
}

const sample = `# Title

## 5.1 现状确认（已取证）

text

### Deep

\`\`\`
## not a heading, it is inside a fence
\`\`\`

## Second
## Second
`

const toc = buildToc(sample, 6, 2)

expect('wrapped in idempotency markers', toc.startsWith('<!-- markdown-vista-toc -->') && toc.endsWith('<!-- /markdown-vista-toc -->'), toc)
expect('h1 title is excluded', !toc.includes('](#title)'), toc)
expect('headings inside a fence are ignored', !toc.includes('not a heading'), toc)
expect('nesting follows heading level', toc.includes('\n  - [Deep]'), toc)
expect(
  'chinese heading keeps its characters in the slug',
  toc.includes('- [5.1 现状确认（已取证）](#51-%E7%8E%B0%E7%8A%B6%E7%A1%AE%E8%AE%A4%EF%BC%88%E5%B7%B2%E5%8F%96%E8%AF%81%EF%BC%89)'),
  toc
)
expect('duplicate headings get distinct anchors', toc.includes('(#second)') && toc.includes('(#second-1)'), toc)

const rebuilt = buildToc(sample, 6, 2)
expect('generation is deterministic', rebuilt === toc)

const empty = buildToc('no headings here', 6, 2)
expect('a document with no headings still produces a block', empty.includes('markdown-vista-toc'), empty)

expect('maxLevel is respected', !buildToc(sample, 2, 2).includes('[Deep]'), buildToc(sample, 2, 2))

void headings
rmSync(outDir, { recursive: true, force: true })
console.log(`\n${failures.length === 0 ? 'all host tests passed' : `${failures.length} failing`}`)
process.exit(failures.length === 0 ? 0 : 1)
