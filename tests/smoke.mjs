// tests/smoke.mjs — load the BUILT lib/client.js the way the browser module table
// does, and prove the plugin registers its tab type, its body, and its transports
// without asking the module table for anything the shell does not seed.
//
// The edit→save chain itself is covered by tests/save.mjs at the HTTP boundary and
// by the type checker, which is what enforces that the host-resolved absolute path
// reaches the save: the read result declares `absolutePath`, and the save transport
// takes it as its first parameter, so a mismatch does not compile.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
const { window } = new JSDOM('<!doctype html><html><body></body></html>')

const react = {
  createElement: () => ({}),
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, () => {}],
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
  '@deepseek-ai/dsh-util-workspace-path': {
    pathPartsOf: (p) => ({ directory: '', name: p }),
    parseFileAddress: () => undefined,
  },
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
  remote: {
    workspaceFiles: {
      readAll: async () => ({
        ok: true,
        value: { data: new Uint8Array(), absolutePath: 'C:/workspace/diagrams/flow.drawio' },
      }),
    },
  },
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

console.log('OK: no node-core request; registers the tab type, the body, and the transports')
