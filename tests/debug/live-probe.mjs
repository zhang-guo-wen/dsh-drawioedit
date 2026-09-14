// tests/debug/live-probe.mjs — open the RUNNING DSH web GUI and report what the
// console says. Used against 127.0.0.1:3080; read-only, it clicks nothing.
//
// The point is to see the real error rather than infer it from source.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TARGET = process.env.DSH_URL ?? 'http://127.0.0.1:3080'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = mkdtempSync(join(tmpdir(), 'cdp-live-'))

const watchdog = setTimeout(() => { console.error('watchdog'); process.exit(2) }, 120000)
watchdog.unref?.()

/** A free port: a leftover debugger from an earlier probe would hold a fixed one. */
const probeServer = createServer()
await new Promise((r) => { probeServer.listen(0, '127.0.0.1', r) })
const PORT = probeServer.address().port
await new Promise((r) => { probeServer.close(r) })

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
  '--window-size=1600,1000', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws
try {
  let list
  for (let i = 0; i < 60; i++) {
    try {
      list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      if (list.some((t) => t.type === 'page')) break
    } catch { /* not up */ }
    await sleep(250)
  }
  const page = list?.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')

  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', () => { rej(new Error('ws')) }, { once: true })
  })

  let seq = 0
  const pending = new Map()
  const logs = []
  const failures = []
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id !== undefined) { const s = pending.get(m.id); if (s) { pending.delete(m.id); s(m) }; return }
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
      logs.push(`${m.params.type}: ${text}`.slice(0, 300))
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push(`EXCEPTION: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`.slice(0, 400))
    }
    if (m.method === 'Network.loadingFailed') {
      failures.push(`${m.params.type} ${m.params.errorText} ${m.params.blockedReason ?? ''}`)
    }
  })
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++seq
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
  })

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Network.enable')
  console.log('navigating to', TARGET)
  await send('Page.navigate', { url: TARGET })
  await sleep(30000)

  const title = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true })
  console.log('title:', title.result?.result?.value)

  console.log('\n== console (last 30) ==')
  console.log(logs.slice(-30).join('\n') || '(none)')

  console.log('\n== failed requests (unique) ==')
  console.log([...new Set(failures)].slice(0, 15).join('\n') || '(none)')

  // Anything the pane is showing.
  const text = await send('Runtime.evaluate', {
    expression: `document.body.innerText.slice(0, 600)`,
    returnByValue: true,
  })
  console.log('\n== visible text ==')
  console.log(text.result?.result?.value ?? '(none)')
} finally {
  try { ws?.close() } catch { /* closed */ }
  try { chrome.kill('SIGKILL') } catch { /* gone */ }
  clearTimeout(watchdog)
  process.exit(0)
}
