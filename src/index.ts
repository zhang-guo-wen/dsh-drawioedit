/**
 * Host half: serving the editor and writing the diagram back.
 *
 * Both capabilities are host-side:
 *
 * - **Static files.** The editor is a whole application and must be served from
 *   the application origin, or the Sidebar's iframe cannot drive it. The plugin
 *   claims one `webServer` prefix route rather than relying on any implicit asset
 *   mapping.
 * - **The save.** Workspace Files is a read-only seam, so the edited diagram goes
 *   back through a same-origin POST that lands here, guarded by the version the
 *   read observed so an agent write in between is reported rather than
 *   overwritten.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { EDITOR_ROUTE, serveEditorFile } from './serve.ts'
import { SAVE_ROUTE, serveSaveRequest } from './save.ts'

/** Required host services: the route registry and the filesystem seam. */
export const inject = ['webServer', 'fs']

// Re-exported so the package's own tests can assert on the served shim and load the
// editor through the URL the client builds, without reaching into internal module
// paths. These are the only values the host publishes beyond the plugin surface.
export { assertShimUsable, SHIM_PATH, SHIM_REVISION, SHIM_SOURCE } from './shim.ts'
export { EDITOR_PATH, editorUrl } from './params.ts'
export { EDITOR_ROUTE } from './serve.ts'
export { SAVE_ROUTE } from './save.ts'

/**
 * Host plugin body: claim the editor's URL prefix and the save endpoint.
 * @param ctx - host context carrying the route registry and the filesystem seam.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: EDITOR_ROUTE, handler: serveEditorFile }),
    'dsh-drawioedit: editor assets',
  )
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: SAVE_ROUTE,
      handler: (req: IncomingMessage, res: ServerResponse) => serveSaveRequest(ctx, req, res),
    }),
    'dsh-drawioedit: save endpoint',
  )
}
