/**
 * The `.drawio` canvas: the upstream editor in a same-origin iframe, driven by
 * `postMessage`, with an optional switch back to whoever else can show the file.
 *
 * Two hosts mount it. The right-Sidebar tab body reads the file through this
 * plugin's transports and switches nothing (the Sidebar owns that choice); the
 * workbench viewer passes the file it already resolved and draws the switch.
 * Both get the same editor, the same save path, and the same failure lines.
 *
 * @module @guowenzhang/dsh-drawioedit/client/DrawioCanvas
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { DiagramSaveError, editorUrl, parseEditorMessage } from './editor.ts'
import { basenameOf } from './file-name.ts'
import { ViewerSwitch } from './ViewerSwitch.tsx'
import { editorTransports } from './transports.ts'
import type { EditorTransports } from './transports.ts'
import type { DrawioEditKey } from './locales.ts'
import css from './EditorBody.module.css'

/** The tab seat's standard props plus this entry's dictionary. */
export type EditorBodyProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'sidebarDrawioEdit'>

/**
 * This plugin's own write phase, shown above the frame. Only the two phases the
 * editor cannot report are named: a confirmed write needs no line, because the
 * editor's own toolbar already says the diagram is saved and a second line above
 * the frame would push the editor down every time a change lands.
 */
type WritePhase = 'saving' | 'renaming'

/** One file the canvas edits. */
export interface DrawioSource {
  /** The file's `dsh-resource://file/…` address; reads and saves address it. */
  readonly address: string
  /** The name the editor opens under, used for its own title and rename prompt. */
  readonly name: string
  /** Whether the host allows renaming this file (the tab host does, a viewer does not). */
  readonly readOnly: boolean
}

/** Another implementation of the same file, offered by the switch when the host draws one. */
export interface DrawioAlternate {
  /** Caption of the switch's second segment. */
  readonly label: string
  /** Hands the file to that implementation. */
  readonly select: () => void
}

/** Props of the canvas, independent of which host mounts it. */
export interface DrawioCanvasProps {
  /** The file being edited. */
  readonly source: DrawioSource
  /** The read and save transports; the tab body uses the installed ones. */
  readonly transports: EditorTransports
  /** The other implementation of the file, when the host draws a switch. */
  readonly alternate?: DrawioAlternate
  /** This package's dictionary. */
  readonly t: (key: DrawioEditKey, params?: Record<string, string>) => string
  /** Opens a replacement address, for a host that owns the tab. */
  readonly openAddress?: (address: string) => void
}

/** The render machinery the canvas uses, passed in so every host can drive it. */
export interface DrawioCanvasHooks {
  readonly useState: typeof useState
  readonly useRef: typeof useRef
  readonly useMemo: typeof useMemo
  readonly useEffect: typeof useEffect
}

type Loaded =
  | {
    readonly kind: 'ready'
    readonly address: string
    readonly xml: string
    readonly absolutePath: string
    readonly sessionId: string
    readonly version: string
  }
  | { readonly kind: 'failed'; readonly address: string; readonly reason: string }

/**
 * Edit one `.drawio` file.
 *
 * The diagram reaches the editor through its URL, which is the one load path
 * that needs no handshake; the editor then reports every change back as an
 * `autosave` message carrying the full XML, and that is what gets persisted.
 * @param props - the file, the transports, the optional switch, and the dictionary.
 * @returns the editor frame, a loading status, or the reason it could not open.
 */
