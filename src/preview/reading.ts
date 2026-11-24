import { readConfig } from './config'

/**
 * Caps the width of body text.
 *
 * A preview pane stretched across a wide monitor gives 150-character lines,
 * which is well past what is comfortable to read. Code blocks, tables and
 * diagrams are exempt — those are read by scanning, not by line, and clipping
 * them would hurt.
 */
export function syncReadingWidth(): void {
  const width = readConfig().readingMaxWidth
  const root = document.documentElement

  if (width > 0) {
    root.style.setProperty('--markdown-vista-reading-width', `${width}px`)
    document.body.classList.add('markdown-vista-reading')
  } else {
    root.style.removeProperty('--markdown-vista-reading-width')
    document.body.classList.remove('markdown-vista-reading')
  }
}
