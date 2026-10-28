/**
 * The two-segment switch the canvas draws when its host offers another way to
 * show the same file.
 *
 * The right-Sidebar tab body never draws it: the Sidebar's tab types are the
 * choice there. A workbench viewer does, because it replaces the whole pane.
 *
 * @module @guowenzhang/dsh-drawioedit/client/ViewerSwitch
 */

import type { ReactNode } from 'react'
import css from './EditorBody.module.css'

/** Props of the switch. */
export interface ViewerSwitchProps {
  /** Accessible name of the group. */
  readonly label: string
  /** Caption of the first segment, which is this editor. */
  readonly first: string
  /** Caption of the second segment: the other implementation. */
  readonly second: string
  /** Which segment is pressed. */
  readonly selected: 'first' | 'second'
  /** Picks the first segment. */
  readonly onFirst: () => void
  /** Picks the second segment. */
  readonly onSecond: () => void
}

/**
 * Draw the switch.
 * @param props - captions, the current segment, and both callbacks.
 * @returns the segmented control.
 */
export function ViewerSwitch({ label, first, second, selected, onFirst, onSecond }: ViewerSwitchProps): ReactNode {
  return (
    <div className={css.viewerSwitch} role="group" aria-label={label} data-viewer-switch={selected}>
      <button type="button" className={css.viewerOption} aria-pressed={selected === 'first'} onClick={onFirst}>
        {first}
      </button>
      <button type="button" className={css.viewerOption} aria-pressed={selected === 'second'} onClick={onSecond}>
        {second}
      </button>
    </div>
  )
}
