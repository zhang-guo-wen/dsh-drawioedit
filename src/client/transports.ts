/**
 * The file reader and save transport the editor tab body uses.
 *
 * The tab seat's injected compartment carries only its `tabInfo` hook, so these
 * reach the body through this module handle: `apply` installs them once per
 * plugin fiber, and tests install their own. Keeping them here rather than in
 * the body lets the body stay pure presentation over props.
 */

/** One opened diagram: its bytes, the path it came from, and its freshness token. */
export interface OpenedDiagram {
  /** The complete file bytes. */
  readonly bytes: Uint8Array<ArrayBuffer>
  /**
   * Absolute path of the file, as the host resolved it.
   *
   * The write needs this rather than the workspace-relative path: the read
   * resolves relative paths against the session's workspace root, while a write
   * through the filesystem seam resolves them against the process directory, so
   * passing the relative path back would target a different file.
   */
  readonly absolutePath: string
  /**
   * Opaque freshness token the host reported for the bytes just read.
   *
   * The first save offers it as a precondition, so a write that landed while the
   * editor was open is refused instead of overwritten.
   */
  readonly version: string
}

/** How the editor body reaches the workspace. */
export interface EditorTransports {
  /**
   * Read the complete bytes of the tab's file.
   * @param address - the tab's resource address.
   * @param signal - cancels the read.
   * @returns the bytes, the host-resolved absolute path, and the freshness token.
   */
  readonly read: (address: string, signal: AbortSignal) => Promise<OpenedDiagram>
  /**
   * Persist the edited diagram.
   * @param absolutePath - the host-resolved absolute path of the file.
   * @param xml - the diagram XML the editor reported.
   * @param version - the freshness token the previous read or write reported.
   * @returns the freshness token the write produced, for the next save.
   */
  readonly save: (absolutePath: string, xml: string, version: string) => Promise<string>
}

let installed: EditorTransports | undefined

/**
 * Install the transports for this plugin's lifetime.
 * @param transports - the reader and the save transport.
 */
export function setEditorTransports(transports: EditorTransports): void {
  installed = transports
}

/**
 * Read the installed transports.
 * @returns the transports.
 * @throws when no plugin has installed them, which is a wiring mistake.
 */
export function editorTransports(): EditorTransports {
  if (installed === undefined) throw new Error('dsh-drawioedit: editor transports are not installed')
  return installed
}
