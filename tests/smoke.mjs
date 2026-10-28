// tests/smoke.mjs — load the BUILT lib/client.js the way the browser module table
// does, prove the plugin registers its tab type and its body without asking the
// module table for anything the shell does not seed, and drive the body's read
// against the Client Remote so a call the namespace does not carry cannot pass as
// a registration.
//
// The complete-file read is `workspaceFiles.readBytes` with no range and it hands
// back NATIVE bytes: the Remote decodes them before the client sees them, so a
// base64 decode here reads nothing. The rest of the edit→save chain is covered by
// tests/save.mjs at the HTTP boundary.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { setTimeout as settle } from 'node:timers/promises'
import { JSDOM } from 'jsdom'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
const { window } = new JSDOM('<!doctype html><html><body></body></html>')

// The render machinery the body touches, with effects held so the test can run
// the read the body would run on mount and observe what it wrote back.
const effects = []
const states = []
const react = {
  createElement: (type, props) => ({ type, props }),
  useEffect: (fn) => { effects.push(fn) },
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, (next) => { states.push(next) }],
}
// Only what the shell seeds. A request for a node core module must fail here,
// which is what the real loader does.
const table = {
  react,
  // The bundle imports the runtime's `jsx`/`jsxs` directly and calls them as
  // plain functions, so these are element factories rather than methods.
  'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  '@deepseek-ai/dsh-client-ui-slots': {},
  '@deepseek-ai/dsh-client-ui-sidebar-right/client': {},
  '@deepseek-ai/dsh-client-locale/client': {},
  '@deepseek-ai/dsh-client-ui-renderer/client': {},
}

window.__ModuleLoader__ = { load: (handoff) => { window.__handoff = handoff } }
new Function('window', source)(window)

const handoff = window.__handoff
assert.ok(handoff, 'client bundle did not register a handoff')
assert.equal(handoff.id, '@guowenzhang/dsh-drawioedit', 'handoff id mismatch')

const requested = []
const moduleExports = handoff.factory((specifier) => {
  requested.push(specifier)
  if (!Object.hasOwn(table, specifier)) throw new Error(`missed the module table: ${specifier}`)
  return table[specifier]
})
console.log('factory requested:', requested.join(', ') || '(none)')

assert.equal(typeof moduleExports.apply, 'function', 'plugin exports no apply')

// What the Host returns from a complete-file read: the native bytes, the absolute
// path it resolved, and the freshness token for exactly those bytes. `readAll` is
// not part of the namespace, so an outdated call finds nothing here.
const DIAGRAM = '<mxfile host="dsh"><diagram id="d1" name="Page-1"/></mxfile>'
const ABSOLUTE_PATH = 'C:/workspace/diagrams/flow.drawio'
const VERSION = '1758000000000-4096'
const reads = []
const remote = {
  workspaceFiles: {
    readBytes: async (sessionId, path, options, signal) => {
      reads.push({ sessionId, path, options, signal })
      return {
        ok: true,
        value: {
          absolutePath: ABSOLUTE_PATH,
          version: VERSION,
          bytes: DIAGRAM.length,
          offset: 0,
          eof: true,
          data: new TextEncoder().encode(DIAGRAM),
        },
      }
    },
  },
}

const registered = { dictionaries: null, type: null, body: null, viewers: [], injected: 0 }
/** Body component declarations, so the render harness can drive one directly. */
const declarations = []
/** The workbench service the viewer registers with, keyed by viewer id. */
const workbench = new Map()
moduleExports.apply({
  effect: (fn) => fn(),
  // Loaded with the workbench present, so both hosts are exercised: the Sidebar
  // tab and the workbench viewer.
  inject: (_deps, callback) => {
    registered.injected += 1
    callback({
      effect: (fn) => fn(),
      get: (name) => name === 'betterSidebar'
        ? { registerFileViewer: (viewer) => { workbench.set(viewer.id, viewer); return () => {} } }
        : undefined,
      locale: {
        register: (namespace, dictionaries) => { registered.dictionaries = { namespace, dictionaries }; return () => {} },
        bind: () => (key) => key,
      },
      remote,
    })
  },
  locale: {
    register: (namespace, dictionaries) => { registered.dictionaries = { namespace, dictionaries }; return () => {} },
    bind: () => (key) => key,
  },
  sidebarRightTabs: { register: (definition) => { registered.type = definition; return () => {} } },
  slots: {
    inject: (_name, callback) => callback(),
    register: (options, component) => {
      registered.body = { options, component }
      // Compact parameter-list components land here as FRAMEWORK_ROWS rows; the
      // declaration holds the real parameters to render with.
      declarations.push(component)
      return () => {}
    },
  },
  remote,
})

