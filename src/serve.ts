/**
 * Serving the editor's static files.
 *
 * The editor is a whole application, so it needs its own files under a URL the
 * app origin owns: the iframe must be same-origin with the harness frontend, or
 * the parent cannot drive it at all. `ctx.webServer` is the route registry the
 * host already exposes for exactly this, so the plugin claims one prefix rather
 * than relying on any implicit asset mapping.
 *
 * Every served path is resolved against the editor root and rejected unless it
 * stays inside it, because the request path is untrusted input.
 */
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { SHIM_PATH, SHIM_SOURCE } from './shim.ts'

/** The URL prefix the editor's files are served under, with no trailing slash. */
export const EDITOR_ROUTE = '/plugins/dsh-drawioedit/editor'

/** Absolute path of the editor directory that ships beside this module. */
const EDITOR_ROOT = resolve(fileURLToPath(new URL('../editor', import.meta.url)))

/**
 * The editor's index with the shim injected between `bootstrap.js` and `main.js`
 * so it is installed before the editor reads its hash. Injected at serve time
 * rather than edited into the vendored file, so the upstream copy stays pristine
 * and this remains visible in one place.
 * @param html - the editor's index.html.
 * @returns the index with the shim script inserted.
 */
export function injectShim(html: string): string {
  const tag = `<script src="${SHIM_PATH}"></script>`
  // `bootstrap.js` is the last script in <head>; the shim follows it and the
  // editor's own main.js stays after the body's markup.
  const marker = '<script src="js/bootstrap.js"></script>'
  if (!html.includes(marker)) return html
  return html.replace(marker, `${marker}\n\t${tag}`)
}

/** Content types the editor loads; anything else is served as bytes. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.xml': 'text/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

/**
 * Resolve one request path to a file inside the editor root.
 * @param pathname - the decoded request pathname.
 * @returns the absolute file path, or undefined when it is outside this route.
 */
export function editorFileFor(pathname: string): string | undefined {
  if (pathname === EDITOR_ROUTE) return join(EDITOR_ROOT, 'index.html')
  if (!pathname.startsWith(`${EDITOR_ROUTE}/`)) return undefined
  const relative = pathname.slice(EDITOR_ROUTE.length + 1)
  if (relative === '') return join(EDITOR_ROOT, 'index.html')
  let decoded: string
  try {
    decoded = decodeURIComponent(relative)
  } catch {
    // A malformed percent sequence cannot name a file.
    return undefined
  }
  // `normalize` collapses `..` before the containment check, so a traversal
  // attempt either escapes the root and is rejected or resolves inside it.
  const candidate = resolve(EDITOR_ROOT, normalize(decoded))
  if (candidate !== EDITOR_ROOT && !candidate.startsWith(EDITOR_ROOT + sep)) return undefined
  return candidate
}

/**
 * Answer one request for an editor file.
 *
 * A prefix route is consulted for everything under its path, including paths
 * whose `..` segments a client sent: URL parsing collapses those before this
 * handler runs, so a request can arrive that no longer names this route at all.
 * Such a request is refused rather than answered with the editor's index, which
 * would turn path traversal into a 200.
 * @param req - the incoming request.
 * @param res - the response to own.
 */
export async function serveEditorFile(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const pathname = new URL(req.url ?? '/', 'http://x').pathname
  if (pathname !== EDITOR_ROUTE && !pathname.startsWith(`${EDITOR_ROUTE}/`)) {
    res.writeHead(403).end('forbidden')
    return
  }
  if (pathname === SHIM_PATH) {
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'content-length': String(Buffer.byteLength(SHIM_SOURCE, 'utf8')),
      // The shim ships with the host half, and a stale copy is invisible except as
      // a broken editor: it is script the browser may otherwise cache heuristically.
      'cache-control': 'no-store',
    }).end(SHIM_SOURCE)
    return
  }
  const file = editorFileFor(pathname)
  if (file === undefined) {
    res.writeHead(403).end('forbidden')
    return
  }
  if (pathname === `${EDITOR_ROUTE}/index.html` || pathname === EDITOR_ROUTE) {
    // The one file that is transformed rather than streamed.
    const html = injectShim(await readFile(file, 'utf8'))
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(Buffer.byteLength(html, 'utf8')),
      'cache-control': 'no-store',
    }).end(html)
    return
  }
  let size: number
  try {
    const info = await stat(file)
    if (!info.isFile()) throw new Error('not a file')
    size = info.size
  } catch {
    res.writeHead(404).end('not found')
    return
  }
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': String(size),
    // The editor is versioned with the plugin, so a long cache is safe and keeps
    // the 119 MB payload from being re-fetched on every open.
    'cache-control': 'public, max-age=86400',
  })
  // Settle on the response's own completion, not the file stream's: the stream can
  // end while bytes are still flushing, and teardown then races the write.
  await new Promise<void>((settle) => {
    res.on('finish', settle)
    res.on('close', settle)
    const stream = createReadStream(file)
    stream.on('error', () => { res.destroy(); settle() })
    stream.pipe(res)
  })
}
