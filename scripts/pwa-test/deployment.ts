import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

/** Serve unmodified Vite outputs; switching the directory simulates an atomic deployment. */
export async function startDeployment() {
  let version = 'a'
  let closed = false
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  }
  const server = createServer(async (request, response) => {
    const directory = resolve('.artifacts/pwa-update', version)
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
    const file = resolve(directory, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!file.startsWith(directory + sep)) { response.writeHead(403); response.end(); return }
    try {
      const content = await readFile(file)
      response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
      response.end(content)
    } catch {
      response.writeHead(404)
      response.end('Not found')
    }
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No localhost address assigned')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    deploySecondBuild: () => { version = 'b' },
    close: () => new Promise<void>((resolve, reject) => {
      if (closed) { resolve(); return }
      closed = true
      server.closeAllConnections()
      server.close((error) => { if (error) reject(error); else resolve() })
    }),
  }
}
