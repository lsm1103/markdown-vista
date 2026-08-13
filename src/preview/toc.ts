import { ICONS } from './icons'
import { readConfig, type PreviewConfig } from './config'
import { diagnostics } from './diagnostics'

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'
const SCROLL_ACTIVE_OFFSET = 12
/** How long a click-to-jump owns the highlight, so the smooth scroll does not
 *  drag it through every heading on the way. */
const REVEAL_SETTLE_MS = 1600
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
 * The guard polls rather than listening for `scroll`. Chromium dispatches
 * scroll events on the frame lifecycle, and a hidden document gets no frames —
 * a preview in a background editor group would be defended by nothing at all.
 * Timers keep running either way.
 */
const GUARD_POLL_MS = 80

interface Heading {
  element: HTMLElement
  key: string
  text: string
  level: number
}

interface Node extends Heading {
  children: Node[]
}

/**
 * Nests a flat heading list by level. Works with skipped levels — an h3 that
 * follows an h1 becomes a child of that h1.
 */
function nest(headings: Heading[]): Node[] {
  const roots: Node[] = []
  const stack: Node[] = []
  for (const heading of headings) {
    const node: Node = { ...heading, children: [] }
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop()
    if (stack.length) stack[stack.length - 1].children.push(node)
    else roots.push(node)
    stack.push(node)
  }
  return roots
}

function collectHeadings(maxLevel: number): Heading[] {
  const seen = new Map<string, number>()
  const headings: Heading[] = []

  for (const element of Array.from(document.querySelectorAll<HTMLElement>(HEADING_SELECTOR))) {
    if (element.closest('.markdown-vista-viewer, .markdown-vista-toc')) continue
    const level = Number(element.tagName[1])
    if (level > maxLevel) continue
    const text = (element.textContent ?? '').trim()
    if (!text) continue

    // A stable key survives re-renders, so collapsed state and the open panel
    // do not reset on every keystroke. Duplicated headings get a suffix.
    const base = `${level}:${text}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    headings.push({ element, key: count ? `${base}#${count}` : base, text, level })
  }

  return headings
}

function collapsibleKeys(nodes: Node[], accumulator: string[] = []): string[] {
  for (const node of nodes) {
    if (node.children.length) {
      accumulator.push(node.key)
      collapsibleKeys(node.children, accumulator)
    }
  }
  return accumulator
}

class Toc {
  private readonly toggle: HTMLButtonElement
  private readonly panel: HTMLElement
  private readonly list: HTMLOListElement
  private readonly countLabel: HTMLElement
  private readonly collapseButton: HTMLButtonElement

  private headings: Heading[] = []
  private signature = ''
  private collapsed = new Set<string>()
  private open = false
  private activeKey: string | null = null
  private scrollScheduled = false
  private revealingUntil = 0
  private guardRelease: (() => void) | null = null

  constructor(config: PreviewConfig) {
    this.toggle = document.createElement('button')
    this.toggle.type = 'button'
    this.toggle.className = 'markdown-vista-toc-toggle'
    this.toggle.title = 'Table of contents'
    this.toggle.setAttribute('aria-label', 'Table of contents')
    this.toggle.innerHTML = ICONS.list

    this.panel = document.createElement('nav')
    this.panel.className = 'markdown-vista-toc'
    this.panel.setAttribute('aria-label', 'Table of contents')
    this.panel.hidden = true
    this.panel.innerHTML = `
      <div class="markdown-vista-toc__head">
        <span class="markdown-vista-toc__title">Contents</span>
        <span class="markdown-vista-toc__count"></span>
        <button type="button" class="markdown-vista-toc__btn" data-toc-action="collapse" title="Collapse all" aria-label="Collapse all">${ICONS.collapseAll}</button>
        <button type="button" class="markdown-vista-toc__btn" data-toc-action="close" title="Close" aria-label="Close">${ICONS.close}</button>
      </div>
      <ol class="markdown-vista-toc__list"></ol>
      <p class="markdown-vista-toc__empty" hidden>No headings in this document.</p>
    `

    this.list = this.panel.querySelector('.markdown-vista-toc__list') as HTMLOListElement
    this.countLabel = this.panel.querySelector('.markdown-vista-toc__count') as HTMLElement
    this.collapseButton = this.panel.querySelector('[data-toc-action="collapse"]') as HTMLButtonElement

    this.attach()
    this.bind()
    if (config.tocOpenByDefault) this.setOpen(true)
  }

  /** The built-in preview rebuilds the body on every edit; re-attach if dropped. */
  private attach(): void {
    if (!this.toggle.isConnected) document.body.append(this.toggle)
    if (!this.panel.isConnected) document.body.append(this.panel)
  }

