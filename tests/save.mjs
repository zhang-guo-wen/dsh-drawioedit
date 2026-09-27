// tests/save.mjs — exercise the save endpoint through a real HTTP server with a
// stub filesystem, so the guard that protects an agent's concurrent write is
// verified rather than assumed.
import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const host = await import(pathToFileURL(join(here, '..', 'lib', 'index.mjs')).href)

/** Every write the endpoint attempted, so the guard can be inspected. */
const writes = []
/** Makes the next write fail the way a stale version does. */
let writeFailure

const ctx = {
  effect: (fn) => { fn(); return () => {} },
  webServer: { register: (route) => { routes.set(`${route.kind} ${route.path}`, route); return () => {} } },
  fs: {
    resolve: async (path) => ({ path, kind: 'resolved' }),
    writeText: async (target, content, expected) => {
      writes.push({ path: target.path, content, expected })
      if (writeFailure !== undefined) throw writeFailure
      // The host reports the token for the bytes it just wrote; the editor needs
      // it for its next save, or that save would offer a stale one.
      return { operation: 'update', version: `v${writes.length}`, before: null, after: content }
    },
  },
}

const routes = new Map()
host.apply(ctx)
assert.equal(routes.size, 2, 'apply must register exactly the editor route and the save endpoint')
assert.ok(routes.has('prefix /plugins/dsh-drawioedit/editor'), 'editor route missing')
assert.ok(routes.has('exact /plugins/dsh-drawioedit/save'), 'save route missing')
console.log('ok   apply registered the editor prefix and the exact save route')

const save = routes.get('exact /plugins/dsh-drawioedit/save')
const server = createServer((req, res) => { void save.handler(req, res) })
await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve) })
const { port } = server.address()

async function post(body, method = 'POST') {
  const res = await fetch(`http://127.0.0.1:${port}/plugins/dsh-drawioedit/save`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = text }
  return { status: res.status, body: parsed }
}

const XML = '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>'
let failures = 0
const check = (label, ok) => { if (!ok) failures += 1; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`) }

try {
  // A plain save carries no guard, so it writes unconditionally.
  writes.length = 0
  let res = await post({ path: '/w/diagram.drawio', xml: XML })
  check('plain save returns ok', res.status === 200 && res.body.ok === true)
  check('plain save wrote once with no guard', writes.length === 1 && writes[0].expected === undefined)
  check('a successful save returns the new token', res.body.version === 'v1')

  // A guarded save must pass the version through as a replace-if-version intent.
  writes.length = 0
  res = await post({ path: '/w/diagram.drawio', xml: XML, version: 'v42' })
  check('guarded save returns ok', res.status === 200)
  check(
    'guarded save passes replaceIfVersion',
    writes.length === 1 && writes[0].expected?.kind === 'replaceIfVersion' && writes[0].expected?.version === 'v42',
  )
  check('the returned token advances', res.body.version === 'v1')

  // A stale version is a refusal the editor must see, not a silent overwrite.
  writeFailure = new Error('FS_STALE_VERSION')
  res = await post({ path: '/w/diagram.drawio', xml: XML, version: 'v-old' })
  check('stale version reports failure', res.status === 400 && res.body.ok === false)
  check('stale version surfaces the reason', String(res.body.error).includes('STALE'))
  writeFailure = undefined

  // Malformed requests are refused before any write is attempted.
  writes.length = 0
  for (const [label, body] of [
    ['missing path', { xml: XML }],
    ['empty path', { path: '', xml: XML }],
    ['missing xml', { path: '/w/a.drawio' }],
    ['empty xml', { path: '/w/a.drawio', xml: '' }],
    ['non-string version', { path: '/w/a.drawio', xml: XML, version: 7 }],
  ]) {
    const bad = await post(body)
    check(`rejects ${label}`, bad.status === 400 && bad.body.ok === false)
  }
  check('no write attempted for malformed requests', writes.length === 0)

  // A non-POST method is refused.
  const wrongMethod = await post({}, 'GET')
  check('rejects non-POST', wrongMethod.status === 405)

  if (failures > 0) throw new Error(`${failures} case(s) failed`)
  console.log('OK: the save endpoint guards writes and rejects malformed requests')
} finally {
  await new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve) })
}
