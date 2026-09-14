/**
 * The editor's URL, as one value both halves and the tests agree on.
 *
 * These are strings, not behavior: the client assigns the URL to the iframe, the
 * host serves the document it names, and the tests load the very same URL, so the
 * parameter list that keeps the editor offline has exactly one home.
 */

/** Where the editor's entry document is served from, relative to the app origin. */
export const EDITOR_PATH = '/plugins/dsh-drawioedit/editor/index.html'

/** Where the client posts an edited diagram back. */
export const SAVE_PATH = '/plugins/dsh-drawioedit/save'

/**
 * Cloud integrations the editor must not start, and the parameter that turns each
 * one off (drawio's `urlParams`, read by App.js).
 *
 * Left at its default, each of these loads a third-party SDK over the network:
 * the Google API client for Drive, Dropbox's `dropins.js`, OneDrive, Microsoft
 * 365, Trello's client, and the Pusher socket the collaboration feature dials.
 * The plugin promises that a diagram never leaves the machine, and none of them
 * can be used from a preview pane, so every one is off.
 */
export const DISABLED_INTEGRATIONS = {
  gapi: '0',
  db: '0',
  od: '0',
  ms365: '0',
  drive: '0',
  picker: '0',
  tr: '0',
  sockets: '0',
} as const

/**
 * Build the editor URL that loads `xml` without any handshake.
 *
 * drawio's bootstrap reads URL parameters from a `#P` hash whose JSON may carry
 * the diagram as a `hash` field; it then restores that value as the real
 * `location.hash` (`#R` + encoded XML) before the app reads it. A bare `#R` hash
 * is ignored, so both layers are required.
 *
 * `client: 1` marks the embedder as a host application, which is what the app
 * expects when it is driven programmatically rather than opened by a user.
 * `dshTitle` is this package's own parameter, carrying the name of the file the pane
 * opened so the editor can label the diagram with it. drawio's own `title` parameter
 * is not used for that: drawio percent-decodes it, and a file name may contain a
 * percent sign.
 * @param xml - the diagram XML to open.
 * @param origin - origin the editor is served from; empty means same origin.
 * @param title - the file's name, which the editor shows in its title bar.
 * @returns the absolute URL to assign to the iframe.
 */
export function editorUrl(xml: string, origin = '', title = ''): string {
  const params = JSON.stringify({
    client: '1',
    ...DISABLED_INTEGRATIONS,
    ...(title === '' ? {} : { dshTitle: title }),
    hash: '#R' + encodeURIComponent(xml),
  })
  return `${origin}${EDITOR_PATH}#P${encodeURIComponent(params)}`
}