assert.equal(registered.dictionaries.namespace, 'sidebarDrawioEdit', 'dictionary namespace mismatch')
assert.equal(registered.type.kind, 'drawio-edit', 'tab kind mismatch')
// The pattern is address-shaped on purpose: the Sidebar ranks band, then matched
// pattern length, then registration order, and a bare `*.drawio` (8) loses to a
// workbench's `dsh-resource://file/**` catch-all (22), which would hand the file
// to that workbench's own editor before the suffix is considered. The
// address-shaped pattern is longer than the catch-all and still matches only
// `.drawio` files.
assert.equal([...registered.type.patterns].join(','), 'dsh-resource://file/**/*.drawio', 'patterns mismatch')
assert.equal(registered.type.priority, 'extension', 'the tab type must declare its priority band')
assert.equal(registered.type.title('dsh-resource://file/session/s1/a/flow.drawio'), 'flow.drawio', 'title mismatch')
assert.equal(registered.type.title('dsh-resource://file/session/s1/a/AI%E5%91%98%E5%B7%A5%E6%9E%B6%E6%9E%84%E5%9B%BE.drawio'), 'AI员工架构图.drawio', 'Chinese tab title mismatch')
assert.equal(registered.body.options.name, 'sidebar.right.pane.tab', 'slot name mismatch')
assert.equal(registered.body.options.key, '@guowenzhang/dsh-drawioedit', 'slot key mismatch')

// The tab seat's injected compartment declares only its `tabInfo` hook, so the
// body carries no custom inject face; the transports are installed by apply, and
// apply would have thrown if their shape were wrong.
assert.equal(registered.body.options.inject, undefined, 'the body must not declare a custom inject face')

// The workbench viewer registers only through `betterSidebar`, is keyed by its
// own unique id, and declares the band that beats the workbench's own catch-all
// editor.
assert.equal(registered.injected, 1, 'apply must load the workbench viewer through inject')
const viewer = workbench.get('guowenzhang:drawio-edit')
assert.ok(viewer, 'the workbench viewer must register under its own id')
assert.equal([...viewer.exts].join(','), 'drawio', 'the viewer must claim .drawio only')
assert.equal(viewer.fetchStrategy, 'fsRead', 'the viewer reads through the workbench text path')
assert.ok(viewer.priority > 0, 'the viewer must outrank the workbench catch-all editor')

// A viewer mounted by the workbench draws the switch, since that host replaces
// the whole pane: the diagram is segment one and the source editor offers the way
// back. It also reads the file itself, which is what carries the freshness token.
const viewerRender = viewer.component({ scope: { sessionId: 'session-1' }, path: 'diagrams/flow.drawio' })
assert.ok(viewerRender, 'the workbench viewer must render through the canvas')
assert.equal(typeof viewerRender.type, 'string', 'the mounted viewer must draw a host element, not another component')
assert.ok(typeof viewerRender.props.alternate === 'object' || typeof viewerRender.props.role === 'string',
  'the workbench viewer must offer the switch or announce its loading state')

// Mount the body the way the tab seat does -- through the hook face the module
// exposes to a direct render -- and run its effects. Only the read has work to do
// at mount; the save effect returns early while nothing is loaded.
const tab = {
  contentId: 'dsh-resource://file/session/session-1/diagrams/AI%E5%91%98%E5%B7%A5%E6%9E%B6%E6%9E%84%E5%9B%BE.drawio',
  signal: new AbortController().signal,
}
registered.body.component.__hooks = react
const bodyRender = registered.body.component({ useTabInfo: () => ({ tab }), t: (key) => key })
// The tab body forwards to the canvas, which is the component that arms the
// effects; render it with the props the body handed it.
const canvasRender = bodyRender.type({ ...bodyRender.props, hooks: react })
void canvasRender
assert.ok(effects.length > 0, 'the body must arm its effects')
const cleanups = effects.map(effect => effect())
await settle(0)
for (const cleanup of cleanups) cleanup?.()

assert.equal(reads.length, 1, 'the body must read through workspaceFiles.readBytes')
assert.equal(reads[0].sessionId, 'session-1', 'the read must name the session in the address')
assert.equal(reads[0].path, 'diagrams/AI员工架构图.drawio', 'the read must decode the path in the address')
assert.deepEqual(reads[0].options, {}, 'a complete-file read passes no range')
assert.ok(reads[0].signal instanceof AbortSignal, 'the read must carry the tab lifetime')

const ready = states.find(state => state?.kind === 'ready')
assert.ok(ready, `the read must load the diagram; states: ${JSON.stringify(states)}`)
assert.equal(ready.xml, DIAGRAM, 'the bytes must reach the editor as the diagram text, undecoded')
assert.equal(ready.absolutePath, ABSOLUTE_PATH, 'the host-resolved path must reach the save')
assert.equal(ready.sessionId, 'session-1', 'the editor must retain the read session for its save policy')
assert.equal(ready.version, VERSION, 'the freshness token must reach the save')

