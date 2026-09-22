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
  createElement: () => ({}),
  useEffect: (fn) => { effects.push(fn) },
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, (next) => { states.push(next) }],
}
// Only what the shell seeds. A request for a node core module must fail here,
// which is what the real loader does.
const table = {
  react,
  'react/jsx-runtime': { jsx: react.createElement, jsxs: react.createElement },
  '@deepseek-ai/dsh-client-ui-slots': {},
  '@deepseek-ai/dsh-client-ui-sidebar-right/client': {},
  '@deepseek-ai/dsh-client-locale/client': {},
  '@deepseek-ai/dsh-client-ui-renderer/client': {},
}

window.__ModuleLoader__ = { load: (handoff) => { window.__handoff = handoff } }
new Function('window', source)(window)

const handoff = window.__handoff
assert.ok(handoff, 'client bundle did not register a handoff')
assert.equal(handoff.id, '@zhang-guo-wen/dsh-drawioedit', 'handoff id mismatch')

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

const registered = { dictionaries: null, type: null, body: null }
moduleExports.apply({
  effect: (fn) => fn(),
  locale: {
    register: (namespace, dictionaries) => { registered.dictionaries = { namespace, dictionaries }; return () => {} },
    bind: () => (key) => key,
  },
  sidebarRightTabs: { register: (definition) => { registered.type = definition; return () => {} } },
  slots: {
    inject: (_name, callback) => callback(),
    register: (options, component) => { registered.body = { options, component }; return () => {} },
  },
  remote,
})

assert.equal(registered.dictionaries.namespace, 'sidebarDrawioEdit', 'dictionary namespace mismatch')
assert.equal(registered.type.kind, 'drawio-edit', 'tab kind mismatch')
assert.equal([...registered.type.patterns].join(','), '*.drawio', 'patterns mismatch')
assert.equal(registered.type.title('dsh-resource://file/session/s1/a/flow.drawio'), 'flow.drawio', 'title mismatch')
assert.equal(registered.body.options.name, 'sidebar.right.pane.tab', 'slot name mismatch')
assert.equal(registered.body.options.key, '@zhang-guo-wen/dsh-drawioedit', 'slot key mismatch')

// The tab seat's injected compartment declares only its `tabInfo` hook, so the
// body carries no custom inject face; the transports are installed by apply, and
// apply would have thrown if their shape were wrong.
assert.equal(registered.body.options.inject, undefined, 'the body must not declare a custom inject face')

// Mount the body the way the tab seat does and run its effects. Only the read has
// work to do at mount; the save effect returns early while nothing is loaded.
const tab = {
  contentId: 'dsh-resource://file/session/session-1/diagrams/flow.drawio',
  signal: new AbortController().signal,
}
registered.body.component({ useTabInfo: () => ({ tab }), t: (key) => key })
assert.ok(effects.length > 0, 'the body must arm its effects')
const cleanups = effects.map(effect => effect())
await settle(0)
for (const cleanup of cleanups) cleanup?.()

assert.equal(reads.length, 1, 'the body must read through workspaceFiles.readBytes')
assert.equal(reads[0].sessionId, 'session-1', 'the read must name the session in the address')
assert.equal(reads[0].path, 'diagrams/flow.drawio', 'the read must name the path in the address')
assert.deepEqual(reads[0].options, {}, 'a complete-file read passes no range')
assert.ok(reads[0].signal instanceof AbortSignal, 'the read must carry the tab lifetime')

const ready = states.find(state => state?.kind === 'ready')
assert.ok(ready, `the read must load the diagram; states: ${JSON.stringify(states)}`)
assert.equal(ready.xml, DIAGRAM, 'the bytes must reach the editor as the diagram text, undecoded')
assert.equal(ready.absolutePath, ABSOLUTE_PATH, 'the host-resolved path must reach the save')
assert.equal(ready.version, VERSION, 'the freshness token must reach the save')

console.log('OK: no node-core request; registers the tab type, the body, and reads the diagram through readBytes')
