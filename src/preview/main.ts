import { readConfig } from './config'
import { refreshMermaidTheme, renderMermaidBlocks } from './mermaid'
import { collectGraphics, openViewer, OWN_UI_SELECTOR } from './viewer'
import { syncToc } from './toc'
import { syncBreadcrumb } from './breadcrumb'
import { syncCodeBlocks } from './codeblocks'
import { syncFolding } from './folding'
import { syncReadingWidth } from './reading'
import { diagnostics, guard } from './diagnostics'

const ZOOMABLE_CLASS = 'markdown-vista-zoomable'

let pending = false

/** Marks every zoomable graphic so CSS can show the affordance. */
function markZoomable(): void {
  const config = readConfig()
  for (const stale of Array.from(document.querySelectorAll<HTMLElement>(`.${ZOOMABLE_CLASS}`))) {
    stale.classList.remove(ZOOMABLE_CLASS)
  }
  if (!config.viewerEnabled) return
  for (const graphic of collectGraphics(config)) {
    if (graphic.closest('a')) continue
    graphic.classList.add(ZOOMABLE_CLASS)
  }
}

/** Coalesces bursts of mutations into one pass. */
const REFRESH_DEBOUNCE_MS = 16

function refresh(): void {
  if (pending) return
  pending = true
  // Deliberately NOT requestAnimationFrame: browsers do not run animation
  // frames for a hidden document, and a preview created in a background editor
  // group is hidden — the callback would never fire, leaving the document with
  // no diagrams and no table of contents until it happened to be focused.
  window.setTimeout(() => {
    pending = false
    diagnostics.refreshes++
    guard('mermaid', () => {
      void renderMermaidBlocks()
        .then(() => guard('zoomable', markZoomable))
        .catch((error: unknown) => guard('mermaid', () => { throw error }))
    })
    guard('zoomable', markZoomable)
    guard('code', syncCodeBlocks)
    guard('reading', syncReadingWidth)
    // The breadcrumb reserves space at the top, so it settles the layout before
    // anything measures a heading position.
    guard('breadcrumb', syncBreadcrumb)
    guard('folding', syncFolding)
    guard('toc', syncToc)
  }, REFRESH_DEBOUNCE_MS)
}

function graphicAt(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  // Clicks on our own chrome are never a request to zoom a graphic.
  if (target.closest(OWN_UI_SELECTOR)) return null
  const graphic = target.closest<HTMLElement>(`.${ZOOMABLE_CLASS}`)
  if (graphic) return graphic
  // The click may land on a child of a Mermaid SVG or inside a formula.
  const container = target.closest<HTMLElement>('.mermaid-diagram, .katex-display')
  if (!container) return null
  return container.querySelector<HTMLElement>(`.${ZOOMABLE_CLASS}`) ?? (container.classList.contains(ZOOMABLE_CLASS) ? container : null)
}

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0) return
  if (!readConfig().viewerEnabled) return
  // Leave text selection alone.
  if ((document.getSelection()?.toString().length ?? 0) > 0) return

  const graphic = graphicAt(event.target)
  if (!graphic) return
  event.preventDefault()
  event.stopPropagation()
  openViewer(graphic)
})

function start(): void {
  if (diagnostics.started) return
  diagnostics.started = true

  guard('observers', () => {
    // Fallback for VS Code builds that update the DOM without firing the event
    // below. Rendering is idempotent (processed nodes are marked), so re-entry
    // is safe.
    new MutationObserver(refresh).observe(document.body, { childList: true, subtree: true })

    // Re-render diagrams when the user switches color theme.
    new MutationObserver(() => {
      void refreshMermaidTheme()
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] })
  })

  refresh()
}

// The built-in preview fires this after it swaps in freshly rendered HTML.
window.addEventListener('vscode.markdown.updateContent', refresh)

// A webview that was hidden when it loaded may have been throttled; re-run once
// it becomes visible so nothing is left half-rendered.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh()
})

// The preview may load this script from <head>, where document.body does not
// exist yet; observing a null body would throw and kill the whole script.
// Both paths are registered because `DOMContentLoaded` has already fired when
// the script is injected late — `start()` is idempotent.
if (document.body) start()
document.addEventListener('DOMContentLoaded', start, { once: true })
window.addEventListener('load', start, { once: true })
