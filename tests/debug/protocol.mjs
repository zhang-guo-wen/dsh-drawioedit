// tests/protocol.mjs — verify the editor shim end to end, through THIS plugin's
// own route so the injected shim is in the path.
//
// The probe is deliberately self-contained: a hard watchdog guarantees the
// process exits, so a stalled browser can never hang the suite.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const WATCHDOG_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 90000)
const watchdog = setTimeout(() => {
  console.error(`watchdog: no result within ${WATCHDOG_MS} ms`)
  process.exit(2)
}, WATCHDOG_MS)
watchdog.unref?.()

const here = dirname(fileURLToPath(import.meta.url))
const host = await import(pathToFileURL(join(here, '..', 'lib', 'index.mjs')).href)
const xml = readFileSync(
  process.env.DIAGRAM ?? 'C:/02-codespace/deepseek-harness/diagrams/dsh-plugin-flow.drawio',
  'utf8',
)

// Serve the plugin's own routes with a stub filesystem, plus the host page on the
// same origin as the editor (a cross-origin host cannot reach the iframe at all).
const routes = new Map()
host.apply({
  effect: (fn) => { fn(); return () => {} },
  webServer: { register: (r) => { routes.set(`${r.kind} ${r.path}`, r); return () => {} } },
  fs: { resolve: async () => ({}), writeText: async () => ({}) },
})
const editorRoute = routes.get('prefix /plugins/dsh-drawioedit/editor')
if (!editorRoute) { console.error('no editor route registered'); process.exit(1) }

const b64 = Buffer.from(xml, 'utf8').toString('base64')
const createHash = '#create=' + encodeURIComponent(JSON.stringify({ type: 'message' }))
let hostPage = ''

const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://x').pathname
  if (pathname === '/__probe-host.html') {
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

hostPage = `<!doctype html><html><body style="margin:0">
<iframe id="ed" style="width:1100px;height:700px;border:0"></iframe>
<script>
  window.__log = [];
  const XML = new TextDecoder().decode(Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0)));
  window.addEventListener('message', (e) => {
    let m = null; try { m = JSON.parse(e.data); } catch { return }
    if (m.event === 'ready') {
      window.__log.push('ready');
      e.source.postMessage(JSON.stringify({
        action: 'create',
        data: { type: 'xml', compressed: false, data: XML, filename: 'flow.drawio' },
      }), '*');
      window.__log.push('sent');
    }
    if (m.event === 'autosave') window.__log.push('autosave:' + (m.xml ? m.xml.length : 0));
  });
  document.getElementById('ed').src = ${JSON.stringify(`${ORIGIN}/plugins/dsh-drawioedit/editor/index.html`)} + ${JSON.stringify(createHash)};
</script>
</body></html>`

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const CDP_PORT = Number(process.env.CDP_PORT ?? 9430)
const profile = mkdtempSync(join(tmpdir(), 'cdp-shim-'))
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
  '--window-size=1200,800', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws
let failures = 0

async function finish(code) {
  try { ws?.close() } catch { /* closed */ }
  try { chrome.kill('SIGKILL') } catch { /* already gone */ }
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
    } catch { /* not up yet */ }
    await sleep(250)
  }
  const page = list?.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')

  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', () => rej(new Error('cdp connect failed')), { once: true })
  })

  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id !== undefined) { const s = pending.get(m.id); if (s) { pending.delete(m.id); s(m) } }
  })
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++seq
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
  })
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) return `ERR: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}`
    return r.result?.result?.value
  }

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: `${ORIGIN}/__probe-host.html` })
  await sleep(24000)

  const log = await ev('JSON.stringify(window.__log)')
  const state = await ev(`(() => {
    try { return JSON.stringify(document.getElementById('ed').contentWindow.__dshShimState) }
    catch (e) { return 'ERR: ' + e.name }
  })()`)
  const graph = await ev(`(() => {
    try {
      const w = document.getElementById('ed').contentWindow;
      const g = w.sb && w.sb.graph;
      if (!g) return 'no graph handle';
      const model = g.getModel();
      return JSON.stringify({ vertices: g.getChildVertices(model.getRoot()).length,
                              edges: g.getChildEdges(model.getRoot()).length });
    } catch (e) { return 'ERR: ' + e.name }
  })()`)

  console.log('host log  :', log)
  console.log('shim state:', state)
  console.log('graph     :', graph)

  const installed = typeof state === 'string' && state.includes('"installs":') && !state.includes('"installs":0')
  if (!installed) { failures += 1 }
  console.log(`${installed ? 'ok  ' : 'FAIL'} the shim captured the editor instance`)

  const loaded = typeof graph === 'string' && /"vertices":[1-9]/.test(graph)
  if (!loaded) { failures += 1 }
  console.log(`${loaded ? 'ok  ' : 'FAIL'} the shim delivered the diagram into the editor`)
} catch (error) {
  console.error('probe failed:', error.message)
  failures += 1
}

if (failures > 0) console.error(`${failures} check(s) failed`)
else console.log('OK: the shim loads a diagram in a same-origin iframe')
await finish(failures > 0 ? 1 : 0)
