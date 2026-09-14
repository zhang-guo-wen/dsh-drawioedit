// tests/debug/sandbox-probe.mjs — why does the editor sit on its splash inside the
// sidebar when it boots fine on its own?
//
// The offline probe loads the editor in a plain iframe and it boots. The sidebar
// loads it in a sandboxed iframe and, per the report, it never leaves drawio's
// "Loading..." splash. This probe serves the same bytes through the same route
// handler and loads them in exactly one iframe, chosen by --mode, then reports:
//
//   - every network request and console line, printed LIVE with elapsed time, so a
//     wedged renderer still leaves the point it wedged at;
//   - the frame's own boot flags, posted back by the host page on a timer.
//
// All same-origin frames of a page share one renderer main thread, so a frame that
// spins also stops the host page's timers: the live log is the only witness left.
//
// Read-only. Usage: node tests/debug/sandbox-probe.mjs [plain|sandboxed|<attr>]
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const host = await import(pathToFileURL(join(here, '..', '..', 'lib', 'index.mjs')).href)

/** `sandboxed` is the attribute the tab body shipped when this was written. */
const MODES = {
  plain: '',
  sandboxed: 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads',
}
const requested = process.argv[2] ?? 'sandboxed'
const ATTRIBUTE = requested in MODES ? MODES[requested] : requested

const WATCHDOG_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 150000)
const watchdog = setTimeout(() => {
  console.error(`sandbox-probe: no result within ${WATCHDOG_MS} ms`)
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

const DIAGRAM = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
  + '<mxCell id="n1" value="probe" vertex="1" parent="1">'
  + '<mxGeometry x="20" y="20" width="120" height="50" as="geometry"/></mxCell>'
  + '</root></mxGraphModel>'
const PARAMS = JSON.stringify({ client: '1', gapi: '0', hash: '#R' + encodeURIComponent(DIAGRAM) })

let hostPage = ''
let report = undefined
const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://x').pathname
  if (pathname === '/__report') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => { report = body; res.writeHead(204).end() })
    return
  }
  if (pathname === '/__probe-host.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(hostPage)
    return
  }
  if (pathname !== editorRoute.path && !pathname.startsWith(`${editorRoute.path}/`)) {
    res.writeHead(404).end()
    return
  }
  // PROBE_NOSHIM=1 serves index.html straight from disk, which is the one way to
  // see whether the shim injection is what the boot is choking on.
  if (process.env.PROBE_NOSHIM === '1' && pathname.endsWith('/editor/index.html')) {
    const raw = readFileSync(join(here, '..', '..', 'editor', 'index.html'))
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(raw)
    return
  }
  void editorRoute.handler(req, res)
})
await new Promise((r) => { server.listen(0, '127.0.0.1', r) })
const ORIGIN = `http://127.0.0.1:${server.address().port}`

