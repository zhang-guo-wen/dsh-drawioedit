// tests/debug/capture-docs-shot.mjs — regenerate docs/example.png.
//
// The README's image has to show the product, so this drives the editor the way the
// tab body does rather than drawing a mock: the host half serves its own editor route,
// the frame gets the shipped `editorUrl`, and the message relay answers the editor's
// autosave with the same `{action:'saved'}` the pane writes back. That is what turns
// drawio's "Unsaved changes" banner into the state the pane leaves it in.
//
// The editor follows `prefers-color-scheme`; the capture forces light, because the
// sibling preview screenshot and drawio's own documentation are light.
//
// Usage: node tests/debug/capture-docs-shot.mjs [--dark] [--width N] [--height N]
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnChrome } from '../chrome.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const host = await import(pathToFileURL(join(repo, 'lib', 'index.mjs')).href)

const argv = process.argv.slice(2)
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? fallback : argv[at + 1]
}
const WIDTH = Number(option('width', 900))
const HEIGHT = Number(option('height', 560))
const THEME = argv.includes('--dark') ? 'dark' : 'light'
const OUT = join(repo, 'docs', 'example.png')

/** The sandbox the tab body puts on the frame, verbatim. */
const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads'

/** A label the canvas must show, so a blank frame cannot be captured. */
const LABEL = 'API gateway'

const XML = readFileSync(join(repo, 'docs', 'example.drawio'), 'utf8')
const FILE_NAME = 'example.drawio'

const routes = new Map()
host.apply({
  effect: (fn) => { fn(); return () => {} },
  webServer: { register: (r) => { routes.set(`${r.kind} ${r.path}`, r); return () => {} } },
  fs: { resolve: async () => ({}), writeText: async () => ({}) },
})
const editorRoute = routes.get(`prefix ${host.EDITOR_ROUTE}`)
if (editorRoute === undefined) throw new Error('capture: the editor route was not registered')

const WATCHDOG_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 120000)
const watchdog = setTimeout(() => {
  console.error(`capture: no result within ${WATCHDOG_MS} ms`)
  process.exit(2)
}, WATCHDOG_MS)
watchdog.unref?.()

