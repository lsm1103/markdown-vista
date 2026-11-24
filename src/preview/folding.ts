import { collectHeadings, type Heading } from './headings'
import { readConfig } from './config'

const CONTROL_CLASS = 'markdown-vista-fold-section'
const FOLDED_CLASS = 'markdown-vista-section-folded'
const HIDDEN_CLASS = 'markdown-vista-folded-away'

/**
 * Sections the reader folded away, by heading key.
 *
 * Deliberately *not* shared with the drawer's collapsed branches, even though
 * both are "collapse a section". Collapsing a branch of the outline is how you
 * navigate a long document; if that also hid the text, the outline would become
 * dangerous to touch.
 */
const folded = new Set<string>()

/** Elements belonging to a section: everything up to the next heading of equal
 *  or higher rank. */
function sectionBody(heading: Heading): HTMLElement[] {
  const body: HTMLElement[] = []
  let node = heading.element.nextElementSibling

  while (node) {
    const tag = node.tagName.toLowerCase()
    if (/^h[1-6]$/.test(tag) && Number(tag[1]) <= heading.level) break
    if (node instanceof HTMLElement) body.push(node)
    node = node.nextElementSibling
  }
  return body
}

function apply(headings: Heading[]): void {
  for (const element of Array.from(document.querySelectorAll<HTMLElement>(`.${HIDDEN_CLASS}`))) {
    element.classList.remove(HIDDEN_CLASS)
  }

  for (const heading of headings) {
    const isFolded = folded.has(heading.key)
    heading.element.classList.toggle(FOLDED_CLASS, isFolded)
    const control = heading.element.querySelector<HTMLElement>(`.${CONTROL_CLASS}`)
    if (control) {
      control.title = isFolded ? 'Expand section' : 'Collapse section'
      control.setAttribute('aria-expanded', String(!isFolded))
    }
    if (!isFolded) continue
    for (const element of sectionBody(heading)) element.classList.add(HIDDEN_CLASS)
  }
}

let headings: Heading[] = []

document.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const control = target.closest<HTMLElement>(`.${CONTROL_CLASS}`)
  if (!control) return

  event.preventDefault()
  event.stopPropagation()
  const key = control.dataset.key ?? ''
  if (folded.has(key)) folded.delete(key)
  else folded.add(key)
  apply(headings)
})

/**
 * Puts a fold control on every heading.
 *
 * A 40-section design document is read one part at a time; being able to close
 * the parts that are not the question at hand is the difference between reading
 * it and scrolling through it.
 */
export function syncFolding(): void {
  if (!readConfig().sectionFoldingEnabled) {
    for (const element of Array.from(document.querySelectorAll<HTMLElement>(`.${HIDDEN_CLASS}`))) {
      element.classList.remove(HIDDEN_CLASS)
    }
    return
  }

  headings = collectHeadings()
  const live = new Set(headings.map((heading) => heading.key))
  for (const key of Array.from(folded)) if (!live.has(key)) folded.delete(key)

  for (const heading of headings) {
    if (heading.element.querySelector(`.${CONTROL_CLASS}`)) continue
    const control = document.createElement('button')
    control.type = 'button'
    control.className = CONTROL_CLASS
    control.dataset.key = heading.key
    control.title = 'Collapse section'
    control.setAttribute('aria-label', `Collapse ${heading.text}`)
    heading.element.prepend(control)
  }

  apply(headings)
}
