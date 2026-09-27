/**
 * The save endpoint.
 *
 * Workspace Files is a read-only seam, so the edited diagram cannot go back
 * through the same channel it was read from. The write is a host capability, and
 * the browser reaches it over the one transport both halves already share: the
 * application origin. The endpoint is same-origin only, so a page that is not
 * this application cannot reach it.
 *
 * `fs.writeText` takes a freshness guard, and the guard is the point: an agent
 * write that landed while the editor was open is refused rather than silently
 * overwritten.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { FsVersion } from '@deepseek-ai/dsh-fs'

/** The URL the editor posts an edited diagram to. */
export const SAVE_ROUTE = '/plugins/dsh-drawioedit/save'

/** The bytes one save may carry; a diagram is text, not a data store. */
export const MAX_DIAGRAM_BYTES = 8 * 1024 * 1024

/** One save request as the editor's parent sends it. */
interface SaveRequest {
  /** Absolute path of the file the diagram came from. */
  readonly path?: unknown
  /** The diagram XML. */
  readonly xml?: unknown
  /** The version token the earlier read observed, when one was captured. */
  readonly version?: unknown
}

/**
 * Read a request body with a ceiling, refusing rather than truncating.
 * @param req - the incoming request.
 * @returns the body text.
 * @throws when the body exceeds the ceiling.
 */
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    total += buffer.length
    if (total > MAX_DIAGRAM_BYTES) throw new Error('body too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Validate one parsed save request.
 * @param body - the parsed JSON body.
 * @returns the path, XML, and optional version.
 * @throws when a required field is missing or malformed.
 */
export function parseSaveRequest(body: unknown): {
  readonly path: string
  readonly xml: string
  readonly version: string | undefined
} {
  if (typeof body !== 'object' || body === null) throw new Error('body must be an object')
  const { path, xml, version } = body as SaveRequest
  if (typeof path !== 'string' || path === '') throw new Error('path must be a non-empty string')
  if (typeof xml !== 'string' || xml === '') throw new Error('xml must be a non-empty string')
  if (version !== undefined && typeof version !== 'string') throw new Error('version must be a string')
  return { path, xml, version }
}

/**
 * Write a diagram back to the file it came from.
 * @param ctx - host context carrying the filesystem seam.
 * @param path - the path the file was read from.
 * @param xml - the diagram XML the editor reported.
 * @param expectedVersion - the version token the read observed, when captured.
 * @returns the write outcome.
 * @throws when the diagram exceeds the byte ceiling or the path cannot be resolved.
 */
export async function writeDiagram(
  ctx: Context,
  path: string,
  xml: string,
  expectedVersion?: string,
): Promise<unknown> {
  if (Buffer.byteLength(xml, 'utf8') > MAX_DIAGRAM_BYTES) {
    throw new Error(`dsh-drawioedit: diagram exceeds ${MAX_DIAGRAM_BYTES} bytes`)
  }
  const fs = ctx.fs
  const target = await fs.resolve(path)
  // The guard is a freshness precondition: a newer version on disk is a refusal,
  // not a silent overwrite of whatever an agent wrote in the meantime.
  const expected = expectedVersion === undefined
    ? undefined
    : { kind: 'replaceIfVersion' as const, version: expectedVersion as FsVersion }
  return await fs.writeText(target, xml, expected)
}

/**
 * Answer one save request.
 * @param ctx - host context carrying the filesystem seam.
 * @param req - the incoming request.
 * @param res - the response to own.
 */
export async function serveSaveRequest(
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405).end('method not allowed')
    return
  }
  try {
    const body: unknown = JSON.parse(await readBody(req))
    const { path, xml, version } = parseSaveRequest(body)
    const outcome = await writeDiagram(ctx, path, xml, version)
    // The editor keeps saving after this, so it needs the token the write
    // produced: offering the previous one again would fail as stale.
    const written = typeof outcome === 'object' && outcome !== null
      ? (outcome as { version?: unknown }).version
      : undefined
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      .end(JSON.stringify({ ok: true, version: typeof written === 'string' ? written : '' }))
  } catch (error: unknown) {
    // The editor shows this text, so it states the operation, not the internals.
    const message = error instanceof Error ? error.message : String(error)
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
      .end(JSON.stringify({ ok: false, error: message }))
  }
}