  private bind(): void {
    this.toggle.addEventListener('click', (event) => {
      event.stopPropagation()
      this.setOpen(!this.open)
    })

    // Keep focus in the document. A button steals focus on mousedown, and a
    // focus change is one more thing the host can react to by scrolling.
    this.panel.addEventListener('mousedown', (event) => {
      if ((event.target as HTMLElement).closest('.markdown-vista-toc__link')) event.preventDefault()
    })

    this.panel.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      // The panel is our UI. The built-in preview has its own document-level
      // click handling (links, source mapping) that does not check
      // `defaultPrevented`, so nothing from in here may reach it.
      event.stopPropagation()

      const action = target.closest<HTMLElement>('[data-toc-action]')?.dataset.tocAction
      if (action === 'close') {
        this.setOpen(false)
        return
      }
      if (action === 'collapse') {
        this.toggleAll()
        return
      }

      const caret = target.closest<HTMLElement>('.markdown-vista-toc__caret')
      if (caret) {
        event.stopPropagation()
        this.toggleNode(caret.dataset.key ?? '')
        return
      }

      const link = target.closest<HTMLElement>('.markdown-vista-toc__link')
      if (link) this.reveal(link.dataset.key ?? '')
    })

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.open && !document.querySelector('.markdown-vista-viewer:not([hidden])')) {
        this.setOpen(false)
      }
    })

    window.addEventListener(
      'scroll',
      () => {
        if (this.scrollScheduled) return
        this.scrollScheduled = true
        window.requestAnimationFrame(() => {
          this.scrollScheduled = false
          this.updateActive()
        })
      },
      { passive: true }
    )
  }

  private setOpen(open: boolean): void {
    this.open = open
    this.panel.hidden = !open
    this.toggle.classList.toggle('markdown-vista-toc-toggle--active', open)
    this.toggle.setAttribute('aria-expanded', String(open))
    if (open) {
      this.updateActive()
      this.scrollActiveIntoView()
    }
  }

  private toggleNode(key: string): void {
    if (!key) return
    if (this.collapsed.has(key)) this.collapsed.delete(key)
    else this.collapsed.add(key)
    this.render()
  }

  private toggleAll(): void {
    const keys = collapsibleKeys(nest(this.headings))
    const allCollapsed = keys.length > 0 && keys.every((key) => this.collapsed.has(key))
    this.collapsed = allCollapsed ? new Set() : new Set(keys)
    this.render()
  }

  /**
   * Jumps to a heading and keeps it there.
   *
   * The jump is instant, never animated: an animation is something another
   * party can interrupt, and "where the section is" must not depend on timing.
   * It is also idempotent — clicking the same entry any number of times lands
   * in exactly the same place, including when the document is already there.
   */
  private reveal(key: string): void {
    const heading = this.headings.find((item) => item.key === key)
    if (!heading?.element.isConnected) return

    this.activeKey = key
    this.markActive()
    this.revealingUntil = Date.now() + REVEAL_SETTLE_MS
    diagnostics.tocJumps++

    this.jumpTo(heading.element)
    this.beginGuard(key)
  }

  /** Puts `element` at the top of the viewport. */
  private jumpTo(element: HTMLElement): void {
    const offset = element.getBoundingClientRect().top
    if (Math.abs(offset) < 1) return
    window.scrollTo({ top: window.scrollY + offset, behavior: 'auto' })
  }

  /**
   * Holds the position for a short while after a jump. Anything that scrolls
   * the document away — most likely the editor echoing its own scroll position
   * back to the preview — is undone. Any genuine input from the user releases
   * the guard immediately, so it can never feel stuck.
   */
  private beginGuard(key: string): void {
    this.releaseGuard()

    const started = Date.now()
    let deadline = started + GUARD_MS

    const poll = (): void => {
      const now = Date.now()
      if (now > deadline || now > started + GUARD_MAX_MS) {
        this.releaseGuard()
        return
      }
      // Resolved by key, not held as a reference: the preview replaces every
      // element when it re-renders, and a jump must survive that.
      const element = this.headings.find((item) => item.key === key)?.element
      if (!element?.isConnected) return

      const drift = element.getBoundingClientRect().top
      if (Math.abs(drift) <= GUARD_TOLERANCE) return
      diagnostics.tocCorrections++
      window.scrollTo({ top: window.scrollY + drift, behavior: 'auto' })
      deadline = Math.min(now + GUARD_MS, started + GUARD_MAX_MS)
    }

    const release = (event: Event): void => {
      // The click that started this jump must not release its own guard.
      if (event.target instanceof Element && event.target.closest('.markdown-vista-toc, .markdown-vista-toc-toggle')) return
      this.releaseGuard()
    }

    // Two independent triggers, because each fails in a different environment:
    // timers are throttled hard in a hidden document, and scroll events are
    // dispatched on the frame lifecycle, which a hidden document does not run.
    const timer = window.setInterval(poll, GUARD_POLL_MS)
    window.addEventListener('scroll', poll, { passive: true })
    for (const type of ['wheel', 'touchstart', 'keydown', 'mousedown'] as const) {
      window.addEventListener(type, release, { passive: true })
    }

    this.guardRelease = () => {
      window.clearInterval(timer)
      window.removeEventListener('scroll', poll)
      for (const type of ['wheel', 'touchstart', 'keydown', 'mousedown'] as const) {
        window.removeEventListener(type, release)
      }
    }
  }

  private releaseGuard(): void {
    this.guardRelease?.()
    this.guardRelease = null
    // Scroll-driven highlighting resumes as soon as the jump stops being
    // defended, so the panel never feels frozen.
    this.revealingUntil = 0
  }

  /** Re-reads the document; rebuilds the list only when the headings changed. */
  sync(config: PreviewConfig): void {
    this.attach()

    if (!config.tocEnabled) {
      this.toggle.hidden = true
      this.panel.hidden = true
      return
    }
    this.toggle.hidden = false

    // Element references are refreshed every time — the preview replaces the
    // heading nodes on each render even when the text is unchanged.
    this.headings = collectHeadings(config.tocMaxLevel)
    const signature = this.headings.map((heading) => heading.key).join(' ')
    if (signature !== this.signature) {
      this.signature = signature
      const keys = new Set(this.headings.map((heading) => heading.key))
      for (const key of Array.from(this.collapsed)) if (!keys.has(key)) this.collapsed.delete(key)
      this.render()
    }
    this.panel.hidden = !this.open
    this.updateActive()
  }

  private render(): void {
    const tree = nest(this.headings)
    this.list.innerHTML = tree.map((node) => this.renderNode(node)).join('')
    this.list.hidden = tree.length === 0

    const empty = this.panel.querySelector('.markdown-vista-toc__empty') as HTMLElement
    empty.hidden = tree.length > 0

    this.countLabel.textContent = this.headings.length ? String(this.headings.length) : ''

    const keys = collapsibleKeys(tree)
    const allCollapsed = keys.length > 0 && keys.every((key) => this.collapsed.has(key))
    this.collapseButton.hidden = keys.length === 0
    this.collapseButton.innerHTML = allCollapsed ? ICONS.expandAll : ICONS.collapseAll
    this.collapseButton.title = allCollapsed ? 'Expand all' : 'Collapse all'
    this.collapseButton.setAttribute('aria-label', this.collapseButton.title)

    this.markActive()
  }

  private renderNode(node: Node): string {
    const escaped = escapeHtml(node.text)
    const key = escapeHtml(node.key)
    const isCollapsed = this.collapsed.has(node.key)
    const caret = node.children.length
      ? `<button type="button" class="markdown-vista-toc__caret${isCollapsed ? '' : ' markdown-vista-toc__caret--open'}" data-key="${key}" aria-label="${isCollapsed ? 'Expand' : 'Collapse'} ${escaped}">${ICONS.caret}</button>`
      : '<span class="markdown-vista-toc__caret-spacer"></span>'

    const children =
      node.children.length && !isCollapsed
        ? `<ol class="markdown-vista-toc__list">${node.children.map((child) => this.renderNode(child)).join('')}</ol>`
        : ''

    // A button, not an anchor. An `<a href="#…">` is claimed by the built-in
    // preview's own link handling, which scrolls the document — and the editor
    // through scroll sync — before our jump lands.
    return (
      `<li class="markdown-vista-toc__item" data-level="${node.level}">` +
      `<div class="markdown-vista-toc__row">${caret}` +
      `<button type="button" class="markdown-vista-toc__link" data-key="${key}" title="${escaped}">${escaped}</button>` +
      `</div>${children}</li>`
    )
  }

  /** The last heading whose top edge is at or above the viewport top. */
  private updateActive(): void {
    if (!this.headings.length) {
      this.activeKey = null
      return
    }
    if (Date.now() < this.revealingUntil) return
    let active = this.headings[0].key
    for (const heading of this.headings) {
      if (!heading.element.isConnected) continue
      if (heading.element.getBoundingClientRect().top - SCROLL_ACTIVE_OFFSET > 0) break
      active = heading.key
    }
    if (active === this.activeKey) return
    this.activeKey = active
    this.markActive()
    if (this.open) this.scrollActiveIntoView()
  }

  private markActive(): void {
    for (const link of Array.from(this.list.querySelectorAll<HTMLElement>('.markdown-vista-toc__link'))) {
      link.classList.toggle('markdown-vista-toc__link--active', link.dataset.key === this.activeKey)
    }
  }

  /**
   * Scrolls the panel only. `scrollIntoView` would also scroll every ancestor
   * scroll container — including the document — which silently cancels an
   * in-flight smooth scroll from a click-to-jump.
   */
  private scrollActiveIntoView(): void {
    const active = this.list.querySelector<HTMLElement>('.markdown-vista-toc__link--active')
    if (!active) return
    const item = active.getBoundingClientRect()
    const box = this.list.getBoundingClientRect()
    if (item.top < box.top) this.list.scrollTop -= box.top - item.top + 4
    else if (item.bottom > box.bottom) this.list.scrollTop += item.bottom - box.bottom + 4
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

let toc: Toc | null = null

/** Creates the table of contents on first use, then keeps it in sync. */
export function syncToc(): void {
  const config = readConfig()
  if (!toc && !config.tocEnabled) return
  toc ??= new Toc(config)
  toc.sync(config)
}
