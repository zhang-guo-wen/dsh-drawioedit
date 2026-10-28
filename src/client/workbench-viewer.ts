/**
 * The diagram editor as a file viewer inside the `better-sidebar` workbench.
 *
 * The Sidebar seats a `.drawio` file's body through this plugin's own tab type,
 * and that tab is still where the diagram is edited. A workbench that keeps its
 * own file tree reads a file itself and shows one viewer of it, so this module
 * registers the same editor there and draws the switch between it and the
 * workbench's source editor.
 *
 * The editor URL is built from the bytes this plugin reads itself, not from the
 * text the workbench hands over: the read also returns the freshness token the
 * first save offers, which is what keeps a save from overwriting a file an agent
 * changed while the diagram was open. Writes keep using the Host endpoint the
 * editor tab already uses.
 *
 * The workbench is reached only through its client service (`betterSidebar`):
 * it may not be installed, so the viewer registers from inside an `inject`
 * block and simply never runs on a host without it.
 *
 * @module @guowenzhang/dsh-drawioedit/client/workbench-viewer
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { DrawioCanvas, REACT_HOOKS } from './DrawioCanvas.tsx'
import type { DrawioSource } from './DrawioCanvas.tsx'
import { editorTransports } from './transports.ts'
import type { EditorTransports } from './transports.ts'
import type { DrawioEditKey } from './locales.ts'

/** Viewer identity inside the workbench. */
export const WORKBENCH_VIEWER_ID = 'guowenzhang:drawio-edit'

/** This package's copy namespace, shared with the tab body. */
const NS = 'sidebarDrawioEdit'

/**
 * The workbench service slice this module calls.
 *
 * Only the registration is read, so the workbench's own API surface can move
 * without this module.
 */
interface WorkbenchService {
  registerFileViewer(descriptor: WorkbenchViewer): () => void
}

/** One file viewer as the workbench declares it. */
interface WorkbenchViewer {
  readonly id: string
  readonly title: () => string
  readonly exts: readonly string[]
  readonly priority: number
  readonly fetchStrategy: 'fsRead'
  readonly component: (props: WorkbenchViewerProps) => unknown
}

/** How the workbench calls a viewer: the file it opened, and the session scope. */
interface WorkbenchViewerProps {
  readonly scope: { readonly sessionId: string }
  readonly path: string
}

/** The Remote slice used to read a file's bytes and its freshness token. */
interface FilesRemote {
  readBytes(
    sessionId: SessionId,
    path: string,
    range: Record<string, never>,
    signal?: AbortSignal,
  ): Promise<RemoteResult<{ readonly data: Uint8Array<ArrayBuffer>; readonly absolutePath: string; readonly version: string }>>
}

/**
 * Register the editor with the workbench, when one is installed.
 * @param ctx - client context; the registration is an effect of it.
 * @returns nothing.
 */
export function registerWorkbenchViewer(ctx: ClientContext): void {
  ctx.inject(['locale', 'remote', 'slots'], (injected) => {
    const service = injected.get('betterSidebar') as WorkbenchService | undefined
    if (service === undefined || typeof service.registerFileViewer !== 'function') return
    const t = injected.locale.bind(NS)
    const transports = viewerTransports(injected)
    injected.effect(() => service.registerFileViewer({
      id: WORKBENCH_VIEWER_ID,
      title: () => t('title'),
      exts: ['drawio'],
      // Above the workbench's own catch-all editor (priority -100): a `.drawio`
      // file is a diagram first, and the source editor stays one click away on
      // the switch the viewer draws.
      priority: 20,
      fetchStrategy: 'fsRead',
      component: (props: WorkbenchViewerProps) => {
        const source = sourceOf(props)
        return DrawioCanvas({
          hooks: REACT_HOOKS,
          source,
          transports,
          alternate: { label: t('viewerSource'), select: () => {} },
          t: key => t(key as DrawioEditKey),
        })
      },
    }), 'dsh-drawioedit: workbench viewer')
  })
}

/**
 * The transports one mounted viewer reads and saves through.
 *
 * Reading goes through the client Remote, which is what returns the freshness
 * token; writing reuses the transports the editor tab installed, so the save
 * endpoint, its sandbox policy, and its version guard stay exactly where they
 * are.
 * @param ctx - the client context carrying the Remote.
 * @returns the transports handed to the canvas.
 */
function viewerTransports(ctx: ClientContext): EditorTransports {
  return {
    read: async (address, signal) => {
      const file = hostFileOf(address)
      const remote = ctx.get('remote')
      if (remote === undefined) throw new Error('dsh-drawioedit: the file Remote is not available')
      const files = remote.workspaceFiles as unknown as FilesRemote
      const result = await files.readBytes(file.sessionId, file.path, {}, signal)
      if (!result.ok) throw new Error(result.error.message)
      return {
        bytes: result.value.data,
        absolutePath: result.value.absolutePath,
        sessionId: file.sessionId,
        version: result.value.version,
      }
    },
    save: (absolutePath, xml, version, sessionId) => editorTransports().save(absolutePath, xml, version, sessionId),
    rename: (absolutePath, name, version, sessionId) => editorTransports().rename(absolutePath, name, version, sessionId),
  }
}

/**
 * The file one mounted viewer edits.
 * @param props - the workbench's file record.
 * @returns the address, the name the editor opens with, and the session.
 */
function sourceOf(props: WorkbenchViewerProps): DrawioSource {
  const at = Math.max(props.path.lastIndexOf('/'), props.path.lastIndexOf('\\'))
  const name = at === -1 ? props.path : props.path.slice(at + 1)
  return {
    address: `dsh-resource://file/session/${encodeURIComponent(props.scope.sessionId)}/${props.path}`,
    name,
    readOnly: false,
  }
}

/**
 * Read the session and path one `dsh-resource://file/…` address names.
 * @param address - the viewer's own address for the file.
 * @returns the session and the workspace path.
 */
function hostFileOf(address: string): { readonly sessionId: SessionId; readonly path: string } {
  const parsed = parseFileAddress(address)
  if (parsed?.scope !== 'session') throw new Error(`dsh-drawioedit: not a session file address "${address}"`)
  return { sessionId: parsed.sessionId as SessionId, path: parsed.path }
}
