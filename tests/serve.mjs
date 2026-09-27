// tests/serve.mjs — exercise the editor route through a real HTTP server, which
// is the path the browser actually takes. `apply` is driven with a minimal host
// context so the registered handler is the production one.
import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const host = await import(pathToFileURL(join(here, '..', 'lib', 'index.mjs')).href)

const ROUTE = '/plugins/dsh-drawioedit/editor'

// Install the routes exactly as apply does, and pick out the editor one.
const routes = []

host.apply({
  effect: (fn) => { fn(); return () => {} },
  webServer: { register: (registered) => { routes.push(registered); return () => {} } },
})
const route = routes.find((registered) => registered.kind === 'prefix')
assert.ok(route, 'apply registered no prefix route')
assert.equal(route.path, ROUTE, 'route path mismatch')
console.log('ok   apply registered a prefix route at', route.path)

const server = createServer((req, res) => { void route.handler(req, res) })
await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve) })
const { port } = server.address()

async function get(pathname) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`)
  const body = await res.text()
  return { status: res.status, type: res.headers.get('content-type'), body }
}

try {
  const cases = [
    [`${ROUTE}/index.html`, 200, 'text/html', /drawio|mxGraph|grapheditor/i],
    [`${ROUTE}/js/main.js`, 200, 'text/javascript', null],
    [`${ROUTE}/styles/grapheditor.css`, 200, 'text/css', null],
    // The prefix route must reject escaping the editor root.
    [`${ROUTE}/../../../package.json`, 403, null, null],
    [`${ROUTE}/%2e%2e%2f%2e%2e%2fpackage.json`, 403, null, null],
    // A name that does not exist is a 404, not a 403.
    [`${ROUTE}/does-not-exist.js`, 404, null, null],
  ]
  let failures = 0
  for (const [pathname, status, type, pattern] of cases) {
    const res = await get(pathname)
    const typeOk = type === null || (res.type ?? '').startsWith(type)
    const bodyOk = pattern === null || pattern.test(res.body)
    const ok = res.status === status && typeOk && bodyOk
    if (!ok) failures += 1
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${pathname} -> ${res.status} ${res.type ?? ''}`)
  }

  // The shim must be served, and the index must reference it before main.js —
  // the editor reads its hash there, so a later injection is too late.
  const shim = await get('/plugins/dsh-drawioedit/editor/__dsh-shim.js')
  const shimOk = shim.status === 200 && (shim.type ?? '').startsWith('text/javascript')
    && shim.body.includes('executeCreateObject')
  if (!shimOk) failures += 1
  console.log(`${shimOk ? 'ok  ' : 'FAIL'} shim script served (${shim.status})`)

  const index = await get(`${ROUTE}/index.html`)
  const shimAt = index.body.indexOf('__dsh-shim.js')
  const mainAt = index.body.indexOf('js/main.js')
  const bootAt = index.body.indexOf('js/bootstrap.js')
  const orderOk = shimAt > bootAt && shimAt !== -1 && shimAt < mainAt
  if (!orderOk) failures += 1
  console.log(`${orderOk ? 'ok  ' : 'FAIL'} shim injected after bootstrap.js and before main.js`)

  if (failures > 0) throw new Error(`${failures} case(s) failed`)
  console.log('ok   the editor route serves real files and rejects traversal')
} finally {
  await new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve) })
}

// The iframe URL is built in the browser half and the route is registered in the
// host half, so the two literals can drift apart; a mismatch would 404 the editor
// with no server-side error. Cross-check them here.
const clientSource = await import('node:fs').then(({ readFileSync }) =>
  readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8'))
assert.ok(
  clientSource.includes(ROUTE),
  `the client bundle must reference the served route ${ROUTE}`,
)
console.log('ok   the client bundle references the same route the host serves')

console.log('OK: editor route verified end to end')

