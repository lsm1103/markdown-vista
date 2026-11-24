import { documentHeadings, plainText } from './headings'

export const BEGIN = '<!-- markdown-vista-toc -->'
export const END = '<!-- /markdown-vista-toc -->'

/**
 * A table of contents written into the document itself, for the renderers that
 * do not have this extension — GitHub, a wiki, a review tool.
 *
 * The markers make it idempotent: running the command again replaces the block
 * in place instead of stacking another copy.
 */
export function buildToc(text: string, maxLevel: number, minLevel: number): string {
  const headings = documentHeadings(text, maxLevel).filter((heading) => heading.level >= minLevel)
  if (!headings.length) return `${BEGIN}\n${END}`

  const top = Math.min(...headings.map((heading) => heading.level))
  const lines = headings.map((heading) => {
    const indent = '  '.repeat(heading.level - top)
    const label = plainText(heading.text).replace(/[[\]]/g, '\\$&')
    return `${indent}- [${label}](#${heading.slug})`
  })

  return [BEGIN, ...lines, END].join('\n')
}

