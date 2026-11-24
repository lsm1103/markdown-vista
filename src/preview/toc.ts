import { ICONS } from './icons'
import { readConfig, type PreviewConfig } from './config'
import { collectHeadings, nest, type Heading, type HeadingNode as Node } from './headings'
import { endReveal, isRevealing, revealHeading } from './navigate'
import { topInset } from './layout'

const SCROLL_ACTIVE_OFFSET = 12
const MIN_WIDTH = 200
const MAX_WIDTH = 560
const DEFAULT_WIDTH = 280
/**
 * Viewport width at which the drawer starts reserving space instead of floating
 * over the text. Below it the preview pane is too narrow to give up 280px.
 */
const PUSH_MIN_WIDTH = 880

const STORAGE_KEY = 'markdown-vista:toc'
/** Documents whose collapsed state is remembered before the oldest is dropped. */
const STORAGE_DOC_LIMIT = 40

interface StoredState {
  open: boolean
  width: number
  collapsed: Record<string, string[]>
  /** False when nothing was stored yet, so the setting decides instead. */
  restored: boolean
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

/** Identifies the document for per-file state. The preview titles itself with
 *  the file name. */
function documentKey(): string {
  return document.title || 'untitled'
}

function readState(): StoredState {
  const fallback: StoredState = { open: false, width: DEFAULT_WIDTH, collapsed: {}, restored: false }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<StoredState>
    return {
      open: parsed.open ?? fallback.open,
      width: clamp(Number(parsed.width) || DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH),
      collapsed: parsed.collapsed ?? {},
      restored: true
    }
  } catch {
    // Storage can be unavailable or full; the drawer must still work.
    return fallback
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

class Toc {
  private readonly toggle: HTMLButtonElement
  private readonly scrim: HTMLElement
  private readonly panel: HTMLElement
  private readonly list: HTMLOListElement
  private readonly filterInput: HTMLInputElement
  private readonly countLabel: HTMLElement
  private readonly collapseButton: HTMLButtonElement
  private readonly emptyLabel: HTMLElement

  private headings: Heading[] = []
  private signature = ''
  private collapsed = new Set<string>()
  private open = false
  private width = DEFAULT_WIDTH
  private filter = ''
  private activeKey: string | null = null
  private cursorKey: string | null = null
  private scrollScheduled = false
  private bodyPadding: number | null = null

  constructor(config: PreviewConfig) {
    const stored = readState()
    this.width = stored.width
    this.collapsed = new Set(stored.collapsed[documentKey()] ?? [])

    this.toggle = document.createElement('button')
    this.toggle.type = 'button'
    this.toggle.className = 'markdown-vista-toc-toggle'
    this.toggle.title = 'Table of contents'
    this.toggle.setAttribute('aria-label', 'Table of contents')
    this.toggle.innerHTML = ICONS.list

    this.scrim = document.createElement('div')
    this.scrim.className = 'markdown-vista-toc-scrim'
    this.scrim.hidden = true

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
      <div class="markdown-vista-toc__search">
        <input type="text" class="markdown-vista-toc__filter" placeholder="Filter headings" aria-label="Filter headings" spellcheck="false" />
        <button type="button" class="markdown-vista-toc__btn markdown-vista-toc__clear" data-toc-action="clear-filter" title="Clear filter" aria-label="Clear filter" hidden>${ICONS.close}</button>
      </div>
      <ol class="markdown-vista-toc__list"></ol>
      <p class="markdown-vista-toc__empty" hidden>No headings in this document.</p>
      <div class="markdown-vista-toc__resize" role="separator" aria-label="Resize table of contents"></div>
    `

    this.list = this.panel.querySelector('.markdown-vista-toc__list') as HTMLOListElement
    this.filterInput = this.panel.querySelector('.markdown-vista-toc__filter') as HTMLInputElement
    this.countLabel = this.panel.querySelector('.markdown-vista-toc__count') as HTMLElement
    this.collapseButton = this.panel.querySelector('[data-toc-action="collapse"]') as HTMLButtonElement
    this.emptyLabel = this.panel.querySelector('.markdown-vista-toc__empty') as HTMLElement

    this.attach()
    this.bind()
    this.applyWidth()
    // Once the reader has opened or closed the drawer themselves, that choice
    // outranks the setting — otherwise closing it would never stick.
    if (stored.restored ? stored.open : config.tocOpenByDefault) this.setOpen(true)
  }

  /** The built-in preview rebuilds the body on every edit; re-attach if dropped. */
  private attach(): void {
    if (!this.toggle.isConnected) document.body.append(this.toggle)
    if (!this.scrim.isConnected) document.body.append(this.scrim)
    if (!this.panel.isConnected) document.body.append(this.panel)
  }

  // -- persistence ---------------------------------------------------------

  private save(): void {
    try {
      const stored = readState()
      const collapsed = { ...stored.collapsed, [documentKey()]: Array.from(this.collapsed) }
      const keys = Object.keys(collapsed)
      for (const stale of keys.slice(0, Math.max(0, keys.length - STORAGE_DOC_LIMIT))) delete collapsed[stale]
      const next: StoredState = { open: this.open, width: this.width, collapsed, restored: true }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* storage unavailable — state simply does not persist */
    }
  }

  // -- layout --------------------------------------------------------------

  /** True when the pane is wide enough to reserve space instead of overlaying. */
  private get pushes(): boolean {
    return window.innerWidth >= PUSH_MIN_WIDTH
  }

  private applyWidth(): void {
    document.documentElement.style.setProperty('--markdown-vista-toc-width', `${this.width}px`)
    this.applyBodyOffset()
  }

  /**
   * Reserves space for the drawer by padding the body. Read once and cached,
   * because the preview's own padding is what we add to.
   */
  private applyBodyOffset(): void {
    if (this.bodyPadding === null) {
      this.bodyPadding = Number.parseFloat(getComputedStyle(document.body).paddingLeft) || 0
    }
    if (this.open && this.pushes) {
      document.body.style.paddingLeft = `${this.bodyPadding + this.width}px`
      document.body.classList.add('markdown-vista-toc-pushed')
    } else {
      document.body.style.paddingLeft = ''
      document.body.classList.remove('markdown-vista-toc-pushed')
    }
  }

  /**
   * Runs `change`, then restores the reading position. Opening the drawer in
   * push mode reflows the text, which would otherwise move the section the
   * reader was looking at out from under them.
   */
  private preservingPosition(change: () => void): void {
    const anchor = this.headings.find(
      (heading) => heading.element.isConnected && heading.element.getBoundingClientRect().top >= -1
    )
    const before = anchor?.element.getBoundingClientRect().top

    change()

    if (!anchor?.element.isConnected || before === undefined) return
    const after = anchor.element.getBoundingClientRect().top
    if (Math.abs(after - before) > 1) window.scrollBy({ top: after - before, behavior: 'auto' })
  }

  // -- wiring --------------------------------------------------------------

  private bind(): void {
    this.toggle.addEventListener('click', (event) => {
      event.stopPropagation()
      this.setOpen(!this.open)
    })

    this.scrim.addEventListener('click', (event) => {
      event.stopPropagation()
      this.setOpen(false)
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
      if (action === 'clear-filter') {
        this.setFilter('')
        this.filterInput.focus()
        return
      }

      const caret = target.closest<HTMLElement>('.markdown-vista-toc__caret')
      if (caret) {
        this.toggleNode(caret.dataset.key ?? '')
        return
      }

      const link = target.closest<HTMLElement>('.markdown-vista-toc__link')
      if (link) this.reveal(link.dataset.key ?? '')
    })

    this.filterInput.addEventListener('input', () => this.setFilter(this.filterInput.value))
    this.filterInput.addEventListener('keydown', (event) => this.onFilterKey(event))

    this.bindResize()

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.open) return
      if (document.querySelector('.markdown-vista-viewer:not([hidden])')) return
      this.setOpen(false)
    })

    window.addEventListener('resize', () => this.applyBodyOffset())

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

  private bindResize(): void {
    const handle = this.panel.querySelector('.markdown-vista-toc__resize') as HTMLElement
    let pointerId: number | null = null
    let startX = 0
    let startWidth = 0

    handle.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
      event.preventDefault()
      pointerId = event.pointerId
      startX = event.clientX
      startWidth = this.width
      handle.setPointerCapture(event.pointerId)
      this.panel.classList.add('markdown-vista-toc--resizing')
    })

    handle.addEventListener('pointermove', (event) => {
      if (pointerId !== event.pointerId) return
      this.width = clamp(startWidth + event.clientX - startX, MIN_WIDTH, MAX_WIDTH)
      this.applyWidth()
    })

    const end = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) return
      pointerId = null
      this.panel.classList.remove('markdown-vista-toc--resizing')
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
      this.save()
    }
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  // -- open / filter -------------------------------------------------------

  private setOpen(open: boolean): void {
    if (this.open === open) return
    this.preservingPosition(() => {
      this.open = open
      this.panel.hidden = !open
      this.scrim.hidden = !open || this.pushes
      this.toggle.hidden = open
      this.toggle.setAttribute('aria-expanded', String(open))
      this.applyBodyOffset()
    })

    if (open) {
      this.updateActive()
      this.scrollActiveIntoView()
    } else {
      this.setFilter('')
      endReveal()
    }
    this.save()
  }

  private setFilter(value: string): void {
    const next = value.trim()
    if (this.filterInput.value !== value) this.filterInput.value = value
    ;(this.panel.querySelector('.markdown-vista-toc__clear') as HTMLElement).hidden = next.length === 0
    if (this.filter === next) return
    this.filter = next
    this.cursorKey = null
    this.render()
  }

  /** Keys to show: every match plus the ancestors that lead to it. */
  private visibleKeys(tree: Node[]): Set<string> | null {
    if (!this.filter) return null
    const needle = this.filter.toLowerCase()
    const visible = new Set<string>()

    const walk = (node: Node, ancestors: string[]): boolean => {
      const path = [...ancestors, node.key]
      const matched = node.text.toLowerCase().includes(needle)
      let childMatched = false
      for (const child of node.children) childMatched = walk(child, path) || childMatched
      if (matched || childMatched) {
        for (const key of path) visible.add(key)
        return true
      }
      return false
    }

    for (const node of tree) walk(node, [])
    return visible
  }

  private onFilterKey(event: KeyboardEvent): void {
    const keys = this.renderedKeys()
    // Keys handled here must not also reach the document-level Escape handler,
    // which would close the drawer while the user only meant to clear a filter.
    if (['Escape', 'Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) event.stopPropagation()

    if (event.key === 'Escape') {
      event.preventDefault()
      if (this.filter) this.setFilter('')
      else this.setOpen(false)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const target = this.cursorKey ?? keys[0]
      if (target) this.reveal(target)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

    event.preventDefault()
    if (!keys.length) return
    const current = this.cursorKey ? keys.indexOf(this.cursorKey) : -1
    const next = event.key === 'ArrowDown' ? current + 1 : current - 1
    this.cursorKey = keys[clamp(next, 0, keys.length - 1)]
    this.markCursor()
  }

  /** Entry keys in the order they are currently displayed. */
  private renderedKeys(): string[] {
    return Array.from(this.list.querySelectorAll<HTMLElement>('.markdown-vista-toc__link')).map(
      (link) => link.dataset.key ?? ''
    )
  }

  private toggleNode(key: string): void {
    if (!key) return
    if (this.collapsed.has(key)) this.collapsed.delete(key)
    else this.collapsed.add(key)
    this.render()
    this.save()
  }

  private toggleAll(): void {
    const keys = collapsibleKeys(nest(this.headings))
    const allCollapsed = keys.length > 0 && keys.every((key) => this.collapsed.has(key))
    this.collapsed = allCollapsed ? new Set() : new Set(keys)
    this.render()
    this.save()
  }

  // -- jumping -------------------------------------------------------------

  private reveal(key: string): void {
    const heading = this.headings.find((item) => item.key === key)
    if (!heading?.element.isConnected) return

    this.activeKey = key
    this.cursorKey = key
    this.markActive()
    revealHeading(heading)

    // On a narrow pane the drawer covers the text it just navigated to.
    if (!this.pushes) this.setOpen(false)
  }

  // -- rendering -----------------------------------------------------------

  /** Re-reads the document; rebuilds the list only when the headings changed. */
  sync(config: PreviewConfig): void {
    this.attach()

    if (!config.tocEnabled) {
      this.toggle.hidden = true
      this.panel.hidden = true
      this.scrim.hidden = true
      document.body.style.paddingLeft = ''
      return
    }
    this.toggle.hidden = this.open

    // Element references are refreshed every time — the preview replaces the
    // heading nodes on each render even when the text is unchanged.
    this.headings = collectHeadings(config.tocMaxLevel)
    const signature = this.headings.map((heading) => heading.key).join(' ')
    if (signature !== this.signature) {
      this.signature = signature
      const keys = new Set(this.headings.map((heading) => heading.key))
      for (const key of Array.from(this.collapsed)) if (!keys.has(key)) this.collapsed.delete(key)
      this.render()
    }
    this.panel.hidden = !this.open
    this.scrim.hidden = !this.open || this.pushes
    this.applyBodyOffset()
    this.updateActive()
  }

  private render(): void {
    const tree = nest(this.headings)
    const visible = this.visibleKeys(tree)
    this.list.innerHTML = tree.map((node) => this.renderNode(node, visible)).join('')

    const hasRows = this.list.querySelector('.markdown-vista-toc__link') !== null
    this.list.hidden = !hasRows
    this.emptyLabel.hidden = hasRows
    this.emptyLabel.textContent = this.headings.length
      ? 'No heading matches the filter.'
      : 'No headings in this document.'

    this.countLabel.textContent = this.headings.length ? String(this.headings.length) : ''

    const keys = collapsibleKeys(tree)
    const allCollapsed = keys.length > 0 && keys.every((key) => this.collapsed.has(key))
    this.collapseButton.hidden = keys.length === 0 || Boolean(this.filter)
    this.collapseButton.innerHTML = allCollapsed ? ICONS.expandAll : ICONS.collapseAll
    this.collapseButton.title = allCollapsed ? 'Expand all' : 'Collapse all'
    this.collapseButton.setAttribute('aria-label', this.collapseButton.title)

    this.markActive()
    this.markCursor()
  }

  private renderNode(node: Node, visible: Set<string> | null): string {
    if (visible && !visible.has(node.key)) return ''

    const escaped = escapeHtml(node.text)
    const key = escapeHtml(node.key)
    // A filter that hid a branch's parent would hide the match itself, so
    // filtering always shows the full path and ignores collapsed state.
    const isCollapsed = !visible && this.collapsed.has(node.key)
    const caret = node.children.length
      ? `<button type="button" class="markdown-vista-toc__caret${isCollapsed ? '' : ' markdown-vista-toc__caret--open'}" data-key="${key}" aria-label="${isCollapsed ? 'Expand' : 'Collapse'} ${escaped}">${ICONS.caret}</button>`
      : '<span class="markdown-vista-toc__caret-spacer"></span>'

    const children =
      node.children.length && !isCollapsed
        ? `<ol class="markdown-vista-toc__list">${node.children.map((child) => this.renderNode(child, visible)).join('')}</ol>`
        : ''

    // A button, not an anchor. An `<a href="#…">` is claimed by the built-in
    // preview's own link handling, which scrolls the document — and the editor
    // through scroll sync — before our jump lands.
    return (
      `<li class="markdown-vista-toc__item" data-level="${node.level}">` +
      `<div class="markdown-vista-toc__row">${caret}` +
      `<button type="button" class="markdown-vista-toc__link" data-key="${key}" title="${escaped}">${this.highlight(node.text)}</button>` +
      `</div>${children}</li>`
    )
  }

  /** Marks the filtered substring inside an entry. */
  private highlight(text: string): string {
    if (!this.filter) return escapeHtml(text)
    const index = text.toLowerCase().indexOf(this.filter.toLowerCase())
    if (index < 0) return escapeHtml(text)
    return (
      escapeHtml(text.slice(0, index)) +
      `<em class="markdown-vista-toc__match">${escapeHtml(text.slice(index, index + this.filter.length))}</em>` +
      escapeHtml(text.slice(index + this.filter.length))
    )
  }

  /** The last heading whose top edge is at or above the viewport top. */
  private updateActive(): void {
    if (!this.headings.length) {
      this.activeKey = null
      return
    }
    if (isRevealing()) return
    let active = this.headings[0].key
    for (const heading of this.headings) {
      if (!heading.element.isConnected) continue
      if (heading.element.getBoundingClientRect().top - topInset() - SCROLL_ACTIVE_OFFSET > 0) break
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

  private markCursor(): void {
    let cursor: HTMLElement | null = null
    for (const link of Array.from(this.list.querySelectorAll<HTMLElement>('.markdown-vista-toc__link'))) {
      const isCursor = this.cursorKey !== null && link.dataset.key === this.cursorKey
      link.classList.toggle('markdown-vista-toc__link--cursor', isCursor)
      if (isCursor) cursor = link
    }
    if (cursor) this.scrollIntoPanel(cursor)
  }

  /**
   * Scrolls the panel only. `scrollIntoView` would also scroll every ancestor
   * scroll container — including the document — which would fight a jump.
   */
  private scrollIntoPanel(element: HTMLElement): void {
    const item = element.getBoundingClientRect()
    const box = this.list.getBoundingClientRect()
    if (item.top < box.top) this.list.scrollTop -= box.top - item.top + 4
    else if (item.bottom > box.bottom) this.list.scrollTop += item.bottom - box.bottom + 4
  }

  private scrollActiveIntoView(): void {
    const active = this.list.querySelector<HTMLElement>('.markdown-vista-toc__link--active')
    if (active) this.scrollIntoPanel(active)
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
