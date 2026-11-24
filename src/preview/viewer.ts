import { ICONS } from './icons'
import { readConfig, type PreviewConfig } from './config'

const ZOOM_LEVELS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 10]
const MIN_ZOOM = ZOOM_LEVELS[0]
const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1]
const MINIMAP_WIDTH = 160
const MINIMAP_HEIGHT = 110
const MODAL_MIN_WIDTH = 420
const MODAL_MIN_HEIGHT = 320
const MODAL_WINDOW_GUTTER = 24
const STAGE_PADDING = 80
/** Fit may enlarge a small graphic — magnifying is the point of the viewer —
 *  but not without bound, or a 16px badge would fill the screen. */
const MAX_FIT_SCALE = 4
const RESIZE_DIRECTIONS = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'] as const

type ResizeDirection = (typeof RESIZE_DIRECTIONS)[number]

interface Size {
  width: number
  height: number
}

interface View {
  zoom: number
  x: number
  y: number
}

interface Bounds {
  left: number
  top: number
  width: number
  height: number
}

type Content = (
  | { kind: 'svg'; markup: string; size: Size; name: string; exportable: true }
  | { kind: 'image'; src: string; size: Size; name: string; exportable: true }
  | { kind: 'html'; node: HTMLElement; size: Size; name: string; exportable: false }
) & {
  /** Mermaid definition behind the graphic, when there is one. */
  source?: string
}

/**
 * Our own chrome. Everything inside it is UI, never document content — the
 * toolbar icons and outline carets are inline SVG, so without this they would
 * be collected as zoomable graphics and steal their own clicks.
 */
export const OWN_UI_SELECTOR =
  '.markdown-vista-viewer, .markdown-vista-toc, .markdown-vista-toc-toggle, .markdown-vista-toc-scrim'

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function svgSize(markup: string): Size {
  const element = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement
  const viewBox = element.getAttribute('viewBox')?.trim().split(/[\s,]+/g).map(Number)
  if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
    return { width: viewBox[2], height: viewBox[3] }
  }
  const width = Number.parseFloat(element.getAttribute('width') ?? '')
  const height = Number.parseFloat(element.getAttribute('height') ?? '')
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1000,
    height: Number.isFinite(height) && height > 0 ? height : 700
  }
}

// ---------------------------------------------------------------------------
// Collecting the zoomable graphics in document order
// ---------------------------------------------------------------------------

export function collectGraphics(config: PreviewConfig): HTMLElement[] {
  const selectors = ['.mermaid-diagram > svg']
  if (config.includeImages) selectors.push('img', 'svg')
  if (config.includeMath) selectors.push('.katex-display')

  const seen = new Set<HTMLElement>()
  const result: HTMLElement[] = []

  for (const node of Array.from(document.querySelectorAll<HTMLElement>(selectors.join(',')))) {
    if (node.closest(OWN_UI_SELECTOR)) continue
    // A KaTeX formula is one unit; never offer its internal <svg> strokes.
    if (node.tagName.toLowerCase() === 'svg' && node.closest('.katex')) continue
    // Nested SVG elements inside an already-collected diagram.
    if (node.tagName.toLowerCase() === 'svg' && node.parentElement?.closest('svg')) continue
    // A display formula supersedes any image inside it.
    const mathHost = node.closest<HTMLElement>('.katex-display')
    const target = mathHost && config.includeMath ? mathHost : node
    if (seen.has(target)) continue
    seen.add(target)
    result.push(target)
  }

  return result
}

function graphicName(node: HTMLElement): string {
  const container = node.closest<HTMLElement>('.mermaid-diagram')
  if (container) {
    return container.dataset.mermaidTitle || container.dataset.mermaidLabel || 'Diagram'
  }
  if (node instanceof HTMLImageElement) {
    return node.alt.trim() || node.title.trim() || 'Image'
  }
  if (node.classList.contains('katex-display')) return 'Formula'
  return node.querySelector('title')?.textContent?.trim() || 'Graphic'
}

