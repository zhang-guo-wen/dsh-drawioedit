// tests/shimdelivery.mjs — prove the shim reaches the editor through THIS
// plugin's route, with no browser in the loop.
//
// The shim's behaviour is verified by tests/shim.mjs. What remains is delivery:
// the page the iframe loads must actually contain the shim, placed before the
// script that defines the editor. That is an HTTP-level fact, so it needs no
// browser.
import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const host = await import(pathToFileURL(join(here, '..', 'lib', 'index.mjs')).href)

const routes = new Map()
host.apply({
  effect: (fn) => { fn(); return () => {} },
  webServer: { register: (r) => { routes.set(`${r.kind} ${r.path}`, r); return () => {} } },
  fs: { resolve: async () => ({}), writeText: async () => ({}) },
})
const editorRoute = routes.get('prefix /plugins/dsh-drawioedit/editor')
assert.ok(editorRoute, 'the editor route was not registered')

const server = createServer((req, res) => { void editorRoute.handler(req, res) })
await new Promise((r) => { server.listen(0, '127.0.0.1', r) })
const ORIGIN = `http://127.0.0.1:${server.address().port}`

let failures = 0
const check = (label, ok) => { if (!ok) failures += 1; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`) }

try {
  // The page the iframe loads.
  const index = await fetch(`${ORIGIN}/plugins/dsh-drawioedit/editor/index.html`)
  const html = await index.text()

  const shimAt = html.indexOf(host.SHIM_PATH)
  const bootstrapAt = html.indexOf('js/bootstrap.js')
  const mainAt = html.indexOf('js/main.js')
  check('index.html is served', index.status === 200)
  check('index.html references the shim', shimAt !== -1)
  check('the shim follows bootstrap.js', shimAt > bootstrapAt)
  check('the shim precedes main.js (which defines the editor)', shimAt < mainAt)

  // The shim itself must be fetchable at the URL the page names.
  const shim = await fetch(`${ORIGIN}${host.SHIM_PATH}`)
  const source = await shim.text()
  check('the shim script is served', shim.status === 200)
  check('it is served as JavaScript', (shim.headers.get('content-type') ?? '').startsWith('text/javascript'))
  check('the served source matches the built shim', source === host.SHIM_SOURCE)
  check('it hooks the editor class', source.includes('EditorUi'))

  // The shim must not be cached: a stale copy would keep an old hook after an
  // upgrade while index.html changed underneath it.
  const cache = shim.headers.get('cache-control') ?? ''
  check('the shim is not served stale', cache.length === 0 || !cache.includes('max-age'))

  if (failures > 0) throw new Error(`${failures} check(s) failed`)
  console.log('OK: the shim is delivered through the plugin route, before the editor boots')
} finally {
  await new Promise((r) => { server.closeAllConnections?.(); server.close(r) })
}
