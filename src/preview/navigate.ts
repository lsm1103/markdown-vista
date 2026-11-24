import { diagnostics } from './diagnostics'
import { readConfig } from './config'
import { topInset } from './layout'
import { collectHeadings, type Heading } from './headings'

/**
 * How long a jump defends its position. The preview and the editor sync each
 * other's scroll position over a message round trip, and in a large document
 * that echo can arrive well after the click — long after any fixed-delay check
 * would have given up.
 */
const GUARD_MS = 1600
/**
 * A correction extends the guard — if something is still moving the document,
 * it is not finished yet — but never past this hard cap from the jump itself.
 */
const GUARD_MAX_MS = 5000
/** How far the document may drift before the guard puts it back, in pixels. */
const GUARD_TOLERANCE = 24
/**
 * The guard polls rather than only listening for `scroll`. Chromium dispatches
 * scroll events on the frame lifecycle, and a hidden document gets no frames —
 * a preview in a background editor group would be defended by nothing at all.
 * Timers keep running either way.
 */
const GUARD_POLL_MS = 80

/** How long a jump owns the active-section highlight. */
export const REVEAL_SETTLE_MS = 1600

let revealingUntil = 0
let guardRelease: (() => void) | null = null

export function isRevealing(): boolean {
  return Date.now() < revealingUntil
}

export function endReveal(): void {
  revealingUntil = 0
}

/** Distance from the target's current position to where it should sit. */
function drift(element: HTMLElement): number {
  return element.getBoundingClientRect().top - topInset()
}

function releaseGuard(): void {
  guardRelease?.()
  guardRelease = null
  // Scroll-driven highlighting resumes as soon as the jump stops being
  // defended, so nothing feels frozen.
  revealingUntil = 0
}

/**
 * Holds the position for a short while after a jump. Anything that scrolls the
 * document away — most likely the editor echoing its own scroll position back
 * to the preview — is undone. Any genuine input from the reader releases the
 * guard immediately, so it can never feel stuck.
 */
function beginGuard(key: string): void {
  releaseGuard()

  const started = Date.now()
  let deadline = started + GUARD_MS

  const poll = (): void => {
    const now = Date.now()
    if (now > deadline || now > started + GUARD_MAX_MS) {
      releaseGuard()
      return
    }
    // Resolved by key, not held as a reference: the preview replaces every
    // element when it re-renders, and a jump must survive that.
    const element = collectHeadings().find((item) => item.key === key)?.element
    if (!element?.isConnected) return

    const offset = drift(element)
    if (Math.abs(offset) <= GUARD_TOLERANCE) return
    diagnostics.tocCorrections++
    window.scrollTo({ top: window.scrollY + offset, behavior: 'auto' })
    deadline = Math.min(now + GUARD_MS, started + GUARD_MAX_MS)
  }

  const release = (event: Event): void => {
    // The click that started this jump must not release its own guard.
    if (
      event.target instanceof Element &&
      event.target.closest('.markdown-vista-toc, .markdown-vista-toc-toggle, .markdown-vista-breadcrumb')
    ) {
      return
    }
    releaseGuard()
  }

  const timer = window.setInterval(poll, GUARD_POLL_MS)
  window.addEventListener('scroll', poll, { passive: true })
  for (const type of ['wheel', 'touchstart', 'keydown', 'mousedown'] as const) {
    window.addEventListener(type, release, { passive: true })
  }

  guardRelease = () => {
    window.clearInterval(timer)
    window.removeEventListener('scroll', poll)
    for (const type of ['wheel', 'touchstart', 'keydown', 'mousedown'] as const) {
      window.removeEventListener(type, release)
    }
  }
}

/**
 * Moves the preview to a heading.
 *
 * The jump is instant, never animated: an animation is something another party
 * can interrupt, and "where the section is" must not depend on timing. It is
 * idempotent — the same heading lands in exactly the same place however many
 * times it is asked for, including when the document is already there.
 *
 * `anchor` hands the navigation to the built-in preview's own anchor handling
 * instead. It exists because the guard is a defence, not a diagnosis: if the
 * scroll sync turns out to be what fights our jumps, letting the host do the
 * scrolling avoids the fight entirely.
 */
export function revealHeading(heading: Heading): void {
  if (!heading.element.isConnected) return

  revealingUntil = Date.now() + REVEAL_SETTLE_MS
  diagnostics.tocJumps++

  if (readConfig().tocJumpStrategy === 'anchor' && heading.element.id) {
    window.location.hash = `#${heading.element.id}`
    return
  }

  const offset = drift(heading.element)
  if (Math.abs(offset) >= 1) window.scrollTo({ top: window.scrollY + offset, behavior: 'auto' })
  beginGuard(heading.key)
}
