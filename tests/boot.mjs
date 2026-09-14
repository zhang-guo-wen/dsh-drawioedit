// tests/boot.mjs — prove the editor reaches its canvas inside the pane, with the
// shim installed.
//
// The narrower tests each pass on a broken editor: the host can serve every byte
// with a 200, and the shim can hook a class and still leave the app on its splash
// page. That is what happened -- the shim kept the class prototype it saw when
// drawio first assigned the global, drawio replaced that prototype with its
// mxEventSource mixin moments later, and every subclass built from the frozen one
// constructed without `setEventSource`. drawio caught the TypeError, logged
// "SEVERE this.setEventSource is not a function", and left "Loading..." on screen
// forever. So this test asserts the end state a user would see:
//
//   - drawio's own splash element is gone and the app's title is set;
//   - the diagram named below is drawn on the canvas;
//   - the shim hooked the class and captured an instance;
//   - the console reported no initialization failure.
//
// It loads the editor through the shipped URL builder in the shipped sandbox, so
// the parameters and the frame attributes under test are the product's own.
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnChrome } from './chrome.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const host = await import(pathToFileURL(join(here, '..', 'lib', 'index.mjs')).href)

/** The sandbox the tab body puts on the frame, verbatim. */
const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads'

/** The vertex label the canvas must show, which only proves anything if it is unique. */
const LABEL = 'dsh-drawioedit-boot-probe'

const WATCHDOG_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 90000)
const watchdog = setTimeout(() => {
  console.error(`boot: no result within ${WATCHDOG_MS} ms`)
  process.exit(2)
}, WATCHDOG_MS)
watchdog.unref?.()

const routes = new Map()
host.apply({
  effect: (fn) => { fn(); return () => {} },
  webServer: { register: (r) => { routes.set(`${r.kind} ${r.path}`, r); return () => {} } },
  fs: { resolve: async () => ({}), writeText: async () => ({}) },
})
const editorRoute = routes.get(`prefix ${host.EDITOR_ROUTE}`)
if (editorRoute === undefined) throw new Error('boot: the editor route was not registered')

