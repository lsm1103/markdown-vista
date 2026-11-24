export interface DocumentHeading {
  level: number
  text: string
  slug: string
  line: number
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const ATX = /^(#{1,6})\s+(.*?)\s*#*\s*$/

/**
 * Mirrors the slug the built-in preview generates for a heading, so a generated
 * link actually resolves. VS Code lowercases, strips a fixed set of punctuation
 * and joins words with hyphens — non-ASCII characters are kept as they are,
 * which is what makes anchors work for Chinese headings.
 */
export function slugify(text: string): string {
  return encodeURI(
    text
      .trim()
      .toLowerCase()
      .replace(/[\][!/'"#$%&()*+,.:;<=>?@\\^_{|}~`]/g, '')
      .replace(/\s+/g, '-')
  )
}

/** ATX headings of a Markdown document, skipping anything inside a code fence. */
export function documentHeadings(text: string, maxLevel = 6): DocumentHeading[] {
  const headings: DocumentHeading[] = []
  const seen = new Map<string, number>()
  let fence: string | null = null

  text.split(/\r?\n/).forEach((line, index) => {
    const fenceMatch = FENCE.exec(line)
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0]
      else if (fenceMatch[1][0] === fence) fence = null
      return
    }
    if (fence !== null) return

    const match = ATX.exec(line)
    if (!match) return
    const level = match[1].length
    const heading = match[2].trim()
    if (!heading || level > maxLevel) return

    // Duplicate headings get the same `-1`, `-2` … suffixes the preview uses.
    const base = slugify(heading)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    headings.push({ level, text: heading, slug: count ? `${base}-${count}` : base, line: index })
  })

  return headings
}

/** Heading text with inline Markdown reduced to what a reader sees. */
export function plainText(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .trim()
}