export function DrawioCanvas({ source, transports, alternate, t, openAddress, hooks: h }: DrawioCanvasProps & { readonly hooks: DrawioCanvasHooks }): ReactNode {
  const { address, name: sourceName, readOnly } = source
  const [loaded, setLoaded] = h.useState<Loaded>()
  /** Why the last write failed. A write that lands is reported by the editor's own toolbar. */
  const [failure, setFailure] = h.useState<{ readonly message: string; readonly code: string | undefined }>()
  /** The visible phase of this plugin's own write, and nothing else. */
  const [phase, setPhase] = h.useState<WritePhase>()
  /** Bumped by Retry to read the same file again. */
  const [attempt, setAttempt] = h.useState(0)
  const frame = h.useRef<HTMLIFrameElement>(null)
  /** The freshness token to offer on the next save: seeded by the read, advanced by each write. */
  const version = h.useRef<string>('')
  /** The newest diagram awaiting a write, and whether a write is in flight. */
  const pending = h.useRef<{ xml: string } | undefined>(undefined)
  const saving = h.useRef(false)
  const renameWanted = h.useRef<string | undefined>(undefined)
  const renaming = h.useRef(false)
  const busy = phase === 'saving' || phase === 'renaming'

  h.useEffect(() => {
    const lifetime = new AbortController()
    // A retry, or a different file, starts from the placeholder rather than
    // leaving the previous file's failure on screen.
    setLoaded(undefined)
    /** Report a read failure; the reason is shown so the pane is never silent. */
    const failed = (error: unknown): void => {
      if (lifetime.signal.aborted) return
      setLoaded({ kind: 'failed', address, reason: error instanceof Error ? error.message : String(error) })
    }
    void transports.read(address, lifetime.signal).then(
      (opened) => {
        if (lifetime.signal.aborted) return
        version.current = opened.version
        setLoaded({
          kind: 'ready',
          address,
          xml: new TextDecoder().decode(opened.bytes),
          absolutePath: opened.absolutePath,
          sessionId: opened.sessionId,
          version: opened.version,
        })
      },
      failed,
    // A throw inside the success handler -- decoding, say -- would otherwise
    // escape as an unhandled rejection and leave the pane on the loading line.
    ).catch(failed)
    return () => { lifetime.abort() }
  }, [address, transports, attempt])

  h.useEffect(() => {
    if (loaded?.kind !== 'ready') return
    const absolutePath = loaded.absolutePath

    const renameIfReady = (): void => {
      if (saving.current || pending.current !== undefined || renaming.current || renameWanted.current === undefined) return
      const requested = renameWanted.current
      renameWanted.current = undefined
      renaming.current = true
      setPhase('renaming')
      void transports.rename(absolutePath, requested, version.current, loaded.sessionId).then((result) => {
        // The tab host replaces its own tab; any other host is handed the new
        // address so the pane it owns can follow the file.
        if (openAddress !== undefined) openAddress(fileAddressFor(loaded.sessionId, undefined, result.path))
        else window.dispatchEvent(new CustomEvent(DRAWIO_RENAMED, { detail: result.path }))
      }).catch((error: unknown) => {
        setFailure({ message: `${t('renameFailed')}${error instanceof Error ? error.message : String(error)}`, code: error instanceof DiagramSaveError ? error.code : undefined })
      }).finally(() => {
        renaming.current = false
        setPhase(current => current === 'renaming' ? undefined : current)
        drain()
      })
    }

    /**
     * Write the newest pending diagram, then the next one if it arrived meanwhile.
     *
     * Saves must not overlap. The editor reports a change as soon as it happens,
     * so dragging a shape produces a burst: two saves racing would both offer the
     * same token, and the second would be refused as stale even though nothing
     * else touched the file. Serialising also collapses the burst — only the
     * latest diagram of a burst is written.
     */
    const drain = (): void => {
      if (saving.current || renaming.current) return
      const next = pending.current
      if (next === undefined) {
        renameIfReady()
        return
      }
      pending.current = undefined
      saving.current = true
      setPhase('saving')
      void transports.save(absolutePath, next.xml, version.current, loaded.sessionId).then(
        (fresh) => {
          version.current = fresh
          setPhase(undefined)
          setFailure(undefined)
          // Tell the frame its content is on disk. The editor's "unsaved" badge
          // is set from the report it made when the change happened; drawio does
          // not clear it on its own, and the tab would otherwise keep saying
          // "Unsaved changes. Click here to save." whether the write landed or
          // not -- a success would look like a failure.
          frame.current?.contentWindow?.postMessage(JSON.stringify({ action: 'saved' }), '*')
        },
        (error: unknown) => {
          renameWanted.current = undefined
          setPhase(current => current === 'saving' ? undefined : current)
          setFailure({
            message: error instanceof Error ? error.message : String(error),
            code: error instanceof DiagramSaveError ? error.code : undefined,
          })
        },
      ).finally(() => {
        saving.current = false
        drain()
      })
    }

    const onMessage = (event: MessageEvent): void => {
      // Only the frame this body mounted may drive the write path.
      if (frame.current === null || event.source !== frame.current.contentWindow) return
      const message = parseEditorMessage(event.data)
      if (message?.xml === undefined || !['autosave', 'save', 'saveAs'].includes(message.event)) return
      pending.current = { xml: message.xml }
      const initialName = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}(?:-\d+)?\.drawio$/u.test(sourceName)
      if (!readOnly && (message.event === 'saveAs' || (message.event === 'save' && initialName))) {
        const chosen = window.prompt(t('renamePrompt'), initialName ? '' : sourceName.replace(/\.drawio$/iu, ''))
        if (chosen?.trim()) renameWanted.current = chosen.trim()
      }
      drain()
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      pending.current = undefined
    }
  }, [loaded, sourceName, readOnly, transports, t, openAddress])

  const name = basenameOf(address)
  const failureDetail = failure?.code === 'FS_SANDBOX_DENIED'
    ? t('saveDenied')
    : failure?.code === 'FS_STALE_VERSION'
      ? t('saveConflict')
      : failure?.message

  const src = h.useMemo(
    () => (loaded?.kind === 'ready' ? editorUrl(loaded.xml, '', name) : undefined),
    [loaded, name],
  )

  if (loaded === undefined || loaded.address !== address) {
    return <div className={css.loading} role="status">
      {/* The placeholder is decoration; the status line carries the meaning. */}
      <span className={css.skeleton} aria-hidden="true" />
      <p className={css.status}>{t('loading')}</p>
    </div>
  }
  if (loaded.kind === 'failed') {
    return <div className={css.failure} role="alert">
      <p className={css.status}>{`${t('failed')} ${loaded.reason}`}</p>
      {/* A read can fail for a reason that does not repeat, and this pane is the
          only place that can offer the same file again. */}
      <button type="button" className={css.retry} onClick={() => setAttempt(current => current + 1)}>
        {t('retry')}
      </button>
    </div>
  }
  // Two lines at most, and each answers a question the editor does not: a write
  // this plugin has in flight, and a write that was refused. Neither is drawn for
  // a write that landed, so a landing change never moves the frame.
  return <div className={css.frame} data-drawio-editor aria-busy={busy}>
    {alternate !== undefined && (
      <div className={css.viewerRow}>
        <ViewerSwitch
          label={t('viewerLabel')}
          first={t('viewerDiagram')}
          second={alternate.label}
          selected="first"
          onFirst={() => {}}
          onSecond={alternate.select}
        />
      </div>
    )}
    {phase !== undefined && <p className={css.writeState} role="status">{t(phase)}</p>}
    {failure !== undefined && <p className={`${css.status} ${css.error}`} role="alert">
      {`${t('saveFailed')}${failureDetail}`}
    </p>}
    <iframe
      ref={frame}
      className={css.editor}
      style={phase === 'renaming' ? { pointerEvents: 'none' } : undefined}
      src={src}
      title={t('preview', { name })}
      // The editor is this plugin's own code, served from the application origin,
      // and it is driven only through `postMessage`. The sandbox keeps the frame
      // from navigating the application away and from opening dialogs the tab did
      // not ask for; `allow-same-origin` is required because drawio keeps its
      // settings in `localStorage`. Chrome warns that the pair lets the frame
      // escape its own sandbox, which is true and acceptable here: the framed
      // document is not untrusted content. A diagram is data -- drawio parses it
      // with `DOMParser`, which runs nothing and resolves no external entity
      // (tests/offline.mjs proves a DOCTYPE with an external entity fetches
      // nothing).
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
    />
  </div>
}

/** Event a host without a tab to replace listens on: `detail` is the new absolute path. */
export const DRAWIO_RENAMED = 'dsh-drawioedit:renamed'

/** The real render machinery, for hosts that mount the canvas themselves. */
export const REACT_HOOKS: DrawioCanvasHooks = { useState, useRef, useMemo, useEffect }

/**
 * The canvas mounted as the right-Sidebar tab body.
 *
 * The tab owns the file by address, replaces itself when the editor renames it,
 * and never draws a switch: the Sidebar's own tab types are the choice there.
 * @param props - the tab seat and the dictionary.
 * @returns the canvas.
 */
export function EditorBody({ useTabInfo, t }: EditorBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const address = tab.contentId
  // The tab seat's props carry the render machinery the shell resolved for this
  // component; a direct test render borrows the real one through the module.
  const hooks = (EditorBody as unknown as { __hooks?: DrawioCanvasHooks }).__hooks ?? REACT_HOOKS
  const opened = hooks.useMemo(() => editorTransports(), [])
  return <DrawioCanvas
    hooks={hooks}
    source={{ address, name: basenameOf(address), readOnly: false }}
    transports={opened}
    t={key => t(key)}
  />
}