const DIAGRAM = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
  + `<mxCell id="n1" value="${LABEL}" vertex="1" parent="1">`
  + '<mxGeometry x="40" y="40" width="200" height="60" as="geometry"/></mxCell>'
  + '</root></mxGraphModel>'

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
  if (pathname === '/__boot-host.html') {
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

// The state is gathered by the host page, which is same-origin with the frame, and
// posted back on a timer. It is not read over the debugger: a request/response CDP
// call waits on the page's thread, and a wedged boot is precisely the case where
// that call never comes back -- which would turn a failure into a hang.
hostPage = `<!doctype html><html><body style="margin:0">
<iframe id="ed" style="width:1100px;height:700px;border:0" sandbox="${SANDBOX}"></iframe>
<script>
  var autosaves = [];
  window.addEventListener('message', function (event) {
    try {
      var m = JSON.parse(event.data);
      if (m != null && m.event === 'autosave') autosaves.push(m.xml);
    } catch (e) { /* not the editor's protocol */ }
  });
  // Drawio's Save reached through the key the user presses. A synthetic event is
  // enough: the shim listens on the frame's own window and does not check trust.
  window.pressCtrlS = function () {
    var w = document.getElementById('ed').contentWindow;
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
  };
  // Opens the editor's own File menu. A menu taller than the frame is the shape a
  // layout problem takes, and this is the click the report says makes the pane look
  // wrong, so the geometry is measured rather than guessed.
  window.openFileMenu = function () {
    var d = document.getElementById('ed').contentDocument;
    var nodes = d.querySelectorAll('a, td, div, span');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.children.length === 0 && (node.textContent || '').trim() === 'File' && node.offsetParent !== null) {
        node.click();
        return true;
      }
    }
    return false;
  };
  // Clicks the Save item of the open File menu. This is the command the reported bug
  // goes through: drawio's own Save, which must write the file back rather than
  // start its download flow.
  window.saveClickFound = null;
  window.clickSaveInMenu = function () {
    var d = document.getElementById('ed').contentDocument;
    var w = document.getElementById('ed').contentWindow;
    var nodes = d.querySelectorAll('.mxPopupMenu a, .mxPopupMenu td, .mxPopupMenu tr');
    for (var i = 0; i < nodes.length; i++) {
      if ((nodes[i].textContent || '').trim() === 'Save') {
        var node = nodes[i];
        window.saveClickFound = true;
        // A menu item is a gesture, not a click: mxPopupMenu listens on the row and
        // acts on mouseup, so a synthetic click alone never reaches it.
        var at = { bubbles: true, cancelable: true, view: w, clientX: 0, clientY: 0, button: 0 };
        node.dispatchEvent(new w.MouseEvent('mousedown', at));
        node.dispatchEvent(new w.MouseEvent('mouseup', at));
        node.dispatchEvent(new w.MouseEvent('click', at));
        return true;
      }
    }
    window.saveClickFound = false;
    return false;
  };
  // Where the editor's own File menu sits, so a menu that opens somewhere else can be
  // told apart from one that opens under it.
  window.menuBarTop = function () {
    var d = document.getElementById('ed').contentDocument;
    var nodes = d.querySelectorAll('a, td, div, span');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.children.length === 0 && (node.textContent || '').trim() === 'File' && node.offsetParent !== null) {
        return Math.round(node.getBoundingClientRect().top);
      }
    }
    return null;
  };
  function inspect() {
    var out = {
      sandbox: true,
      autosaves: autosaves.length,
      lastAutosaveBytes: (autosaves[autosaves.length - 1] || '').length,
      autosaveHasLabel: autosaves.some(function (x) { return x.indexOf(${JSON.stringify(LABEL)}) >= 0; }),
      saveClicked: window.saveClickFound,
    };
    var f = document.getElementById('ed');
    try {
      var w = f.contentWindow;
      var d = f.contentDocument;
      out.path = w.location.pathname;
      // drawio reads the parameters out of the #P hash and then writes the diagram
      // into the real hash as #R, so a restored #R is the parameter handoff working.
      out.hashRestored = w.location.hash.indexOf('#R') === 0;
      out.title = d.title;
      out.readyState = d.readyState;
      out.splashPresent = d.getElementById('geInfo') !== null;
      out.canvas = d.querySelector('.geDiagramContainer') !== null;
      out.cells = d.querySelectorAll('.geDiagramContainer svg g').length;
      out.labelDrawn = Array.prototype.some.call(d.querySelectorAll('svg text'), function (t) {
        return (t.textContent || '').indexOf(${JSON.stringify(LABEL)}) >= 0;
      });
      out.shim = w.__dshShimState || null;
      out.pinned = w.getComputedStyle(d.body).overflow === 'hidden';
      out.menuBarTop = window.menuBarTop();
      // The title bar's file name, which must be the name the pane opened.
      var label = d.querySelector('.geFilename');
      out.fileLabel = label === null ? null : (label.textContent || '').trim();
      // Which element carries the diagram's name, so the pane can be told to name it.
      out.nameElement = (function () {
        var nodes = d.querySelectorAll('div, span, a, td');
        for (var i = 0; i < nodes.length; i++) {
          if (nodes[i].children.length === 0 && (nodes[i].textContent || '').trim() === 'Untitled Diagram') {
            return { tag: nodes[i].tagName, cls: String(nodes[i].className), id: nodes[i].id || null };
          }
        }
        return null;
      })();
      var dialog = d.querySelector('.geDialog');
      out.dialog = dialog === null ? null : (dialog.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
      var root = d.documentElement;
      out.documentScroll = { top: root.scrollTop, height: root.scrollHeight, viewport: root.clientHeight };
      out.bodyScrollTop = d.body.scrollTop;
      var popup = d.querySelector('.mxPopupMenu');
      if (popup !== null) {
        var rect = popup.getBoundingClientRect();
        out.menu = {
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          height: Math.round(rect.height),
          styleTop: popup.style.top,
          offsetTop: popup.offsetTop,
          offsetParent: popup.offsetParent === null ? null : popup.offsetParent.tagName,
          popups: d.querySelectorAll('.mxPopupMenu').length,
          content: popup.scrollHeight,
          client: popup.clientHeight,
          items: popup.querySelectorAll('tr').length,
          scrolls: popup.scrollHeight > popup.clientHeight + 1,
          overflowY: w.getComputedStyle(popup).overflowY,
          inlineHeight: popup.style.height || null,
          inlineMaxHeight: popup.style.maxHeight || null,
          belowViewport: Math.round(rect.bottom) > root.clientHeight,
        };
      }
    } catch (e) { out.error = String(e).split('\\n')[0].slice(0, 200) }
    return out;
  }
  // Once the canvas is up, press Save: the write path can only be exercised on a
  // diagram that exists, and the press has to happen in the page, timed by what the
  // page can see, rather than from the test on a guess about how long boot takes.
  // The menu follows, because the write path finishes with the pane still drawn.
  var pressed = false;
  var opened = false;
  var savedFromMenu = false;
  var ticks = 0;
  var tickError = null;
  var postFailures = 0;
  (function tick() {
    var state = { ticks: ++ticks };
    // A throw anywhere in here -- including inside the editor's own handlers, which
    // run synchronously inside a dispatched click -- would end this loop silently and
    // leave the run looking like nothing was ever clicked.
    try {
      state = inspect();
      state.ticks = ticks;
      if (!pressed && state.canvas === true && state.labelDrawn === true) {
        pressed = true;
        pressCtrlS();
      }
      if (pressed && !opened) { opened = true; window.openFileMenu(); }
      // Save is clicked on the first tick that sees the menu, because the menu is the
      // editor's own and closes on its own schedule.
      if (opened && !savedFromMenu && state.menu !== undefined) { savedFromMenu = true; window.clickSaveInMenu(); }
    } catch (error) {
      tickError = String(error).split('\\n')[0].slice(0, 200);
    }
    state.pressed = pressed;
    state.opened = opened;
    state.clicked = savedFromMenu;
    state.tickError = tickError;
    state.hostHref = location.href.slice(-24);
    state.hostReady = document.readyState;
    state.postFailures = postFailures;
    fetch('/__report', { method: 'POST', body: JSON.stringify(state) })
      .catch(function () { postFailures++; });
    setTimeout(tick, 2000);
  })();
  document.getElementById('ed').src = ${JSON.stringify(host.editorUrl(DIAGRAM, ORIGIN, 'dsh-plugin-flow.drawio'))};
</script>
</body></html>`

const profile = mkdtempSync(join(tmpdir(), 'cdp-boot-'))

/**
 * Reserve a free port for Chrome's debugging endpoint.
 *
 * A fixed port is not safe here: a debugger left running by an earlier probe still
 * owns it, the new Chrome silently fails to publish an endpoint, and the connect
 * loop spins until the watchdog fires with no output at all.
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
  const severe = []
  let downloads = 0
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id !== undefined) { const s = pending.get(m.id); if (s) { pending.delete(m.id); s(m) }; return }
    if (m.method === 'Page.downloadWillBegin' || m.method === 'Browser.downloadWillBegin') {
      // drawio's own Save writes a copy through the browser's download flow. Nothing
      // in this pane may do that: the file it opened is the one to write.
      downloads += 1
      return
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
      if (text.includes('SEVERE')) severe.push(text.slice(0, 240))
      return
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const details = m.params.exceptionDetails
      severe.push(String(details?.exception?.description ?? details?.text).slice(0, 240))
    }
  })
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++seq
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
  })

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: `${ORIGIN}/__boot-host.html` })

  // drawio parses a 9.7 MB app.min.js, its stencils and its shape libraries before
  // it builds a canvas; the first seconds are always the splash. The wait ends when
  // the page has both drawn the diagram and reported it, so the assertions below
  // never race the press the page itself makes once the canvas exists.
  const deadline = Date.now() + 50000
  let state = {}
  while (Date.now() < deadline) {
    await sleep(2000)
    if (report === undefined) continue
    state = JSON.parse(report)
    if (state.canvas === true && state.labelDrawn === true && (state.autosaves ?? 0) >= 1 && state.menu !== undefined) break
  }

  check('the frame reported its state', report !== undefined, report === undefined ? 'the page never ran its timer' : '')
  check('the frame is the editor document the plugin serves', state.path === host.EDITOR_PATH, String(state.path))
  check('the editor took the diagram from its URL', state.hashRestored === true)
  check('drawio finished booting its scripts', state.readyState === 'complete', String(state.readyState))
  check('drawio replaced its splash page with the editor', state.splashPresent === false)
  check('the editor drew its canvas', state.canvas === true)
  check('the editor drew the diagram it was given', state.labelDrawn === true, `${state.cells ?? 0} svg groups`)
  check('the title is drawio\'s own', String(state.title ?? '').includes('draw.io'), String(state.title))
  check('the shim hooked the editor class', state.shim?.hooked === true, JSON.stringify(state.shim ?? null))
  check('the shim captured the editor instance', (state.shim?.installs ?? 0) >= 1, JSON.stringify(state.shim ?? null))
  // The shim is host-half code served from the host process's memory, so which
  // revision the browser is actually running is worth asserting rather than assuming.
  check('the running shim is this build', state.shim?.revision === host.SHIM_REVISION, String(state.shim?.revision))
  // Save is bound by name, and the names are drawio's, not this package's: if the
  // editor ever renames the command, this is what notices.
  for (const name of ['save', 'saveAs']) {
    check(`drawio's ${name} command exists and was rebound`, (state.shim?.rebound ?? []).includes(name), JSON.stringify(state.shim?.rebound ?? null))
  }
  // The whole client half of the write path, end to end in a browser: the key the
  // user presses in the real editor produces the autosave the pane writes to disk.
  check('pressing Ctrl+S in the editor reports the diagram', (state.shim?.reports ?? 0) >= 1, JSON.stringify(state.shim ?? null))
  check('the parent received the diagram as an autosave', (state.autosaves ?? 0) >= 1, `${state.autosaves ?? 0} message(s)`)
  check('the reported diagram is the one on the canvas', state.autosaveHasLabel === true, `${state.lastAutosaveBytes ?? 0} bytes`)
  // Where the menu renders, not where its style says it is. mxgraph's common.css is what
  // makes a popup absolutely positioned; without it drawio's own coordinates are ignored
  // and the menu flows into the document below the toolbar, which is the reported "the
  // menu opens at the bottom of the page".
  check('the editor menu opens', state.menu !== undefined, JSON.stringify(state.error ?? ''))
  console.log(`     menu bar at ${state.menuBarTop}, menu ${JSON.stringify(state.menu ?? null)}`)
  check('the editor document holds no scroll position', state.documentScroll?.top === 0 && state.bodyScrollTop === 0, JSON.stringify({ root: state.documentScroll ?? null, body: state.bodyScrollTop ?? null }))
  check(
    'a menu renders at its menu bar, not below the toolbar',
    state.menu !== undefined && state.menuBarTop !== null && state.menu.top - state.menuBarTop <= 80,
    `menu renders at ${state.menu?.top}, menu bar at ${state.menuBarTop}`,
  )
  check('the open menu stays inside the editor viewport', state.menu?.belowViewport === false, JSON.stringify(state.menu ?? null))
  // Save, reached through drawio's own menu, must report the diagram and must not
  // start the browser's download flow -- which is how a second copy gets written
  // somewhere this pane never sees. Save is drawio's own command, and it is reached
  // from four places: the File menu, the toolbar button, the status banner's "click
  // here to save", and the keyboard shortcut. The File menu captured its action when
  // the menu was built, so what makes all four write the file back is owning the one
  // method they all call. A synthetic click cannot reach a menu row (it acts on a
  // pointer gesture), so the behaviour of the funnel is asserted in tests/shim.mjs
  // and its ownership, in the real editor, is asserted here.
  check('the shim owns drawio\'s save funnel', state.shim?.saveFileOwned === true, JSON.stringify(state.shim ?? null))
  check('the Save command starts no download', downloads === 0, `${downloads} download(s)`)
  check('the Save command opens no save dialog', state.dialog === null, String(state.dialog ?? ''))
  // The editor labels the diagram after the file the pane opened, rather than
  // "Untitled Diagram", which names nothing the user can recognise.
  check('the editor shows the file name it was given', state.fileLabel === 'dsh-plugin-flow.drawio', String(state.fileLabel ?? ''))
  check('the editor reported no initialization failure', severe.length === 0, severe.slice(0, 2).join(' | '))
  console.log(`     name element: ${JSON.stringify(state.nameElement ?? null)} | title: ${JSON.stringify(state.title ?? '')}`)
} catch (error) {
  console.error('boot probe failed:', error.message)
  failures += 1
}

if (failures > 0) console.error(`${failures} check(s) failed`)
else console.log('OK: the editor boots inside the pane and reports the diagram it holds')
await finish(failures > 0 ? 1 : 0)
