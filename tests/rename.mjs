import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, relative, resolve, isAbsolute, sep } from 'node:path'
import { apply, RENAME_ROUTE } from '../lib/index.mjs'

const directory = await mkdtemp(join(tmpdir(), 'dsh-drawio-rename-'))
const outside = await mkdtemp(join(tmpdir(), 'dsh-drawio-outside-'))
const source = join(directory, '2026-09-29_09-00-00-000.drawio')
const occupied = join(directory, 'occupied.drawio')
const outsider = join(outside, 'outside.drawio')
await writeFile(source, '<mxGraphModel/>')
await writeFile(occupied, 'do not replace')
await writeFile(outsider, 'do not touch')
const routes = new Map()
const ctx = {
  effect: fn => { fn(); return () => {} },
  webServer: { register: route => { routes.set(route.path, route); return () => {} } },
  sessions: { get: id => id === 'board-session' ? { header: { cwd: directory } } : undefined },
  sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: directory }) },
  fs: {
    resolve: async path => ({ path: resolve(path) }),
    processPath: target => target.path,
    contains: (parent, child) => {
      const path = relative(parent.path, child.path)
      return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
    },
    lstat: async path => {
      try { const info = await stat(path); return { type: info.isFile() ? 'file' : 'other' } }
      catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
    },
    stat: async target => {
      try { const info = await stat(target.path); return { type: info.isFile() ? 'file' : 'other', version: `${info.mtimeMs}-${info.size}` } }
      catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
    },
  },
}
apply(ctx)
const server = createServer((req, res) => { void routes.get(RENAME_ROUTE).handler(req, res) })
await new Promise(done => server.listen(0, '127.0.0.1', done))
const url = `http://127.0.0.1:${server.address().port}${RENAME_ROUTE}`
async function rename(path, name, version = '') {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, name, version, sessionId: 'board-session' }) })
  return { status: response.status, body: await response.json() }
}
try {
  const denied = await rename(outsider, 'stolen')
  assert.equal(denied.status, 403)
  assert.equal(await readFile(outsider, 'utf8'), 'do not touch')
  const collision = await rename(source, 'occupied')
  assert.equal(collision.status, 409)
  assert.equal(await readFile(occupied, 'utf8'), 'do not replace')
  const traversal = await rename(source, '../escape')
  assert.equal(traversal.status, 400)
  const stale = await rename(source, 'system', 'stale-version')
  assert.equal(stale.body.code, 'FS_STALE_VERSION')
  const saved = await rename(source, '系统架构')
  assert.equal(saved.status, 200, JSON.stringify(saved.body))
  assert.equal(saved.body.path, join(directory, '系统架构.drawio'))
  assert.equal(await readFile(saved.body.path, 'utf8'), '<mxGraphModel/>')
  assert.deepEqual((await readdir(directory)).sort(), ['occupied.drawio', '系统架构.drawio'].sort())
  console.log('OK: rename preserves content, rejects collisions, stale versions, traversal, and files outside the session workspace')
} finally {
  await new Promise(done => { server.closeAllConnections(); server.close(done) })
  await rm(directory, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
}
