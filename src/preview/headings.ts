import { OWN_UI_SELECTOR } from './viewer'

export const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'

export interface Heading {
  element: HTMLElement
  key: string
  text: string
  level: number
}

export interface HeadingNode extends Heading {
  children: HeadingNode[]
}

/**
 * The headings of the rendered document, in order.
 *
 * The key is derived from level and text rather than from the element, so it
 * survives the preview replacing every node on each keystroke — which is what
 * lets collapsed branches and folded sections stay where the reader put them.
 */
export function collectHeadings(maxLevel = 6): Heading[] {
  const seen = new Map<string, number>()
  const headings: Heading[] = []

  for (const element of Array.from(document.querySelectorAll<HTMLElement>(HEADING_SELECTOR))) {
    if (element.closest(OWN_UI_SELECTOR)) continue
    const level = Number(element.tagName[1])
    if (level > maxLevel) continue
    const text = headingText(element)
    if (!text) continue

    const base = `${level}:${text}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    headings.push({ element, key: count ? `${base}#${count}` : base, text, level })
  }

  return headings
}

/** Heading text without the controls we inject into it. */
export function headingText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement
  for (const injected of Array.from(clone.querySelectorAll('.markdown-vista-fold-section'))) {
    injected.remove()
  }
  return (clone.textContent ?? '').trim()
}

/**
 * Nests a flat heading list by level. Works with skipped levels — an h3 that
 * follows an h1 becomes a child of that h1.
 */
export function nest(headings: Heading[]): HeadingNode[] {
  const roots: HeadingNode[] = []
  const stack: HeadingNode[] = []
  for (const heading of headings) {
    const node: HeadingNode = { ...heading, children: [] }
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop()
    if (stack.length) stack[stack.length - 1].children.push(node)
    else roots.push(node)
    stack.push(node)
  }
  return roots
}

/** Ancestor chain of a heading, outermost first, including the heading itself. */
export function headingPath(headings: Heading[], key: string): Heading[] {
  const index = headings.findIndex((heading) => heading.key === key)
  if (index < 0) return []

  const path: Heading[] = [headings[index]]
  let level = headings[index].level
  for (let cursor = index - 1; cursor >= 0 && level > 1; cursor--) {
    if (headings[cursor].level < level) {
      path.unshift(headings[cursor])
      level = headings[cursor].level
    }
  }
  return path
}
