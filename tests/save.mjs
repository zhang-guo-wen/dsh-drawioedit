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
const SESSION_ID = 'session-1'
const session = { id: SESSION_ID, header: { cwd: 'C:/Users/Windows11/Documents/deepseek-harness/默认工作区' } }
const policy = { mode: 'workspace-write', workspaceRoot: session.header.cwd, sessionId: SESSION_ID }
let liveSession = session
let coldDisposed = false

const ctx = {
  effect: (fn) => { fn(); return () => {} },
  webServer: { register: (route) => { routes.set(`${route.kind} ${route.path}`, route); return () => {} } },
  sessions: { get: (id) => id === SESSION_ID ? liveSession : undefined },
  sessionQuery: { observeSession: async (id) => {
    if (id !== SESSION_ID) throw new Error('dsh-drawioedit: editor session is no longer available')
    return {
      header: session.header,
      events: [{ type: 'sandbox/mode', data: { mode: 'workspace-write' } }],
      [Symbol.dispose]: () => { coldDisposed = true },
    }
  } },
  sandboxPolicy: { resolve: ({ session: requested } = {}) => {
    if (requested === undefined) return { mode: 'read-only', workspaceRoot: 'C:/server' }
    assert.equal(requested, session, 'save must resolve the editor session policy')
    return policy
  } },
  fs: {
    resolve: async (path) => ({ path, kind: 'resolved' }),
    writeText: async (target, content, expected, signal, sandboxPolicy) => {
      writes.push({ path: target.path, content, expected, signal, sandboxPolicy })
      if (writeFailure !== undefined) throw writeFailure
      // The host reports the token for the bytes it just wrote; the editor needs
      // it for its next save, or that save would offer a stale one.
      return { operation: 'update', version: `v${writes.length}`, before: null, after: content }
    },
  },
}

const routes = new Map()
host.apply(ctx)
assert.equal(routes.size, 3, 'apply must register the editor, save, and rename routes')
assert.ok(routes.has('prefix /plugins/dsh-drawioedit/editor'), 'editor route missing')
assert.ok(routes.has('exact /plugins/dsh-drawioedit/save'), 'save route missing')
assert.ok(routes.has('exact /plugins/dsh-drawioedit/rename'), 'rename route missing')
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
  let res = await post({ path: '/w/diagram.drawio', xml: XML, sessionId: SESSION_ID })
  check('plain save returns ok', res.status === 200 && res.body.ok === true)
  check('plain save wrote once with no guard', writes.length === 1 && writes[0].expected === undefined)
  check('save uses the editor session policy', writes[0].sandboxPolicy === policy)
  check('a successful save returns the new token', res.body.version === 'v1')

  writes.length = 0
  res = await post({ path: '/w/diagram.drawio', xml: XML, version: '', sessionId: SESSION_ID })
  check('an empty read token does not impose a stale guard', res.status === 200 && writes[0].expected === undefined)

  // After a host restart the tab's session may only exist in persistence.
  // The save must still use that session's workspace and last permission mode.
  liveSession = undefined
  writes.length = 0
  res = await post({ path: '/w/diagram.drawio', xml: XML, sessionId: SESSION_ID })
  check('a persisted session can save after restart', res.status === 200 && writes.length === 1)
  check('the persisted session policy is applied and its observation released',
    writes[0].sandboxPolicy.mode === 'workspace-write' &&
    writes[0].sandboxPolicy.workspaceRoot === session.header.cwd && coldDisposed)
  liveSession = session

  // A guarded save must pass the version through as a replace-if-version intent.
  writes.length = 0
  res = await post({ path: '/w/diagram.drawio', xml: XML, version: 'v42', sessionId: SESSION_ID })
  check('guarded save returns ok', res.status === 200)
  check(
    'guarded save passes replaceIfVersion',
    writes.length === 1 && writes[0].expected?.kind === 'replaceIfVersion' && writes[0].expected?.version === 'v42',
  )
  check('the returned token advances', res.body.version === 'v1')

  // A stale version is a refusal the editor must see, not a silent overwrite.
  writeFailure = new Error('FS_STALE_VERSION')
  res = await post({ path: '/w/diagram.drawio', xml: XML, version: 'v-old', sessionId: SESSION_ID })
  check('stale version reports failure', res.status === 400 && res.body.ok === false)
  check('stale version surfaces the reason', String(res.body.error).includes('STALE'))
  writeFailure = undefined

  writeFailure = Object.assign(new Error('file access denied under workspace-write mode'), { code: 'FS_SANDBOX_DENIED' })
  res = await post({ path: '/w/diagram.drawio', xml: XML, version: 'v42', sessionId: SESSION_ID })
  check('sandbox refusal has a stable code', res.status === 403 && res.body.code === 'FS_SANDBOX_DENIED')
  writeFailure = undefined

  writes.length = 0
  res = await post({ path: '/w/diagram.drawio', xml: XML, sessionId: 'not-a-session' })
  check('an unknown session cannot save', res.status === 400 && res.body.ok === false && writes.length === 0)

  // Malformed requests are refused before any write is attempted.
  writes.length = 0
  for (const [label, body] of [
    ['missing path', { xml: XML, sessionId: SESSION_ID }],
    ['empty path', { path: '', xml: XML, sessionId: SESSION_ID }],
    ['missing xml', { path: '/w/a.drawio', sessionId: SESSION_ID }],
    ['empty xml', { path: '/w/a.drawio', xml: '', sessionId: SESSION_ID }],
    ['non-string version', { path: '/w/a.drawio', xml: XML, version: 7, sessionId: SESSION_ID }],
    ['missing session', { path: '/w/a.drawio', xml: XML }],
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
