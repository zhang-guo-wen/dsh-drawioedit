/**
 * The draw.io editor's browser-side contract.
 *
 * The editor is the upstream drawio webapp, served as static files from this
 * package's `editor/` directory. It is an application, not a component, so it
 * runs in an iframe and the two halves talk over the URL and `postMessage`
 * rather than through React props.
 */
import { EDITOR_PATH, editorUrl, SAVE_PATH } from '../params.ts'

export { EDITOR_PATH, editorUrl, SAVE_PATH }

/** One message the editor posts back to its parent. */
export interface EditorMessage {
  /** Protocol event name: `load`, `autosave`, `export`, `viewbox`, `layout`, or `fit`. */
  readonly event: string
  /** The diagram XML, present on `load` and `autosave`. */
  readonly xml?: string
}

/**
 * Read one `postMessage` payload as an editor event.
 * @param data - the raw message data.
 * @returns the parsed message, or undefined when it is not one.
 */
export function parseEditorMessage(data: unknown): EditorMessage | undefined {
  if (typeof data !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(data)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const event = (parsed as { event?: unknown }).event
    if (typeof event !== 'string') return undefined
    const xml = (parsed as { xml?: unknown }).xml
    return { event, ...(typeof xml === 'string' ? { xml } : {}) }
  } catch {
    // A non-JSON payload is another protocol's traffic, not an editor event.
    return undefined
  }
}

/**
 * Post an edited diagram back to the host.
 *
 * The write is a host capability, so it goes over the application origin rather
 * than the read-only Workspace Files seam.
 * @param path - absolute path of the file the diagram came from.
 * @param xml - the diagram XML the editor reported.
 * @param version - the freshness token the previous read or write reported.
 * @returns the freshness token the write produced, for the next save.
 * @throws when the host refuses the write, carrying its reason.
 */
export async function saveDiagram(path: string, xml: string, version: string): Promise<string> {
  const response = await fetch(SAVE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, xml, version }),
  })
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const reason = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `HTTP ${response.status}`
    throw new Error(reason)
  }
  const next = typeof body === 'object' && body !== null ? (body as { version?: unknown }).version : undefined
  // A host that does not report the new token yields an empty one, which the next
  // save sends as no guard rather than as a stale one.
  return typeof next === 'string' ? next : ''
}
