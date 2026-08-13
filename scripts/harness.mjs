/** Serves the repo so `samples/harness.html` can exercise media/preview.js in a
 *  real browser. The harness mimics the built-in preview's DOM and theme tokens. */
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, extname, join, normalize, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.PORT ?? 8731)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/plain; charset=utf-8'
}

createServer((request, response) => {
  const path = join(root, normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname)))
  if (!path.startsWith(root) || !existsSync(path) || statSync(path).isDirectory()) {
    response.writeHead(404).end('not found')
    return
  }
  response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
  createReadStream(path).pipe(response)
}).listen(port, () => {
  console.log(`harness: http://localhost:${port}/samples/harness.html`)
})
