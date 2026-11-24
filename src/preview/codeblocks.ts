import { ICONS } from './icons'
import { readConfig } from './config'

const PROCESSED = 'data-markdown-vista-code'
const COPIED_MS = 1600

/**
 * A technical document is mostly code blocks, and the built-in preview offers
 * no way to copy one. Long ones also bury the prose between them, so anything
 * past a threshold folds away until asked for.
 */
function enhance(pre: HTMLElement, copyButton: boolean, foldOver: number): void {
  const code = pre.querySelector(':scope > code')
  if (!code) return

  pre.setAttribute(PROCESSED, 'true')

  const wrapper = document.createElement('div')
  wrapper.className = 'markdown-vista-code'
  // The fence carries the preview's scroll-sync hooks; the wrapper takes over
  // its position in the document, so it has to carry them too.
  if (pre.classList.contains('code-line')) wrapper.classList.add('code-line')
  const line = pre.getAttribute('data-line')
  if (line !== null) wrapper.setAttribute('data-line', line)

  pre.before(wrapper)
  wrapper.append(pre)

  if (copyButton) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'markdown-vista-code__button markdown-vista-code__copy'
    button.title = 'Copy'
    button.setAttribute('aria-label', 'Copy code')
    button.innerHTML = ICONS.copy
    wrapper.append(button)
  }

  const lines = (code.textContent ?? '').replace(/\n$/, '').split('\n').length
  if (foldOver > 0 && lines > foldOver) {
    wrapper.classList.add('markdown-vista-code--folded')
    const fold = document.createElement('button')
    fold.type = 'button'
    fold.className = 'markdown-vista-fold'
    fold.dataset.lines = String(lines)
    fold.textContent = `Show all ${lines} lines`
    wrapper.append(fold)
  }
}

async function copy(button: HTMLElement): Promise<void> {
  const code = button.closest('.markdown-vista-code')?.querySelector('code')?.textContent ?? ''
  const done = (label: string): void => {
    button.classList.add('markdown-vista-code__copy--done')
    button.title = label
    window.setTimeout(() => {
      button.classList.remove('markdown-vista-code__copy--done')
      button.title = 'Copy'
    }, COPIED_MS)
  }

  try {
    await navigator.clipboard.writeText(code)
    done('Copied')
  } catch {
    button.title = 'Could not copy'
  }
}

function toggleFold(fold: HTMLElement): void {
  const wrapper = fold.closest('.markdown-vista-code')
  if (!wrapper) return
  const folded = wrapper.classList.toggle('markdown-vista-code--folded')
  fold.textContent = folded ? `Show all ${fold.dataset.lines} lines` : 'Collapse'
}

document.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return

  const copyButton = target.closest<HTMLElement>('.markdown-vista-code__copy')
  if (copyButton) {
    event.preventDefault()
    event.stopPropagation()
    void copy(copyButton)
    return
  }

  const fold = target.closest<HTMLElement>('.markdown-vista-fold')
  if (fold) {
    event.preventDefault()
    event.stopPropagation()
    toggleFold(fold)
  }
})

/** Adds the copy button and fold control to every new code block. */
export function syncCodeBlocks(): void {
  const config = readConfig()
  if (!config.codeCopyButton && config.codeFoldOver <= 0) return

  const blocks = Array.from(
    document.querySelectorAll<HTMLElement>(`pre:not([${PROCESSED}])`)
  ).filter(
    (pre) =>
      // Mermaid fences are diagrams, not code to copy, and our own UI is not
      // document content.
      !pre.classList.contains('mermaid-diagram-candidate') &&
      !pre.closest('.markdown-vista-toc, .markdown-vista-viewer')
  )

  for (const pre of blocks) enhance(pre, config.codeCopyButton, config.codeFoldOver)
}