let report = undefined
const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://host').pathname
  if (pathname === '/__report') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => { report = body; res.writeHead(204).end() })
    return
  }
  if (pathname === '/__shot-host.html') {
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

const hostPage = `<!doctype html><html><body style="margin:0;overflow:hidden">
<iframe id="ed" style="display:block;width:${WIDTH}px;height:${HEIGHT}px;border:0" sandbox="${SANDBOX}"></iframe>
<script>
  var autosaves = 0;
  window.addEventListener('message', function (event) {
    var m;
    try { m = JSON.parse(event.data); } catch (e) { return; }
    if (m == null || m.event !== 'autosave') return;
    autosaves++;
    // The pane's own write path: report the write back and the editor's
    // "Unsaved changes" banner becomes the saved state.
    document.getElementById('ed').contentWindow.postMessage(JSON.stringify({ action: 'saved' }), '*');
  });
  function inspect() {
    var out = { autosaves: autosaves };
    var d = document.getElementById('ed').contentDocument;
    var w = document.getElementById('ed').contentWindow;
    var canvas = d.querySelector('.geDiagramContainer');
    out.canvas = canvas !== null;
    out.splash = d.getElementById('geInfo') !== null;
    // The example's cells set html=1, so drawio draws their labels as HTML inside a
    // foreignObject rather than as SVG text.
    out.label = canvas !== null && (canvas.textContent || '').indexOf(${JSON.stringify(LABEL)}) >= 0;
    var name = d.querySelector('.geFilename');
    out.fileLabel = name === null ? null : (name.textContent || '').trim();
    // Is that name visible anywhere at all? Reported rather than asserted: this tool
    // captures the README image, it does not gate.
    // drawio hides the file name in its compact UI, which it enables at
    // screen.height <= 740; report the screen so a capture cannot silently regress into
    // the layout no desktop user sees.
    out.screen = [w.screen.width, w.screen.height];
    out.compact = (d.body.className || '').indexOf('geCompactMode') >= 0;
    out.nameShown = Array.prototype.some.call(d.querySelectorAll('body *'), function (el) {
      if (el.children.length !== 0) return false;
      if ((el.textContent || '').indexOf(${JSON.stringify(FILE_NAME)}) < 0) return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    var status = d.querySelector('.geStatusAlert, .geStatus');
    out.status = status === null ? null : (status.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
    out.saved = (w.__dshShimState || {}).saved || 0;
    return out;
  }
  var pressed = false;
  (function tick() {
    try {
      var state = inspect();
      // The gesture the README documents, so the captured banner is the one the pane
      // leaves after a write rather than the load-time "Unsaved changes" notice.
      if (!pressed && state.canvas === true && state.label === true) {
        pressed = true;
        var w = document.getElementById('ed').contentWindow;
        w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
      }
      fetch('/__report', { method: 'POST', body: JSON.stringify(state) }).catch(function () {});
    } catch (e) { /* the frame is mid-navigation */ }
    setTimeout(tick, 500);
  })();
  document.getElementById('ed').src = ${JSON.stringify(host.editorUrl(XML, ORIGIN, FILE_NAME))};
</script>
</body></html>`

const profile = mkdtempSync(join(tmpdir(), 'dsh-shot-'))

/** Reserve a free port for Chrome's debugging endpoint. @returns a port number. */
async function freePort() {
  const probe = createServer()
  await new Promise((r) => { probe.listen(0, '127.0.0.1', r) })
  const { port } = probe.address()
  await new Promise((r) => { probe.close(r) })
  return port
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const CDP_PORT = await freePort()
const chrome = spawnChrome([
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
  `--window-size=${WIDTH + 40},${HEIGHT + 120}`, 'about:blank',
])

async function finish(code) {
  try { ws?.close() } catch { /* closed */ }
  try { chrome.kill('SIGKILL') } catch { /* gone */ }
  await new Promise((r) => { server.closeAllConnections?.(); server.close(r) })
  clearTimeout(watchdog)
  process.exit(code)
}

let ws
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
    if (m.id === undefined) return
    const settle = pending.get(m.id)
    if (settle) { pending.delete(m.id); settle(m) }
  })
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++seq
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
  })

  // Headless Chrome reports an 800x600 screen whatever `--window-size` says, and drawio
  // switches to its compact UI at `screen.height <= 740` — the one UI that hides the file
  // name the shim sets. Emulate a desktop screen so the capture shows the layout a
  // desktop user gets, not the short-window one.
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: false,
    screenWidth: 1920, screenHeight: 1080,
  })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: THEME }] })
  await send('Page.enable')
  await send('Page.navigate', { url: `${ORIGIN}/__shot-host.html` })

  // drawio parses a 9.7 MB bundle before it builds a canvas, so the frame reports until
  // the canvas is up, the diagram is drawn, and the confirmed write has landed.
  const deadline = Date.now() + 90000
  let state = {}
  while (Date.now() < deadline) {
    await sleep(1000)
    if (report === undefined) continue
    state = JSON.parse(report)
    if (state.canvas === true && state.label === true && state.splash === false && state.saved >= 1) break
  }
  if (state.canvas !== true || state.label !== true) {
    throw new Error(`the editor never drew the diagram: ${JSON.stringify(state)}`)
  }
  console.log(`state: ${JSON.stringify(state)}`)

  // The banner repaints on the editor's own schedule, after the message that confirmed
  // the write; capture the settled frame rather than the one the reply raced.
  await sleep(1500)
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    // `scale: 1` because the emulated deviceScaleFactor already renders at 2x; a clip
    // scale above 1 would multiply it again.
    clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 },
  })
  if (shot.result?.data === undefined) throw new Error(`captureScreenshot failed: ${JSON.stringify(shot.error)}`)
  const bytes = Buffer.from(shot.result.data, 'base64')
  writeFileSync(OUT, bytes)
  console.log(`wrote ${OUT} (${WIDTH}x${HEIGHT} at 2x, ${bytes.length} bytes)`)
} catch (error) {
  console.error('capture failed:', error.message)
  await finish(1)
}

await finish(0)