function graphicContent(node: HTMLElement): Content {
  const name = graphicName(node)

  if (node instanceof HTMLImageElement) {
    const rect = node.getBoundingClientRect()
    return {
      kind: 'image',
      src: node.currentSrc || node.src,
      size: {
        width: node.naturalWidth || rect.width || 1000,
        height: node.naturalHeight || rect.height || 700
      },
      name,
      exportable: true
    }
  }

  if (node.tagName.toLowerCase() === 'svg') {
    const markup = node.outerHTML
    const source = node.closest<HTMLElement>('.mermaid-diagram')?.dataset.mermaidSource
    return { kind: 'svg', markup, size: svgSize(markup), name, exportable: true, source }
  }

  const rect = node.getBoundingClientRect()
  return {
    kind: 'html',
    node,
    size: { width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) },
    name,
    exportable: false
  }
}

// ---------------------------------------------------------------------------
// PNG export
// ---------------------------------------------------------------------------

async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Could not load the graphic.'))
    image.src = src
  })
  return image
}

async function toPngBlob(content: Content): Promise<Blob> {
  const { width, height } = content.size
  const scale = Math.min(2, 8192 / Math.max(width, height))

  const source =
    content.kind === 'svg'
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
          content.markup.includes('xmlns=')
            ? content.markup
            : content.markup.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"')
        )}`
      : content.kind === 'image'
        ? content.src
        : ''
  if (!source) throw new Error('This graphic cannot be exported as PNG.')

  const image = await loadImage(source)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not create an image canvas.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the PNG.'))), 'image/png')
  })
}

function exportFileName(name: string, index: number): string {
  const slug =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9一-龥]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'graphic'
  return `${slug}-${index}.png`
}

// ---------------------------------------------------------------------------
// The viewer
// ---------------------------------------------------------------------------

class Viewer {
  private readonly root: HTMLDivElement
  private readonly modal: HTMLElement
  private readonly stage: HTMLDivElement
  private readonly canvas: HTMLDivElement
  private readonly minimap: HTMLDivElement
  private readonly minimapCanvas: HTMLDivElement
  private readonly minimapViewport: HTMLDivElement
  private readonly title: HTMLSpanElement
  private readonly counter: HTMLSpanElement
  private readonly previousButton: HTMLButtonElement
  private readonly nextButton: HTMLButtonElement
  private readonly zoomOutButton: HTMLButtonElement
  private readonly zoomInButton: HTMLButtonElement
  private readonly zoomSelect: HTMLSelectElement
  private readonly exportButton: HTMLButtonElement
  private readonly exportSvgButton: HTMLButtonElement
  private readonly sourceButton: HTMLButtonElement
  private readonly sourcePanel: HTMLElement
  private readonly sourceCode: HTMLElement
  private readonly toast: HTMLDivElement

  private config: PreviewConfig = readConfig()
  private graphics: HTMLElement[] = []
  private content: Content | null = null
  private index = 0
  private view: View = { zoom: 1, x: 0, y: 0 }
  private stageSize: Size = { width: 0, height: 0 }
  private modalBounds: Bounds | null = null
  private drag: { pointerId: number; x: number; y: number; startX: number; startY: number } | null = null
  private minimapPointer: number | null = null
  private resize: ({ pointerId: number; direction: ResizeDirection; x: number; y: number } & Bounds) | null = null
  private toastTimer: number | null = null

  constructor() {
    this.root = document.createElement('div')
    this.root.className = 'markdown-vista-viewer'
    this.root.hidden = true
    this.root.innerHTML = `
      <section class="markdown-vista-viewer__modal" role="dialog" aria-modal="true" aria-label="Graphic viewer">
        <header class="markdown-vista-viewer__header">
          <h2 class="markdown-vista-viewer__title">${ICONS.image}<span></span></h2>
          <div class="markdown-vista-viewer__nav">
            <button type="button" class="markdown-vista-viewer__btn" data-action="previous" title="Previous graphic" aria-label="Previous graphic">${ICONS.chevronLeft}</button>
            <span class="markdown-vista-viewer__count"></span>
            <button type="button" class="markdown-vista-viewer__btn" data-action="next" title="Next graphic" aria-label="Next graphic">${ICONS.chevronRight}</button>
          </div>
          <div class="markdown-vista-viewer__actions">
            <button type="button" class="markdown-vista-viewer__btn" data-action="zoom-out" title="Zoom out" aria-label="Zoom out">${ICONS.minus}</button>
            <select class="markdown-vista-viewer__zoom" aria-label="Zoom level"></select>
            <button type="button" class="markdown-vista-viewer__btn" data-action="zoom-in" title="Zoom in" aria-label="Zoom in">${ICONS.plus}</button>
            <button type="button" class="markdown-vista-viewer__btn" data-action="fit" title="Fit to view" aria-label="Fit to view">${ICONS.fit}</button>
            <button type="button" class="markdown-vista-viewer__btn" data-action="source" title="Show the diagram source" aria-label="Show the diagram source">${ICONS.code}</button>
            <button type="button" class="markdown-vista-viewer__btn" data-action="export-svg" title="Export as SVG" aria-label="Export as SVG">${ICONS.vector}</button>
            <button type="button" class="markdown-vista-viewer__btn" data-action="export" title="Export as PNG" aria-label="Export as PNG">${ICONS.download}</button>
            <button type="button" class="markdown-vista-viewer__btn markdown-vista-viewer__btn--close" data-action="close" title="Close (Esc)" aria-label="Close">${ICONS.close}</button>
          </div>
        </header>
        <div class="markdown-vista-viewer__stage">
          <div class="markdown-vista-viewer__canvas"></div>
          <div class="markdown-vista-viewer__minimap" hidden>
            <div class="markdown-vista-viewer__minimap-canvas"></div>
            <div class="markdown-vista-viewer__minimap-viewport"></div>
          </div>
        </div>
        <div class="markdown-vista-viewer__source" hidden>
          <div class="markdown-vista-viewer__source-head">
            <span>Diagram source</span>
            <button type="button" class="markdown-vista-viewer__btn" data-action="copy-source" title="Copy source" aria-label="Copy source">${ICONS.copy}</button>
          </div>
          <pre><code></code></pre>
        </div>
        <div class="markdown-vista-viewer__toast" hidden></div>
        ${RESIZE_DIRECTIONS.map(
          (direction) =>
            `<div class="markdown-vista-viewer__resize markdown-vista-viewer__resize--${direction}" data-direction="${direction}"></div>`
        ).join('')}
      </section>
    `

    const query = <T extends Element>(selector: string): T => {
      const element = this.root.querySelector<T>(selector)
      if (!element) throw new Error(`Viewer markup is missing ${selector}`)
      return element
    }

    this.modal = query('.markdown-vista-viewer__modal')
    this.stage = query('.markdown-vista-viewer__stage')
    this.canvas = query('.markdown-vista-viewer__canvas')
    this.minimap = query('.markdown-vista-viewer__minimap')
    this.minimapCanvas = query('.markdown-vista-viewer__minimap-canvas')
    this.minimapViewport = query('.markdown-vista-viewer__minimap-viewport')
    this.title = query('.markdown-vista-viewer__title span')
    this.counter = query('.markdown-vista-viewer__count')
    this.previousButton = query('[data-action="previous"]')
    this.nextButton = query('[data-action="next"]')
    this.zoomOutButton = query('[data-action="zoom-out"]')
    this.zoomInButton = query('[data-action="zoom-in"]')
    this.zoomSelect = query('.markdown-vista-viewer__zoom')
    this.exportButton = query('[data-action="export"]')
    this.exportSvgButton = query('[data-action="export-svg"]')
    this.sourceButton = query('[data-action="source"]')
    this.sourcePanel = query('.markdown-vista-viewer__source')
    this.sourceCode = query('.markdown-vista-viewer__source code')
    this.toast = query('.markdown-vista-viewer__toast')

    this.zoomSelect.innerHTML =
      '<option value="fit">Fit</option>' +
      ZOOM_LEVELS.map((zoom) => `<option value="${zoom}">${Math.round(zoom * 100)}%</option>`).join('')

    document.body.append(this.root)
    this.bind()
  }

  // -- wiring --------------------------------------------------------------

  private bind(): void {
    this.root.addEventListener('mousedown', (event) => {
      if (event.target === this.root) this.close()
    })

    this.root.addEventListener('click', (event) => {
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action
      if (!action) return
      if (action === 'close') this.close()
      else if (action === 'previous') this.openAt(this.index - 1)
      else if (action === 'next') this.openAt(this.index + 1)
      else if (action === 'zoom-in') this.stepZoom(1)
      else if (action === 'zoom-out') this.stepZoom(-1)
      else if (action === 'fit') this.setView({ zoom: 1, x: 0, y: 0 })
      else if (action === 'export') void this.exportPng()
      else if (action === 'export-svg') void this.exportSvg()
      else if (action === 'source') this.toggleSource()
      else if (action === 'copy-source') void this.copySource()
    })

    this.zoomSelect.addEventListener('change', () => {
      if (this.zoomSelect.value === 'fit') this.setView({ zoom: 1, x: 0, y: 0 })
      else this.updateZoom(Number(this.zoomSelect.value))
    })

    this.stage.addEventListener('pointerdown', (event) => {
      if ((event.target as HTMLElement).closest('.markdown-vista-viewer__minimap')) return
      this.drag = { pointerId: event.pointerId, x: this.view.x, y: this.view.y, startX: event.clientX, startY: event.clientY }
      this.stage.setPointerCapture(event.pointerId)
      this.stage.classList.add('markdown-vista-viewer__stage--dragging')
    })
    this.stage.addEventListener('pointermove', (event) => {
      const drag = this.drag
      if (!drag || drag.pointerId !== event.pointerId) return
      this.setView({ ...this.view, x: drag.x + event.clientX - drag.startX, y: drag.y + event.clientY - drag.startY })
    })
    const endDrag = (event: PointerEvent): void => {
      if (this.drag?.pointerId !== event.pointerId) return
      this.drag = null
      this.stage.classList.remove('markdown-vista-viewer__stage--dragging')
      if (this.stage.hasPointerCapture(event.pointerId)) this.stage.releasePointerCapture(event.pointerId)
    }
    this.stage.addEventListener('pointerup', endDrag)
    this.stage.addEventListener('pointercancel', endDrag)

    this.stage.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault()
        this.stepZoom(event.deltaY < 0 ? 1 : -1)
      },
      { passive: false }
    )

    this.minimap.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
      this.minimapPointer = event.pointerId
      this.minimap.setPointerCapture(event.pointerId)
      this.navigateMinimap(event)
    })
    this.minimap.addEventListener('pointermove', (event) => {
      if (this.minimapPointer !== event.pointerId) return
      event.stopPropagation()
      this.navigateMinimap(event)
    })
    const endMinimap = (event: PointerEvent): void => {
      if (this.minimapPointer !== event.pointerId) return
      this.minimapPointer = null
      if (this.minimap.hasPointerCapture(event.pointerId)) this.minimap.releasePointerCapture(event.pointerId)
    }
    this.minimap.addEventListener('pointerup', endMinimap)
    this.minimap.addEventListener('pointercancel', endMinimap)

    for (const handle of Array.from(this.root.querySelectorAll<HTMLElement>('.markdown-vista-viewer__resize'))) {
      handle.addEventListener('pointerdown', (event) => {
        const rect = this.modal.getBoundingClientRect()
        event.stopPropagation()
        this.resize = {
          pointerId: event.pointerId,
          direction: handle.dataset.direction as ResizeDirection,
          x: event.clientX,
          y: event.clientY,
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height
        }
        handle.setPointerCapture(event.pointerId)
      })
      handle.addEventListener('pointermove', (event) => {
        const resize = this.resize
        if (!resize || resize.pointerId !== event.pointerId) return
        event.stopPropagation()
        this.applyResize(resize, event)
      })
      const endResize = (event: PointerEvent): void => {
        if (this.resize?.pointerId !== event.pointerId) return
        this.resize = null
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
      }
      handle.addEventListener('pointerup', endResize)
      handle.addEventListener('pointercancel', endResize)
    }

    new ResizeObserver(() => {
      this.stageSize = { width: this.stage.clientWidth, height: this.stage.clientHeight }
      this.applyView()
    }).observe(this.stage)

    document.addEventListener('keydown', (event) => {
      if (this.root.hidden) return
      if (event.key === 'Escape') {
        event.preventDefault()
        this.close()
      } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        this.openAt(this.index + 1)
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        this.openAt(this.index - 1)
      } else if (event.key === '+' || event.key === '=') {
        this.stepZoom(1)
      } else if (event.key === '-' || event.key === '_') {
        this.stepZoom(-1)
      } else if (event.key === '0') {
        this.setView({ zoom: 1, x: 0, y: 0 })
      }
    })
  }

  private applyResize(resize: NonNullable<Viewer['resize']>, event: PointerEvent): void {
    const deltaX = event.clientX - resize.x
    const deltaY = event.clientY - resize.y
    const right = resize.left + resize.width
    const bottom = resize.top + resize.height
    const fromWest = resize.direction.includes('w')
    const fromNorth = resize.direction.includes('n')

    const width = resize.direction.includes('e')
      ? clamp(resize.width + deltaX, MODAL_MIN_WIDTH, window.innerWidth - MODAL_WINDOW_GUTTER - resize.left)
      : fromWest
        ? clamp(resize.width - deltaX, MODAL_MIN_WIDTH, right - MODAL_WINDOW_GUTTER)
        : resize.width
    const height = resize.direction.includes('s')
      ? clamp(resize.height + deltaY, MODAL_MIN_HEIGHT, window.innerHeight - MODAL_WINDOW_GUTTER - resize.top)
      : fromNorth
        ? clamp(resize.height - deltaY, MODAL_MIN_HEIGHT, bottom - MODAL_WINDOW_GUTTER)
        : resize.height

    this.modalBounds = {
      left: fromWest ? right - width : resize.left,
      top: fromNorth ? bottom - height : resize.top,
      width,
      height
    }
    Object.assign(this.modal.style, {
      position: 'fixed',
      left: `${this.modalBounds.left}px`,
      top: `${this.modalBounds.top}px`,
      width: `${this.modalBounds.width}px`,
      height: `${this.modalBounds.height}px`
    })
  }

  // -- open / close --------------------------------------------------------

  open(node: HTMLElement): void {
    // The built-in preview rebuilds the body on every edit, which can detach
    // the overlay; re-attach before showing it.
    if (!this.root.isConnected) document.body.append(this.root)
    this.config = readConfig()
    this.graphics = collectGraphics(this.config)
    const index = this.graphics.indexOf(node)
    this.openAt(index < 0 ? 0 : index)
  }

  private openAt(index: number): void {
    if (index < 0 || index >= this.graphics.length) return
    const node = this.graphics[index]
    if (!node) return

    this.index = index
    this.content = graphicContent(node)
    this.view = { zoom: 1, x: 0, y: 0 }

    this.title.textContent = this.content.name
    this.counter.textContent = `${index + 1}/${this.graphics.length}`
    this.previousButton.disabled = index === 0
    this.nextButton.disabled = index === this.graphics.length - 1
    this.exportButton.hidden = this.config.pngExport === 'off' || !this.content.exportable
    this.exportSvgButton.hidden = this.content.kind !== 'svg'
    this.sourceButton.hidden = !this.content.source
    this.sourcePanel.hidden = true
    this.sourceCode.textContent = this.content.source ?? ''
    this.hideToast()

    this.canvas.replaceChildren(this.buildGraphic(this.content))
    this.minimapCanvas.replaceChildren(this.buildGraphic(this.content))

    if (this.root.hidden) {
      this.root.hidden = false
      document.body.classList.add('markdown-vista-viewer-open')
    }
    this.stageSize = { width: this.stage.clientWidth, height: this.stage.clientHeight }
    this.applyView()
  }

  private buildGraphic(content: Content): HTMLElement {
    if (content.kind === 'image') {
      const image = new Image()
      image.src = content.src
      image.alt = ''
      image.draggable = false
      image.style.width = '100%'
      image.style.height = '100%'
      return image
    }

    const host = document.createElement('div')
    host.style.width = '100%'
    host.style.height = '100%'

    if (content.kind === 'svg') {
      host.innerHTML = content.markup
      const element = host.querySelector('svg')
      if (element) {
        element.setAttribute('width', '100%')
        element.setAttribute('height', '100%')
        element.style.maxWidth = 'none'
      }
      return host
    }

    // Display math: clone the live DOM so the preview's own KaTeX stylesheet
    // still applies, then scale the clone to the canvas box.
    const clone = content.node.cloneNode(true) as HTMLElement
    clone.style.width = `${content.size.width}px`
    clone.style.margin = '0'
    clone.style.transformOrigin = 'top left'
    host.style.overflow = 'hidden'
    host.append(clone)
    return host
  }

  close(): void {
    this.root.hidden = true
    document.body.classList.remove('markdown-vista-viewer-open')
    this.content = null
    this.canvas.replaceChildren()
    this.minimapCanvas.replaceChildren()
    this.modalBounds = null
    this.modal.removeAttribute('style')
    this.hideToast()
  }

  // -- view ----------------------------------------------------------------

  private setView(view: View): void {
    this.view = view
    this.applyView()
  }

  private updateZoom(zoom: number): void {
    const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM)
    const ratio = next / this.view.zoom
    // Keep the same point at the centre of the stage while zooming; preserving
    // raw pixel offsets would make a panned graphic drift away.
    this.setView({ zoom: next, x: this.view.x * ratio, y: this.view.y * ratio })
  }

  private stepZoom(direction: -1 | 1): void {
    const current = ZOOM_LEVELS.indexOf(this.view.zoom)
    const nearest = current >= 0 ? current : ZOOM_LEVELS.findIndex((zoom) => zoom >= this.view.zoom)
    const next = clamp((nearest < 0 ? ZOOM_LEVELS.length - 1 : nearest) + direction, 0, ZOOM_LEVELS.length - 1)
    this.updateZoom(ZOOM_LEVELS[next])
  }

  /** Scale that makes the graphic fit the stage at zoom level 1. */
  private fitScale(): number {
    const source = this.content?.size
    if (!source || !this.stageSize.width || !this.stageSize.height) return 1
    return Math.min(
      (this.stageSize.width - STAGE_PADDING) / source.width,
      (this.stageSize.height - STAGE_PADDING) / source.height,
      MAX_FIT_SCALE
    )
  }

  private applyView(): void {
    const content = this.content
    if (!content) return

    const scale = this.fitScale() * this.view.zoom
    this.canvas.style.width = `${content.size.width}px`
    this.canvas.style.height = `${content.size.height}px`
    this.canvas.style.transform = `translate(-50%, -50%) translate(${this.view.x}px, ${this.view.y}px) scale(${scale})`

    this.zoomSelect.value = ZOOM_LEVELS.includes(this.view.zoom) ? String(this.view.zoom) : 'fit'
    this.zoomOutButton.disabled = this.view.zoom <= MIN_ZOOM
    this.zoomInButton.disabled = this.view.zoom >= MAX_ZOOM

    this.applyMinimap(content.size, scale)
  }

  private minimapGeometry(world: Size, scale: number) {
    const visibleWidth = this.stageSize.width / scale
    const visibleHeight = this.stageSize.height / scale
    const centerX = world.width / 2 - this.view.x / scale
    const centerY = world.height / 2 - this.view.y / scale
    const viewportLeft = centerX - visibleWidth / 2
    const viewportTop = centerY - visibleHeight / 2
    const paddingX = Math.max(48, visibleWidth * 0.16)
    const paddingY = Math.max(48, visibleHeight * 0.16)
    const left = Math.min(0, viewportLeft) - paddingX
    const top = Math.min(0, viewportTop) - paddingY
    const right = Math.max(world.width, centerX + visibleWidth / 2) + paddingX
    const bottom = Math.max(world.height, centerY + visibleHeight / 2) + paddingY
    const worldWidth = right - left
    const worldHeight = bottom - top
    const mapScale =
      worldWidth && worldHeight ? Math.min(MINIMAP_WIDTH / worldWidth, MINIMAP_HEIGHT / worldHeight) : 1
    const offsetX = (MINIMAP_WIDTH - worldWidth * mapScale) / 2
    const offsetY = (MINIMAP_HEIGHT - worldHeight * mapScale) / 2

    return {
      left,
      top,
      right,
      bottom,
      mapScale,
      offsetX,
      offsetY,
      graphicX: offsetX + -left * mapScale,
      graphicY: offsetY + -top * mapScale,
      viewportX: offsetX + (viewportLeft - left) * mapScale,
      viewportY: offsetY + (viewportTop - top) * mapScale,
      viewportWidth: visibleWidth * mapScale,
      viewportHeight: visibleHeight * mapScale
    }
  }

  private applyMinimap(world: Size, scale: number): void {
    const visible = this.config.minimap && this.view.zoom > 1
    this.minimap.hidden = !visible
    if (!visible) return

    const geometry = this.minimapGeometry(world, scale)
    Object.assign(this.minimapCanvas.style, {
      width: `${world.width}px`,
      height: `${world.height}px`,
      left: `${geometry.graphicX}px`,
      top: `${geometry.graphicY}px`,
      transform: `scale(${geometry.mapScale})`
    })
    Object.assign(this.minimapViewport.style, {
      left: `${geometry.viewportX}px`,
      top: `${geometry.viewportY}px`,
      width: `${geometry.viewportWidth}px`,
      height: `${geometry.viewportHeight}px`
    })
  }

  private navigateMinimap(event: PointerEvent): void {
    const content = this.content
    if (!content) return
    const scale = this.fitScale() * this.view.zoom
    const geometry = this.minimapGeometry(content.size, scale)
    const rect = this.minimap.getBoundingClientRect()
    const x = clamp(
      (event.clientX - rect.left - geometry.offsetX) / geometry.mapScale + geometry.left,
      geometry.left,
      geometry.right
    )
    const y = clamp(
      (event.clientY - rect.top - geometry.offsetY) / geometry.mapScale + geometry.top,
      geometry.top,
      geometry.bottom
    )
    this.setView({
      ...this.view,
      x: (content.size.width / 2 - x) * scale,
      y: (content.size.height / 2 - y) * scale
    })
  }

  // -- export --------------------------------------------------------------

  /**
   * Reviewing an architecture diagram usually ends in "how was this drawn" —
   * the definition is right there on the container, so show it rather than
   * making the reader hunt for the fence in the source file.
   */
  private toggleSource(): void {
    this.sourcePanel.hidden = !this.sourcePanel.hidden
    this.sourceButton.classList.toggle('markdown-vista-viewer__btn--active', !this.sourcePanel.hidden)
  }

  private async copySource(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.content?.source ?? '')
      this.showToast('Diagram source copied.')
    } catch {
      this.showToast('Could not copy the source.')
    }
  }

  /**
   * SVG keeps the diagram editable and sharp at any size; PNG is for pasting
   * into things that cannot take vectors.
   */
  private async exportSvg(): Promise<void> {
    const content = this.content
    if (!content || content.kind !== 'svg') return

    const markup = content.markup.includes('xmlns=')
      ? content.markup
      : content.markup.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"')
    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${markup}`], {
      type: 'image/svg+xml'
    })
    const fileName = exportFileName(content.name, this.index + 1).replace(/\.png$/, '.svg')

    triggerDownload(blob, fileName)
    this.showToast(`Saving ${fileName}… If no dialog appeared:`, {
      label: 'Copy to clipboard',
      run: async () => {
        await navigator.clipboard.writeText(markup)
        this.showToast('SVG markup copied.')
      }
    })
  }

  private async exportPng(): Promise<void> {
    const content = this.content
    if (!content || !content.exportable) return

    this.exportButton.disabled = true
    try {
      const blob = await toPngBlob(content)
      const fileName = exportFileName(content.name, this.index + 1)
      const mode = this.config.pngExport

      if (mode === 'clipboard') {
        await copyToClipboard(blob)
        this.showToast('PNG copied to the clipboard.')
        return
      }

      triggerDownload(blob, fileName)
      if (mode === 'download') {
        this.showToast(`Saving ${fileName}…`)
        return
      }
      // `auto`: a download blocked by the preview's security policy fails
      // silently, so always offer the clipboard as a one-click fallback.
      this.showToast(`Saving ${fileName}… If no dialog appeared:`, {
        label: 'Copy to clipboard',
        run: async () => {
          await copyToClipboard(blob)
          this.showToast('PNG copied to the clipboard.')
        }
      })
    } catch (error) {
      this.showToast(error instanceof Error ? error.message : 'Could not export the graphic.')
    } finally {
      this.exportButton.disabled = false
    }
  }

  private showToast(message: string, action?: { label: string; run: () => Promise<void> }): void {
    this.toast.replaceChildren(document.createTextNode(message))
    if (action) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'markdown-vista-viewer__toast-action'
      button.innerHTML = `${ICONS.copy}<span>${action.label}</span>`
      button.addEventListener('click', () => {
        void action.run().catch((error: unknown) => {
          this.showToast(error instanceof Error ? error.message : 'Could not copy the PNG.')
        })
      })
      this.toast.append(button)
    }
    this.toast.hidden = false
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => this.hideToast(), action ? 10_000 : 4_000)
  }

  private hideToast(): void {
    this.toast.hidden = true
    this.toast.replaceChildren()
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer)
    this.toastTimer = null
  }
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

async function copyToClipboard(blob: Blob): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    throw new Error('The clipboard is not available in this preview.')
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

let viewer: Viewer | null = null

/** Opens the zoom viewer on `node`, creating the overlay on first use. */
export function openViewer(node: HTMLElement): void {
  viewer ??= new Viewer()
  viewer.open(node)
}
