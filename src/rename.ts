import type { IncomingMessage, ServerResponse } from 'node:http'
import { link, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session-query'

export const RENAME_ROUTE = '/plugins/dsh-drawioedit/rename'

function fileName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('name must be text')
  const stem = value.trim().replace(/\.drawio$/iu, '')
  if (!stem || stem.length > 100 || /[<>:"/\\|?*\x00-\x1f]/u.test(stem) || /[. ]$/u.test(stem) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(stem)) {
    throw new Error('invalid diagram name')
  }
  return `${stem}.drawio`
}

export async function renameDiagram(ctx: Context, sourcePath: string, name: string, expectedVersion: string, sessionId: string): Promise<{ path: string; version: string }> {
  if (!sourcePath.toLowerCase().endsWith('.drawio')) throw new Error('not a draw.io file')
  const id = sessionId as SessionId
  const session = ctx.sessions.get(id)
  let policy
  if (session) {
    policy = ctx.sandboxPolicy.resolve({ session })
  } else {
    const observation = await ctx.sessionQuery.observeSession(id)
    try {
      const fallback = ctx.sandboxPolicy.resolve()
      const modeEvent = observation.events.findLast(event => event.type === 'sandbox/mode')
      policy = {
        mode: modeEvent?.type === 'sandbox/mode' ? modeEvent.data.mode : fallback.mode,
        workspaceRoot: observation.header.cwd ?? fallback.workspaceRoot,
        sessionId: id,
      }
    } finally { observation[Symbol.dispose]() }
  }
  if (policy.mode !== 'workspace-write' && policy.mode !== 'danger-full-access') {
    throw Object.assign(new Error('file access denied under current sandbox mode'), { code: 'FS_SANDBOX_DENIED' })
  }
  const fs = ctx.fs
  const source = await fs.resolve(sourcePath)
  const destinationPath = join(dirname(sourcePath), fileName(name))
  const destination = await fs.resolve(destinationPath)
  const parent = await fs.resolve(dirname(sourcePath))
  if (policy.mode === 'workspace-write') {
    const root = await fs.resolve(policy.workspaceRoot)
    if (!fs.contains(root, parent) || !fs.contains(root, source) || !fs.contains(root, destination)) {
      throw Object.assign(new Error('diagram is outside the session workspace'), { code: 'FS_SANDBOX_DENIED' })
    }
  }
  if (basename(sourcePath).toLowerCase() === basename(destinationPath).toLowerCase()) {
    const info = await fs.stat(source)
    if (!info || info.type !== 'file') throw new Error('diagram does not exist')
    return { path: sourcePath, version: info.version }
  }
  const pathInfo = await fs.lstat(sourcePath)
  const current = await fs.stat(source)
  if (pathInfo?.type !== 'file' || current?.type !== 'file') throw new Error('diagram is not a regular file')
  if (expectedVersion && current.version !== expectedVersion) {
    throw Object.assign(new Error('diagram changed since it was opened'), { code: 'FS_STALE_VERSION' })
  }
  // A hard link is exclusive: an existing destination is never overwritten.
  // Both names are in one directory, so the final unlink leaves the same bytes.
  const oldPath = fs.processPath(source)
  const newPath = fs.processPath(destination)
  await link(oldPath, newPath)
  try { await unlink(oldPath) }
  catch (error) { await unlink(newPath); throw error }
  const renamed = await fs.resolve(destinationPath)
  const info = await fs.stat(renamed)
  if (!info || info.type !== 'file') throw new Error('renamed diagram is unavailable')
  return { path: destinationPath, version: info.version }
}

export async function serveRenameRequest(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') { res.writeHead(405).end('method not allowed'); return }
  try {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > 4096) throw new Error('request body too large')
      chunks.push(chunk as Buffer)
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (typeof body !== 'object' || body === null) throw new Error('invalid request')
    const { path, name, version, sessionId } = body as Record<string, unknown>
    if (typeof path !== 'string' || typeof sessionId !== 'string' || typeof version !== 'string') throw new Error('invalid request')
    const result = await renameDiagram(ctx, path, name as string, version, sessionId)
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ ok: true, ...result }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined
    res.writeHead(code === 'FS_SANDBOX_DENIED' ? 403 : code === 'EEXIST' ? 409 : 400, { 'content-type': 'application/json; charset=utf-8' })
      .end(JSON.stringify({ ok: false, error: message, code }))
  }
}