// Render the canvas with one state slot forced and the rest left at their
// initial values. The slot indices follow DrawioCanvas's own state order:
//   0 loaded · 1 failure · 2 write phase · 3 read attempt
// so inserting a state ahead of one of them fails this suite rather than
// silently rendering the wrong fixture.
function renderWith(forced, hooks = {}) {
  let index = 0
  const scripted = {
    ...react,
    useState: (initial) => {
      const at = index++
      return [Object.hasOwn(forced, at) ? forced[at] : initial, () => {}]
    },
    ...hooks,
  }
  // The body forwards to the canvas with its hook face attached; the canvas is
  // the component holding the states this fixture forces, and the dictionary
  // reaches it as its own `t` because nothing else binds one.
  const body = registered.body.component({ useTabInfo: () => ({ tab }), t: localized, __hooks: scripted })
  return body.type({ ...body.props, hooks: scripted, t: canvasT })
}

function childrenOf(rendered) {
  return Array.isArray(rendered.props.children) ? rendered.props.children : [rendered.props.children]
}

// A key the dictionary does not carry reads as the key itself, the way the
// locale binding behaves, so a stale phase cannot crash a render.
const localized = (key, params) => (registered.dictionaries.dictionaries.zh[key] ?? key)
  .replace('{name}', params?.name ?? '{name}')
// The canvas receives the dictionary directly: it is not a slot component, so
// nothing binds `t` for it and its own parameters must resolve here.
const canvasT = (key, params) => (registered.dictionaries.dictionaries.zh[key] ?? key)
  .replace('{name}', params?.name ?? '{name}')

// The ready body: the tab address is percent-encoded, while the draw.io filename
// and the accessible iframe title must show readable Chinese.
const children = childrenOf(renderWith({ 0: ready }))
const frame = children.find((child) => child?.type === 'iframe')
assert.ok(frame, 'the ready body must render the editor frame')
const params = JSON.parse(decodeURIComponent(frame.props.src.split('#P')[1]))
assert.equal(params.dshTitle, 'AI员工架构图.drawio', 'draw.io must receive the decoded filename')
assert.ok(frame.props.title.includes('AI员工架构图.drawio'), 'the iframe title must show readable Chinese')

// A write in flight is one of the two visible write states: it must be
// announced, and the frame must report itself busy.
const saving = childrenOf(renderWith({ 0: ready, 2: 'saving' }))
const savingLine = saving.find((child) => child?.props?.role === 'status')
assert.ok(savingLine, 'a write in flight must be announced')
assert.ok(savingLine.props.children.includes('正在保存'), 'the announcement must be localized')
const savingFrame = saving.find((child) => child?.type === 'iframe')
assert.ok(savingFrame, 'the editor frame must stay mounted while a write is in flight')

// The write phase has no "saved" value and no dictionary entry for one: the
// confirmed write belongs to drawio's own toolbar, so the pane draws a line only
// for a write in flight and a rename. Both halves are pinned here -- the bundle
// the browser loads rejects a phase for a landed write, and neither dictionary
// carries copy for one.
for (const [language, dictionary] of Object.entries(registered.dictionaries.dictionaries)) {
  assert.equal(
    dictionary.saved,
    undefined,
    `the ${language} dictionary must not carry a saved label for the pane to draw`,
  )
}
assert.match(
  source,
  /setPhase\(void 0\)/u,
  'a write that landed must clear the phase rather than announce itself',
)

// Whatever phase is settled -- the initial one, or a stale value this build no
// longer produces -- nothing is drawn above the frame and the frame stays mounted.
for (const phase of [undefined, 'saved']) {
  const settled = childrenOf(renderWith({ 0: ready, 2: phase }))
  assert.ok(
    settled.some((child) => child?.type === 'iframe'),
    `the editor frame must stay mounted for phase ${String(phase)}`,
  )
}
const settledPane = childrenOf(renderWith({ 0: ready, 2: undefined }))
assert.equal(
  settledPane.find((child) => child?.props?.role === 'status'),
  undefined,
  'a settled pane must draw nothing above the frame',
)

// A rejected save keeps its localized reason.
const deniedChildren = childrenOf(renderWith({ 0: ready, 1: { code: 'FS_SANDBOX_DENIED', message: 'raw sandbox error' } }))
const alert = deniedChildren.find((child) => child?.props?.role === 'alert')
assert.ok(alert, 'a rejected save must show an alert')
assert.ok(alert.props.children.includes('修改尚未保存'), 'the alert must explain that edits were not saved')
assert.ok(!alert.props.children.includes('raw sandbox error'), 'the alert must localize sandbox errors')

// A pending read is the placeholder the tab shows first, and it announces itself.
const loadingRender = renderWith({})
assert.equal(loadingRender.props.role, 'status', 'a pending read must announce itself')
assert.ok(
  childrenOf(loadingRender).some((child) => child?.props?.className?.includes('skeleton')),
  'a pending read must show the placeholder',
)

// A failed read offers the read again, in the same place as the failure.
const failedRender = renderWith({ 0: { kind: 'failed', address: tab.contentId, reason: 'read refused' } })
assert.equal(failedRender.props.role, 'alert', 'a failed read must show an alert')
assert.ok(
  childrenOf(failedRender).some((child) => child?.props?.className?.includes('retry')),
  'a failed read must offer a retry',
)

console.log('OK: no node-core request; registers the tab type, the body, and reads the diagram through readBytes')
