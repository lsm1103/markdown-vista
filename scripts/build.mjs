import { build, context } from 'esbuild'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const watch = process.argv.includes('--watch')
const dev = watch || process.argv.includes('--dev')

/** Runs in the extension host (Node). `vscode` is provided by the runtime. */
const extensionConfig = {
  entryPoints: [resolve(root, 'src/extension.ts')],
  outfile: resolve(root, 'dist/extension.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: dev,
  minify: !dev,
  logLevel: 'info'
}

const browser = {
  bundle: true,
  splitting: false,
  platform: 'browser',
  format: 'iife',
  target: ['chrome108'],
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  legalComments: 'none',
  define: {
    'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
    __MARKDOWN_VISTA_VERSION__: JSON.stringify(version)
  },
  logLevel: 'info'
}

/**
 * Runs inside the built-in Markdown preview's webview. Every preview loads it,
 * so Mermaid is deliberately *not* part of it — see below.
 */
const previewConfig = {
  ...browser,
  entryPoints: [resolve(root, 'src/preview/main.ts')],
  outfile: resolve(root, 'media/preview.js')
}

/**
 * Mermaid, split out and loaded on demand by `assets.ts` when a document
 * actually contains a diagram.
 *
 * It is a separate *entry point*, not a code-splitting chunk: esbuild's
 * splitting emits ESM with relative imports, which resolve against the
 * `vscode-webview://` origin and fail. A standalone IIFE that publishes a
 * global can be injected as a plain `<script>` instead.
 */
const mermaidConfig = {
  ...browser,
  entryPoints: [resolve(root, 'src/preview/mermaid-chunk.ts')],
  outfile: resolve(root, 'media/mermaid.js'),
  globalName: 'markdownVistaMermaid'
}

/** Runs in the throw-away webview the export command drives. */
const exportRunnerConfig = {
  ...browser,
  entryPoints: [resolve(root, 'src/preview/export-runner.ts')],
  outfile: resolve(root, 'media/export-runner.js')
}

const configs = [extensionConfig, previewConfig, mermaidConfig, exportRunnerConfig]

if (watch) {
  const contexts = await Promise.all(configs.map((config) => context(config)))
  await Promise.all(contexts.map((ctx) => ctx.watch()))
  console.log('watching…')
} else {
  await Promise.all(configs.map((config) => build(config)))
  console.log('build complete')
}
