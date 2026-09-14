/** draw.io editor tab: the upstream webapp in an iframe, driven by `postMessage`. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { editorTransports } from './transports.ts'
import { editorUrl, parseEditorMessage } from './editor.ts'
import type {} from './locales.ts'
import css from './EditorBody.module.css'

/** The tab seat's standard props plus this entry's dictionary. */
export type EditorBodyProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'sidebarDrawioEdit'>

type Loaded =
  | {
    readonly kind: 'ready'
    readonly address: string
    readonly xml: string
    readonly absolutePath: string
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
  /** Why the last write failed. A write that lands is reported by the editor itself. */
  const [failure, setFailure] = useState<string>()
  const frame = useRef<HTMLIFrameElement>(null)
  /** The freshness token to offer on the next save: seeded by the read, advanced by each write. */
  const version = useRef<string>('')
  /** The newest diagram awaiting a write, and whether a write is in flight. */
  const pending = useRef<{ xml: string } | undefined>(undefined)
  const saving = useRef(false)

  useEffect(() => {
    const lifetime = new AbortController()
    const signal = AbortSignal.any([lifetime.signal, tab.signal])
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
          version: opened.version,
        })
      },
      failed,
    // A throw inside the success handler -- decoding, say -- would otherwise
    // escape as an unhandled rejection and leave the pane on the loading line.
    ).catch(failed)
    return () => { lifetime.abort() }
  }, [address, tab.signal])

  useEffect(() => {
    if (loaded?.kind !== 'ready') return
    const absolutePath = loaded.absolutePath

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
      if (saving.current || pending.current === undefined) return
      const xml = pending.current.xml
      pending.current = undefined
      saving.current = true
      void editorTransports().save(absolutePath, xml, version.current).then(
        // Each write yields the token the next one must offer, so a write by
        // anyone else in between is refused rather than overwritten.
        (next) => {
          version.current = next
          setFailure(undefined)
          // The write is the host's, and drawio has no other way to learn it landed.
          // Without this it keeps showing "Unsaved changes. Click here to save."
          // Whether or not the file was written, so a success looks like a failure.
          frame.current?.contentWindow?.postMessage(JSON.stringify({ action: 'saved' }), '*')
        },
        (error: unknown) => {
          setFailure(error instanceof Error ? error.message : String(error))
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
      // Only an `autosave` carries edited XML; `load` echoes back what it was given.
      if (message?.event !== 'autosave' || message.xml === undefined) return
      pending.current = { xml: message.xml }
      drain()
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      pending.current = undefined
    }
  }, [loaded])

  const name = address.slice(address.lastIndexOf('/') + 1)

  const src = useMemo(
    () => (loaded?.kind === 'ready' ? editorUrl(loaded.xml, '', name) : undefined),
    [loaded, name],
  )

  if (loaded === undefined || loaded.address !== address) {
    return <p className={css.status} role="status">{t('loading')}</p>
  }
  if (loaded.kind === 'failed') {
    return <p className={css.status} role="alert">{`${t('failed')} ${loaded.reason}`}</p>
  }
  // Only a failure earns a line of its own: a confirmed write makes drawio's own
  // toolbar say "All changes saved", so a second line above the frame answers a
  // question the editor has already answered.
  return <div className={css.frame} data-drawio-editor>
    {failure !== undefined && <p className={css.status} role="alert">{`${t('saveFailed')}${failure}`}</p>}
    <iframe
      ref={frame}
      className={css.editor}
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
