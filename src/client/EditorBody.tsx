/** draw.io editor tab: the upstream webapp in an iframe, driven by `postMessage`. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { editorTransports } from './transports.ts'
import { DiagramSaveError, editorUrl, parseEditorMessage } from './editor.ts'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { basenameOf } from './file-name.ts'
import type {} from './locales.ts'
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
 * Host the draw.io editor for one `.drawio` file.
 *
 * The diagram reaches the editor through its URL, which is the one load path
 * that needs no handshake; the editor then reports every change back as an
 * `autosave` message carrying the full XML, and that is what gets persisted.
 * @param props - standard tab seats and the locale.
 * @returns the editor frame, a loading status, or the reason it could not open.
 */
export function EditorBody({ useTabInfo, t }: EditorBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const address = tab.contentId
  const [loaded, setLoaded] = useState<Loaded>()
  /** Why the last write failed. A write that lands is reported by the editor's own toolbar. */
  const [failure, setFailure] = useState<{ readonly message: string; readonly code: string | undefined }>()
  /** The visible phase of this plugin's own write, and nothing else. */
  const [phase, setPhase] = useState<WritePhase>()
  /** Bumped by Retry to read the same file again. */
  const [attempt, setAttempt] = useState(0)
  const frame = useRef<HTMLIFrameElement>(null)
  /** The freshness token to offer on the next save: seeded by the read, advanced by each write. */
  const version = useRef<string>('')
  /** The newest diagram awaiting a write, and whether a write is in flight. */
  const pending = useRef<{ xml: string } | undefined>(undefined)
  const saving = useRef(false)
  const renameWanted = useRef<string | undefined>(undefined)
  const renaming = useRef(false)
  const busy = phase === 'saving' || phase === 'renaming'

  useEffect(() => {
    const lifetime = new AbortController()
    const signal = AbortSignal.any([lifetime.signal, tab.signal])
    // A retry, or a different tab address, starts from the placeholder rather than
    // leaving the previous file's failure on screen.
    setLoaded(undefined)
    /** Report a read failure; the reason is shown so the pane is never silent. */
    const failed = (error: unknown): void => {
      if (signal.aborted) return
      setLoaded({ kind: 'failed', address, reason: error instanceof Error ? error.message : String(error) })
    }
    void editorTransports().read(address, signal).then(
      (opened) => {
        if (signal.aborted) return
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
  }, [address, tab.signal, attempt])

  useEffect(() => {
    if (loaded?.kind !== 'ready') return
    const absolutePath = loaded.absolutePath

    const renameIfReady = (): void => {
      if (saving.current || pending.current !== undefined || renaming.current || renameWanted.current === undefined) return
      const requested = renameWanted.current
      renameWanted.current = undefined
      renaming.current = true
      setPhase('renaming')
      void editorTransports().rename(absolutePath, requested, version.current, loaded.sessionId).then(result => {
        tab.actions.openResource(fileAddressFor(loaded.sessionId, undefined, result.path), { replaceTab: true })
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
     * newest diagram is worth writing.
     */
    const drain = (): void => {
      if (saving.current || renaming.current || pending.current === undefined) {
        renameIfReady()
        return
      }
      const xml = pending.current.xml
      pending.current = undefined
      saving.current = true
      setPhase('saving')
      void editorTransports().save(absolutePath, xml, version.current, loaded.sessionId).then(
        // Each write yields the token the next one must offer, so a write by
        // anyone else in between is refused rather than overwritten.
        (next) => {
          version.current = next
          setFailure(undefined)
          // A confirmed write needs no line of its own: drawio's toolbar states it.
          setPhase(undefined)
          // The write is the host's, and drawio has no other way to learn it landed.
          // Without this it keeps showing "Unsaved changes. Click here to save."
          // Whether or not the file was written, so a success looks like a failure.
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
      const filename = basenameOf(address)
      const isInitialName = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}(?:-\d+)?\.drawio$/u.test(filename)
      if (message.event === 'saveAs' || (message.event === 'save' && isInitialName)) {
        const chosen = window.prompt(t('renamePrompt'), isInitialName ? '' : filename.replace(/\.drawio$/iu, ''))
        if (chosen?.trim()) renameWanted.current = chosen.trim()
      }
      drain()
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      pending.current = undefined
    }
  }, [loaded, address, tab.actions, t])

  const name = basenameOf(address)
  const failureDetail = failure?.code === 'FS_SANDBOX_DENIED'
    ? t('saveDenied')
    : failure?.code === 'FS_STALE_VERSION'
      ? t('saveConflict')
      : failure?.message

  const src = useMemo(
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
      {/* A read can fail for a reason that does not repeat, and this tab is the
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
