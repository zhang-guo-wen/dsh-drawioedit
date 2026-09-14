// tests/shim.mjs — verify the shim source without a browser.
//
// The shim is a string this package serves, so its correctness is:
//   1. it parses as JavaScript (a template-literal mistake ships a broken script);
//   2. it installs the assignment hook on window.EditorUi;
//   3. it captures an instance constructed after the hook, and reports edits.
//
// A `vm` context stands in for the editor window: the shim only touches `window`,
// `Object`, `JSON`, `Reflect`, and timers.
import { strict as assert } from 'node:assert'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const mod = await import(pathToFileURL(join(here, '..', 'lib', 'index.mjs')).href)

// The build already asserts this at module load; repeat it here so the test names
// the check rather than relying on the import side effect.
mod.assertShimUsable?.(mod.SHIM_SOURCE)
assert.ok(typeof mod.SHIM_SOURCE === 'string' && mod.SHIM_SOURCE.length > 200, 'shim source is missing')

let failures = 0
const check = (label, ok) => { if (!ok) failures += 1; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`) }

// 1. It parses. `new vm.Script` throws on any syntax error, which is exactly the
// failure a stray backtick in the template literal produces.
let compiled
try {
  compiled = new vm.Script(mod.SHIM_SOURCE, { filename: 'shim.js' })
  check('shim source parses as JavaScript', true)
} catch (error) {
  check(`shim source parses as JavaScript (${error.message})`, false)
}

// 2/3. It hooks the global and captures an instance constructed afterwards.
const posted = []
const intervals = []
const listeners = []
const sandbox = {
  console,
  JSON,
  Object,
  Reflect,
  setTimeout: () => 0,
  setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length },
  clearInterval: () => {},
}
sandbox.window = sandbox
sandbox.parent = { postMessage: (data) => { posted.push(data) } }
sandbox.addEventListener = (type, fn) => { listeners.push({ type, fn }) }
sandbox.EditorUi = undefined
sandbox.mxResources = { get: (key) => (key === 'allChangesSaved' ? 'All changes saved' : null) }
sandbox.globalThis = sandbox

try {
  compiled.runInNewContext(sandbox)
  check('shim runs without throwing', true)

  // The editor defines the class after the shim; the hook must wrap it then.
  let xml = '<mxGraphModel/>'
  const writes = { modified: null, status: null }
  const actions = new Map()
  function EditorUi() {
    this.graph = {
      getModel: () => ({ getRoot: () => ({}) }),
    }
    this.getFileData = () => xml
    // The method every save command reaches, which the shim must replace.
    this.saveFile = () => { throw new Error('the shim must intercept saveFile') }
    this.actions = { get: (name) => actions.get(name) ?? null }
    this.editor = {
      setModified: (value) => { writes.modified = value },
      setStatus: (html) => { writes.status = html },
    }
  }
  actions.set('save', { funct: () => { throw new Error('the shim must rebind this') } })
  actions.set('saveAs', { funct: () => { throw new Error('the shim must rebind this') } })
  sandbox.EditorUi = EditorUi // triggers the setter
  check('shim installed the assignment hook', sandbox.__dshShimState.hooked === true)

  const instance = new sandbox.EditorUi()
  check('shim captured the constructed instance', sandbox.__dshShimState.installs === 1)
  check('the captured class still behaves as the original', typeof instance.getFileData === 'function')

  // The message listener must accept the host's create action.
  const messageListener = listeners.find((entry) => entry.type === 'message')
  check('shim registered its own message listener', messageListener !== undefined)

  // The report timer must be installed so edits reach the host. Setup also retries on a
  // short interval, because the editor's own helpers only exist once its bundle loads.
  const tick = intervals.find((entry) => entry.ms === 1000)?.fn
  check('shim installed the change-report timer', tick !== undefined, intervals.map((entry) => entry.ms).join(', '))
  check('shim retries its setup until the editor helpers exist', intervals.some((entry) => entry.ms === 100))

  // The first tick adopts the diagram it finds as the baseline: opening a file is
  // not an edit, and reporting it would write the file back on every open.
  tick()
  check('the first tick reports nothing', posted.length === 0, posted.join(' | '))

  // A modification has to reach the host, once, as the autosave protocol event.
  xml = '<mxGraphModel changed="1"/>'
  tick()
  tick()
  check('a change is reported exactly once', posted.length === 1, `${posted.length} message(s)`)
  check(
    'the report is an autosave carrying the XML',
    posted[0] === JSON.stringify({ event: 'autosave', xml: '<mxGraphModel changed="1"/>' }),
    posted[0],
  )

  // The actions are the path the status banner takes, and it looks its action up when
  // it is clicked, so replacing the action's function is enough for it.
  check('the shim rebound a save action', sandbox.__dshShimState.rebound.includes('save'))
  for (const name of ['save', 'saveAs']) {
    posted.length = 0
    actions.get(name).funct()
    check(`the ${name} action reports the diagram`, posted.length === 1, `${posted.length}`)
  }

  // The File menu captured its action when the menu was built, before this shim had
  // an instance, so its own save command reaches drawio's saveFile instead. That is
  // where the interception has to sit, or the menu opens drawio's save dialog.
  let saveFileCalls = 0
  instance.saveFile = () => { saveFileCalls += 1 }
  tick() // the poll re-applies the interception if anything replaced it
  check('the shim re-applies the save interception', sandbox.__dshShimState.saveFileOwned === true)
  posted.length = 0
  instance.saveFile(false)
  check('the save funnel no longer reaches drawio\'s saveFile', saveFileCalls === 0, `${saveFileCalls} call(s)`)
  check('the save funnel reports the diagram', posted.length === 1, `${posted.length} message(s)`)

  // A confirmed write is what clears drawio's "Unsaved changes" notice.
  messageListener.fn({ data: JSON.stringify({ action: 'saved' }) })
  check('the host\'s confirmation clears the modified flag', writes.modified === false, String(writes.modified))
  check(
    'the confirmation shows drawio\'s own saved text',
    typeof writes.status === 'string' && writes.status.includes('All changes saved'),
    String(writes.status),
  )
  check('the confirmation is counted for diagnosis', sandbox.__dshShimState.saved === 1)
} catch (error) {
  check(`shim behaviour (${error.message})`, false)
}

if (failures > 0) throw new Error(`${failures} check(s) failed`)
console.log('OK: the shim parses, hooks the editor class, and captures instances')
