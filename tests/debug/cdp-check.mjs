// tests/cdp-check.mjs — minimal CDP sanity check: can this script start a
// headless Chrome, connect, and evaluate an expression? Run this first when the
// protocol probe reports nothing at all.
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = Number(process.env.CDP_PORT ?? 9500)
const profile = mkdtempSync(join(tmpdir(), 'cdp-check-'))
const log = (...args) => console.log('[cdp-check]', ...args)

const watchdog = setTimeout(() => { console.error('[cdp-check] watchdog'); process.exit(2) }, 60000)
watchdog.unref?.()

log('launching chrome on port', PORT)
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
  'about:blank',
], { stdio: 'ignore' })
chrome.on('exit', (code) => log('chrome exited', code))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let list
for (let i = 0; i < 60; i++) {
  try {
    list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    if (list.some((t) => t.type === 'page')) { log('cdp endpoint up after', i * 250, 'ms'); break }
  } catch { /* not up */ }
  await sleep(250)
}
if (!list) { console.error('cdp endpoint never came up'); process.exit(1) }

const page = list.find((t) => t.type === 'page')
log('page target:', page.url)
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true })
  ws.addEventListener('error', () => { rej(new Error('ws error')) }, { once: true })
})
log('websocket connected')

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

await send('Runtime.enable')
const result = await send('Runtime.evaluate', { expression: '1 + 1', returnByValue: true })
log('evaluate 1+1 =', result.result?.result?.value)

ws.close()
chrome.kill('SIGKILL')
clearTimeout(watchdog)
log('OK: cdp scaffolding works')
process.exit(0)
