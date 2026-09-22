/**
 * Browser half: register the draw.io editor as a right-Sidebar tab type.
 *
 * This is a standalone plugin. It reaches the Sidebar only through the published
 * tab-type contract — the type into `ctx.sidebarRightTabs` and the body into the
 * keyed `sidebar.right.pane.tab` seat under the same `id`. The editor itself is
 * the upstream drawio webapp served from this package's `editor/` directory, so
 * it lives in an iframe rather than in the React tree.
 *
 * The tab seat's injected compartment carries only its `tabInfo` hook, so the
 * file reader and the save transport reach the body through the module handle
 * `setEditorTransports` installs. `apply` is the only writer; tests call it too.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { EditorBody } from './EditorBody.tsx'
import { saveDiagram } from './editor.ts'
import { setEditorTransports, type EditorTransports } from './transports.ts'
import { en, zh } from './locales.ts'

/** This package's copy namespace. */
const NS = 'sidebarDrawioEdit'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const DRAWIO_EDIT_ID = '@zhang-guo-wen/dsh-drawioedit'

/** The tab kind: what the tabs of this type are, and what `openTab` names. */
export const DRAWIO_EDIT_KIND = 'drawio-edit'

/** Required browser services: the tab registry, the slot registry, copy, and the file reader. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles']

/**
 * The tab title for one `file:` address: its decoded basename.
 * @param address - a `file:`-shaped address.
 * @returns the decoded last path segment, or the address itself when it has none.
 */
export function basenameOf(address: string): string {
  const name = address.slice(address.lastIndexOf('/') + 1)
  if (name === '') return address
  try {
    return decodeURIComponent(name)
  } catch {
    // A malformed percent sequence is still a name; showing it raw beats refusing the address.
    return name
  }
}

/** Read the session and path one `dsh-resource://file/…` address names. */
function hostFileOf(address: string): { readonly sessionId: string; readonly path: string } {
  const parsed = parseFileAddress(address)
  if (parsed?.scope !== 'session') throw new Error(`dsh-drawioedit: not a session file address "${address}"`)
  return { sessionId: parsed.sessionId, path: parsed.path }
}

/**
 * Client plugin body: register the dictionary, the tab type, and its body.
 * @param ctx - client root context carrying the registries, copy, and the file reader.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-drawioedit: dictionaries')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: DRAWIO_EDIT_ID,
    kind: DRAWIO_EDIT_KIND,
    patterns: ['*.drawio'],
    title: basenameOf,
  }), 'dsh-drawioedit: tab type')

  const transports: EditorTransports = {
    read: async (address, signal) => {
      const file = hostFileOf(address)
      // The complete-file read is `readBytes` with no range; the Host applies its
      // own full-file cap. The Remote hands back native bytes, and the host's own
      // report of where it read from and the token for those exact bytes travel
      // with them, so the write targets that file under that guard.
      const result = await ctx.remote.workspaceFiles.readBytes(file.sessionId, file.path, {}, signal)
      if (!result.ok) throw new Error(result.error.message)
      return {
        bytes: result.value.data,
        absolutePath: result.value.absolutePath,
        version: result.value.version,
      }
    },
    save: async (absolutePath, xml, version) => {
      // An empty token means no precondition: the very first save after a read
      // that reported none must not be refused as stale.
      return await saveDiagram(absolutePath, xml, version)
    },
  }
  setEditorTransports(transports)

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: DRAWIO_EDIT_ID, locale: NS },
    EditorBody,
  )), 'dsh-drawioedit: tab body')
}
