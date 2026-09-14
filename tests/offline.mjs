// tests/offline.mjs — prove the served editor reaches no remote host when it
// boots. A static scan cannot do this: the bundle is full of conditional
// integration URLs (Google Drive, OneDrive, Dropbox) that are never requested
// unless the user enables them, and prose links that are never requested at all.
//
// So this observes the requests the browser actually makes while the editor
// loads, which is the claim the plugin depends on: a diagram never leaves the
// machine.
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnChrome } from './chrome.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const host = await import(pathToFileURL(join(here, '..', 'lib', 'index.mjs')).href)

const WATCHDOG_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 90000)
const watchdog = setTimeout(() => {
  console.error(`offline: no result within ${WATCHDOG_MS} ms`)
  process.exit(2)
}, WATCHDOG_MS)
watchdog.unref?.()

const routes = new Map()
host.apply({
  effect: (fn) => { fn(); return () => {} },
  webServer: { register: (r) => { routes.set(`${r.kind} ${r.path}`, r); return () => {} } },
  fs: { resolve: async () => ({}), writeText: async () => ({}) },
})
const editorRoute = routes.get('prefix /plugins/dsh-drawioedit/editor')

/** Hosts the editor is allowed to contact; everything else is a failure. */
const ALLOWED = new Set(['127.0.0.1', 'localhost', '::1'])

let hostPage = ''
const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://x').pathname
  if (pathname === '/__offline-host.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(hostPage)
    return
  }
  if (pathname !== editorRoute.path && !pathname.startsWith(`${editorRoute.path}/`)) {
    res.writeHead(404).end()
    return
  }
  void editorRoute.handler(req, res)
})
await new Promise((r) => { server.listen(0, '127.0.0.1', r) })
const ORIGIN = `http://127.0.0.1:${server.address().port}`

// The host page mirrors the plugin: same origin as the editor, and it loads the
// editor through the very URL builder the tab body uses -- which is what keeps
// every cloud integration off, since that list has one home.
//
// The diagram carries a DOCTYPE with an external entity, which is the classic
// XXE shape. drawio parses with the platform DOMParser, which does not resolve
// external entities, so the point of including it is that the browser must make
// no request for it. A parser that resolved it would show up as an off-origin
// request below.
const ADVERSARIAL = '<?xml version="1.0"?>'
  + '<!DOCTYPE mxfile [<!ENTITY xxe SYSTEM "http://example.invalid/xxe-probe">]>'
  + '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
  + '<mxCell id="n1" value="&xxe;" vertex="1" parent="1">'
  + '<mxGeometry x="20" y="20" width="120" height="50" as="geometry"/></mxCell>'
  + '</root></mxGraphModel>'
hostPage = `<!doctype html><html><body style="margin:0">
<iframe id="ed" style="width:1100px;height:700px;border:0"></iframe>
<script>
  document.getElementById('ed').src = ${JSON.stringify(host.editorUrl(ADVERSARIAL, ORIGIN))};
</script>
</body></html>`

const profile = mkdtempSync(join(tmpdir(), 'cdp-offline-'))

/**
 * Reserve a free port for Chrome's debugging endpoint.
 *
 * A fixed port is not safe here: a debugger left running by an earlier probe
 * still owns it, the new Chrome silently fails to publish an endpoint, and the
 * connect loop spins until the watchdog fires with no output at all.
 * @returns a port number that was free a moment ago.
 */
async function freePort() {
  const probe = createServer()
  await new Promise((r) => { probe.listen(0, '127.0.0.1', r) })
  const { port } = probe.address()
  await new Promise((r) => { probe.close(r) })
  return port
}

const CDP_PORT = await freePort()
const chrome = spawnChrome([
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
  '--window-size=1200,800', 'about:blank',
])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws
let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : ` (${detail})`}`)
}

async function finish(code) {
  try { ws?.close() } catch { /* closed */ }
  try { chrome.kill('SIGKILL') } catch { /* gone */ }
  await new Promise((r) => { server.closeAllConnections?.(); server.close(r) })
  clearTimeout(watchdog)
  process.exit(code)
}

try {
  let list
  for (let i = 0; i < 60; i++) {
    try {
      list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
      if (list.some((t) => t.type === 'page')) break
    } catch { /* not up */ }
    await sleep(250)
  }
  const page = list?.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')

  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', () => { rej(new Error('cdp connect failed')) }, { once: true })
  })

  let seq = 0
  const pending = new Map()
  const external = []
  const requested = []
  const severe = []
  const missing = []
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id !== undefined) { const s = pending.get(m.id); if (s) { pending.delete(m.id); s(m) }; return }
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
      // drawio catches its own initialization failures and logs them as SEVERE,
      // so a console line is the only sign that the editor gave up on its splash.
      if (text.includes('SEVERE')) severe.push(text.slice(0, 200))
      return
    }
    if (m.method === 'Runtime.exceptionThrown') {
      severe.push(String(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text).slice(0, 200))
      return
    }
    if (m.method === 'Network.responseReceived') {
      // A missing editor asset is invisible to every other check here: the editor still
      // boots, it just loses whatever that file declared. mxgraph's common.css is the one
      // that costs the popup menus their position, and then drawio's own coordinates are
      // ignored and every menu flows into the page below the toolbar.
      const response = m.params.response
      // The test's own host page declares no icon, so the browser asks the origin root
      // for one; that request is not the editor's and would always fail here.
      if (response.url.startsWith(ORIGIN) && response.status >= 400 && response.url !== `${ORIGIN}/favicon.ico`) {
        missing.push(`${response.status} ${response.url.slice(ORIGIN.length, ORIGIN.length + 60)}`)
      }
      return
    }
    if (m.method !== 'Network.requestWillBeSent') return
    const url = m.params?.request?.url ?? ''
    requested.push(url)
    // Only http(s) requests can reach a host; data: URIs carry their own bytes.
    if (!/^https?:/i.test(url)) return
    let hostname
    try { hostname = new URL(url).hostname } catch { return }
    if (!ALLOWED.has(hostname)) external.push(`${hostname} ${url.slice(0, 70)}`)
  })
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++seq
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
  })

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Network.enable')
  await send('Page.navigate', { url: `${ORIGIN}/__offline-host.html` })
  await sleep(24000)

  const local = requested.filter((u) => u.startsWith(ORIGIN))
  console.log(`requests observed: ${requested.length} total, ${local.length} to the local origin`)

  check('the editor loaded from the local origin', local.length > 5, `${local.length} requests`)
  check('the editor contacted no remote host', external.length === 0, [...new Set(external)].slice(0, 4).join(' | '))
  // The adversarial diagram names example.invalid; a parser that resolved the
  // external entity would have requested it.
  check(
    'an external entity in the diagram was not resolved',
    !external.some((entry) => entry.includes('example.invalid')),
  )
  check('the editor loaded app.min.js', local.some((u) => u.includes('app.min.js')))
  check('every editor asset the boot asks for exists', missing.length === 0, [...new Set(missing)].slice(0, 5).join(' | '))
  check('the editor reported no initialization failure', severe.length === 0, severe.slice(0, 2).join(' | '))
} catch (error) {
  console.error('offline probe failed:', error.message)
  failures += 1
}

if (failures > 0) console.error(`${failures} check(s) failed`)
else console.log('OK: the editor boots without contacting any remote host')
await finish(failures > 0 ? 1 : 0)