// The state is gathered by the host page and posted back rather than read over the
// debugger, because a request/response CDP call waits on the page's own thread --
// the one thing a wedged editor boot takes away.
hostPage = `<!doctype html><html><body style="margin:0">
<iframe id="ed" style="width:900px;height:700px;border:0" ${ATTRIBUTE === '' ? '' : `sandbox="${ATTRIBUTE}"`}></iframe>
<script>
  var url = ${JSON.stringify(`${ORIGIN}/plugins/dsh-drawioedit/editor/index.html`)} + ${JSON.stringify('#P' + encodeURIComponent(PARAMS))};
  function inspect() {
    var out = { sandbox: ${JSON.stringify(ATTRIBUTE)} };
    var f = document.getElementById('ed');
    try {
      var w = f.contentWindow;
      out.href = w.location.href.slice(-60);
      out.mxScriptsLoaded = w.mxScriptsLoaded;
      out.mxWinLoaded = w.mxWinLoaded;
      out.hasApp = typeof w.App;
      out.hasEditorUi = typeof w.EditorUi;
      out.shim = w.__dshShimState ? JSON.stringify(w.__dshShimState) : 'absent';
      var d = null;
      try { d = f.contentDocument } catch (e) { out.document = 'blocked: ' + e.name }
      if (d) {
        out.readyState = d.readyState;
        out.title = d.title.slice(0, 60);
        var s = d.getElementById('geStatus');
        out.splash = s ? s.textContent.trim() : 'no geStatus';
        out.geInfo = d.getElementById('geInfo') === null ? 'removed' : 'present';
        out.rendered = d.querySelector('.geDiagramContainer') !== null;
        out.bodyText = d.body ? d.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 200) : '';
        out.storage = (function () { try { w.localStorage.getItem('x'); return 'ok' } catch (e) { return e.name } })();
      }
    } catch (e) { out.error = String(e).split('\\n')[0].slice(0, 200) }
    return out;
  }
  (function tick() {
    fetch('/__report', { method: 'POST', body: JSON.stringify(inspect(), null, 2) }).catch(function () {});
    setTimeout(tick, 4000);
  })();
  document.getElementById('ed').src = url;
</script>
</body></html>`

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = mkdtempSync(join(tmpdir(), 'cdp-sandbox-'))

async function freePort() {
  const probe = createServer()
  await new Promise((r) => { probe.listen(0, '127.0.0.1', r) })
  const { port } = probe.address()
  await new Promise((r) => { probe.close(r) })
  return port
}

const CDP_PORT = await freePort()
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
  '--window-size=1200,900', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws
const started = Date.now()
const elapsed = () => `${String(Date.now() - started).padStart(6)}ms`

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
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id !== undefined) { const s = pending.get(m.id); if (s) { pending.delete(m.id); s(m) }; return }
    switch (m.method) {
      case 'Network.requestWillBeSent': {
        const url = m.params.request.url
        if (url.startsWith('data:')) return
        console.log(`${elapsed()} -> ${m.params.type} ${url.replace(ORIGIN, '').slice(0, 78)}`)
        break
      }
      case 'Network.loadingFailed':
        console.log(`${elapsed()} !! ${m.params.errorText} ${m.params.blockedReason ?? ''} ${m.params.type}`)
        break
      case 'Runtime.consoleAPICalled': {
        const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 220)
        if (text !== '') console.log(`${elapsed()} console.${m.params.type}: ${text}`)
        break
      }
      case 'Runtime.exceptionThrown': {
        const d = m.params.exceptionDetails
        console.log(`${elapsed()} EXCEPTION: ${(d?.exception?.description ?? d?.text ?? '').slice(0, 400)}`)
        break
      }
      default:
        break
    }
  })
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++seq
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
  })

  console.log(`mode: ${requested}${ATTRIBUTE === '' ? ' (no sandbox attribute)' : ''}`)
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Network.enable')
  await send('Page.navigate', { url: `${ORIGIN}/__probe-host.html` })

  // The frame tree is answered by the browser, not the renderer, so it still comes
  // back when a frame's script is stuck.
  await sleep(6000)
  const tree = await send('Page.getFrameTree')
  console.log('== frame tree ==')
  const walk = (node, depth = 0) => {
    console.log(`${'  '.repeat(depth)}${(node.frame.url || '(empty)').slice(0, 110)} | name: ${node.frame.name || '-'}`)
    for (const child of node.childFrames ?? []) walk(child, depth + 1)
  }
  walk(tree.result.frameTree)

  let reports = 0
  for (let i = 0; i < Number(process.env.PROBE_SECONDS ?? 60); i++) {
    await sleep(1000)
    if (report !== undefined && reports < 4) {
      reports += 1
      console.log(`\n== frame state ${reports} at ${elapsed()} ==`)
      console.log(report)
    }
  }
  if (reports === 0) console.log('\n== no state report arrived; the renderer never ran the host timer ==')
  await finish(0)
} catch (error) {
  console.error('sandbox probe failed:', error.message)
  await finish(1)
}
