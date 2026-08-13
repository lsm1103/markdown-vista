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

/**
 * Runs inside the built-in Markdown preview's webview.
 *
 * `format: 'iife'` with splitting disabled is what makes esbuild inline the
 * `import('mermaid')` call into this single file. A separate chunk would be
 * requested relative to the `vscode-webview://` origin and fail to load — the
 * classic reason Mermaid silently does not render in a preview script.
 */
const previewConfig = {
  entryPoints: [resolve(root, 'src/preview/main.ts')],
  outfile: resolve(root, 'media/preview.js'),
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

if (watch) {
  const contexts = await Promise.all([context(extensionConfig), context(previewConfig)])
  await Promise.all(contexts.map((ctx) => ctx.watch()))
  console.log('watching…')
} else {
  await Promise.all([build(extensionConfig), build(previewConfig)])
  console.log('build complete')
}
