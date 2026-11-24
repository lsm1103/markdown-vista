import { collectHeadings, headingPath, type Heading } from './headings'
import { readConfig } from './config'
import { setTopInset, topInset } from './layout'
import { revealHeading } from './navigate'

const BAR_HEIGHT = 28
/**
 * Scroll events are dispatched on the frame lifecycle, and a hidden document
 * runs no frames — the bar would freeze on whatever section it last saw. A
 * cheap poll that exits immediately unless the page actually moved covers it.
 */
const POLL_MS = 250

/**
 * Shows the path of the section currently being read.
 *
 * In a long design document the recurring question is not "what is in here"
 * — the outline answers that — but "where am I right now". The drawer answers
 * it only while it is open and only if the reader looks; the bar answers it
 * continuously and costs one line.
 */
class Breadcrumb {
  private readonly bar: HTMLElement
  private headings: Heading[] = []
  private activeKey: string | null = null
  private scheduled = false
  private lastScrollY = -1
  private bodyPadding: number | null = null

  constructor() {
    this.bar = document.createElement('div')
    this.bar.className = 'markdown-vista-breadcrumb'
    this.bar.setAttribute('aria-label', 'Current section')

    this.bar.addEventListener('click', (event) => {
      const crumb = (event.target as HTMLElement).closest<HTMLElement>('.markdown-vista-breadcrumb__crumb')
      if (!crumb) return
      event.stopPropagation()
      const heading = this.headings.find((item) => item.key === crumb.dataset.key)
      if (heading) revealHeading(heading)
    })

    window.addEventListener(
      'scroll',
      () => {
        if (this.scheduled) return
        this.scheduled = true
        window.setTimeout(() => {
          this.scheduled = false
          this.update()
        }, 60)
      },
      { passive: true }
    )

    window.setInterval(() => {
      if (this.bar.hidden || window.scrollY === this.lastScrollY) return
      this.lastScrollY = window.scrollY
      this.update()
    }, POLL_MS)
  }

  private attach(): void {
    if (!this.bar.isConnected) document.body.append(this.bar)
  }

  /** Reserves the bar's height once, rather than toggling it while scrolling. */
  private applyOffset(enabled: boolean): void {
    if (this.bodyPadding === null) {
      this.bodyPadding = Number.parseFloat(getComputedStyle(document.body).paddingTop) || 0
    }
    if (enabled) {
      document.body.style.paddingTop = `${this.bodyPadding + BAR_HEIGHT}px`
      setTopInset(BAR_HEIGHT)
    } else {
      document.body.style.paddingTop = ''
      setTopInset(0)
    }
  }

  sync(): void {
    const enabled = readConfig().breadcrumbEnabled
    this.attach()
    this.bar.hidden = !enabled
    this.applyOffset(enabled)
    if (!enabled) return

    this.headings = collectHeadings()
    this.activeKey = null
    this.update()
  }

  private currentKey(): string | null {
    let active: string | null = null
    for (const heading of this.headings) {
      if (!heading.element.isConnected) continue
      if (heading.element.getBoundingClientRect().top - topInset() - 4 > 0) break
      active = heading.key
    }
    return active
  }

  private update(): void {
    if (this.bar.hidden) return
    const key = this.currentKey()
    if (key === this.activeKey && this.bar.childElementCount) return
    this.activeKey = key

    const path = key ? headingPath(this.headings, key) : []
    if (!path.length) {
      // Above the first heading there is no section yet; the document's own
      // name is more useful than an empty bar that reads as a glitch.
      const title = document.createElement('span')
      title.className = 'markdown-vista-breadcrumb__document'
      title.textContent = document.title
      this.bar.replaceChildren(title)
      return
    }

    const nodes: globalThis.Node[] = []
    path.forEach((heading, index) => {
      if (index > 0) {
        const separator = document.createElement('span')
        separator.className = 'markdown-vista-breadcrumb__separator'
        separator.textContent = '›'
        nodes.push(separator)
      }
      const crumb = document.createElement('button')
      crumb.type = 'button'
      crumb.className = 'markdown-vista-breadcrumb__crumb'
      crumb.dataset.key = heading.key
      crumb.textContent = heading.text
      crumb.title = heading.text
      nodes.push(crumb)
    })
    this.bar.replaceChildren(...nodes)
  }
}

let breadcrumb: Breadcrumb | null = null

export function syncBreadcrumb(): void {
  if (!breadcrumb && !readConfig().breadcrumbEnabled) return
  breadcrumb ??= new Breadcrumb()
  breadcrumb.sync()
}
