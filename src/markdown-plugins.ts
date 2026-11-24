import type MarkdownIt from 'markdown-it'
import sub from 'markdown-it-sub'
import sup from 'markdown-it-sup'
import ins from 'markdown-it-ins'
import mark from 'markdown-it-mark'
import footnote from 'markdown-it-footnote'
import deflist from 'markdown-it-deflist'
import abbr from 'markdown-it-abbr'
import { full as emoji } from 'markdown-it-emoji'

/** Minimal shape of `vscode.WorkspaceConfiguration` we depend on. */
export interface ConfigLike {
  get<T>(section: string, defaultValue: T): T
}

/** Settings the preview script needs; serialized into the rendered HTML. */
export interface PreviewConfig {
  viewerEnabled: boolean
  includeImages: boolean
  includeMath: boolean
  minimap: boolean
  mermaidEnabled: boolean
  pngExport: 'auto' | 'download' | 'clipboard' | 'off'
  tocEnabled: boolean
  tocOpenByDefault: boolean
  tocMaxLevel: number
  tocJumpStrategy: 'guard' | 'anchor'
  mermaidErrorDetails: boolean
  codeCopyButton: boolean
  codeFoldOver: number
  readingMaxWidth: number
  breadcrumbEnabled: boolean
  sectionFoldingEnabled: boolean
}

export const CONFIG_ELEMENT_ID = 'markdown-vista-config'
export const MERMAID_CANDIDATE_CLASS = 'mermaid-diagram-candidate'
/** Matches `《some-design.md》`; the capture group is the path to link to. */
export const DEFAULT_DOC_LINK_PATTERN = '《([^》]+?\\.md)》'

function readPreviewConfig(config: ConfigLike): PreviewConfig {
  return {
    viewerEnabled: config.get('viewer.enabled', true),
    includeImages: config.get('viewer.includeImages', true),
    includeMath: config.get('viewer.includeMath', true),
    minimap: config.get('viewer.minimap', true),
    mermaidEnabled: config.get('mermaid.enabled', true),
    pngExport: config.get<PreviewConfig['pngExport']>('viewer.pngExport', 'auto'),
    tocEnabled: config.get('toc.enabled', true),
    tocOpenByDefault: config.get('toc.openByDefault', false),
    tocMaxLevel: config.get('toc.maxLevel', 6),
    tocJumpStrategy: config.get<PreviewConfig['tocJumpStrategy']>('toc.jumpStrategy', 'guard'),
    mermaidErrorDetails: config.get('mermaid.errorDetails', true),
    codeCopyButton: config.get('code.copyButton', true),
    codeFoldOver: config.get('code.foldOver', 60),
    readingMaxWidth: config.get('reading.maxWidth', 0),
    breadcrumbEnabled: config.get('breadcrumb.enabled', true),
    sectionFoldingEnabled: config.get('sectionFolding.enabled', true)
  }
}

/**
 * Replaces ```mermaid fences with an inert, escaped placeholder. The actual
 * diagram is rendered client-side by `media/preview.js`, because
 * `extendMarkdownIt` is synchronous and Mermaid's layout engine is not.
 *
 * `code-line` + `data-line` are what the built-in preview uses for scroll sync,
 * so they are carried over to keep a Mermaid block in sync with the editor.
 */
function installMermaidFence(md: MarkdownIt, getConfig: () => ConfigLike): void {
  const defaultFence = md.renderer.rules.fence

  md.renderer.rules.fence = (tokens, index, options, env, self): string => {
    const token = tokens[index]
    const language = token.info.trim().split(/\s+/g)[0]?.toLowerCase()

    if (language !== 'mermaid' || !readPreviewConfig(getConfig()).mermaidEnabled) {
      return defaultFence
        ? defaultFence(tokens, index, options, env, self)
        : self.renderToken(tokens, index, options)
    }

    const line = token.map?.[0]
    const classes = [MERMAID_CANDIDATE_CLASS]
    if (line !== undefined) classes.push('code-line')
    const lineAttribute = line === undefined ? '' : ` data-line="${line}"`

    return (
      `<pre class="${classes.join(' ')}"${lineAttribute}>` +
      `<code>${md.utils.escapeHtml(token.content)}</code>` +
      `</pre>\n`
    )
  }
}

/**
 * Turns a plain-text reference to another Markdown file into a link.
 *
 * Teams settle on a convention for citing sibling documents — `《design.md》`
 * here — and those references stay dead text in every renderer. Resolving them
 * is what turns a folder of documents into something navigable.
 */
function installDocumentLinks(md: MarkdownIt, getConfig: () => ConfigLike): void {
  // Before `linkify`, which would otherwise see `design.md` as a bare domain
  // and turn the reference into a link to a website that does not exist.
  md.core.ruler.before('linkify', 'markdown_vista_doc_links', (state) => {
    const config = getConfig()
    if (!config.get('docLinks.enabled', true)) return

    let pattern: RegExp
    try {
      pattern = new RegExp(config.get('docLinks.pattern', DEFAULT_DOC_LINK_PATTERN), 'g')
    } catch {
      return // an invalid user pattern must not break rendering
    }

    for (const token of state.tokens) {
      if (token.type !== 'inline' || !token.children) continue

      const rewritten: typeof token.children = []
      let insideLink = 0
      let changed = false

      for (const child of token.children) {
        if (child.type === 'link_open') insideLink++
        if (child.type === 'link_close') insideLink--
        // Never rewrite inside an existing link, and code spans are their own
        // token type, so they are never touched either.
        if (child.type !== 'text' || insideLink > 0) {
          rewritten.push(child)
          continue
        }

        pattern.lastIndex = 0
        let cursor = 0
        let match: RegExpExecArray | null

        while ((match = pattern.exec(child.content)) !== null) {
          if (match[0].length === 0) break // a pattern matching nothing would loop
          const target = match[1] ?? match[0]
          if (!target) break
          changed = true

          if (match.index > cursor) {
            const before = new state.Token('text', '', 0)
            before.content = child.content.slice(cursor, match.index)
            rewritten.push(before)
          }

          const open = new state.Token('link_open', 'a', 1)
          open.attrSet('href', encodeURI(target))
          open.attrSet('class', 'markdown-vista-doc-link')
          open.attrSet('title', target)
          const text = new state.Token('text', '', 0)
          text.content = match[0]
          rewritten.push(open, text, new state.Token('link_close', 'a', -1))

          cursor = match.index + match[0].length
        }

        if (cursor === 0) rewritten.push(child)
        else if (cursor < child.content.length) {
          const rest = new state.Token('text', '', 0)
          rest.content = child.content.slice(cursor)
          rewritten.push(rest)
        }
      }

      if (changed) token.children = rewritten
    }
  })
}

/**
 * The preview script cannot read VS Code settings (it has no API bridge — the
 * built-in preview already consumed `acquireVsCodeApi()`), so the current
 * settings ride along inside the rendered HTML as a data attribute.
 */
function installConfigBridge(md: MarkdownIt, getConfig: () => ConfigLike): void {
  const originalRender = md.render.bind(md)

  md.render = (source: string, env?: unknown): string => {
    const payload = md.utils.escapeHtml(JSON.stringify(readPreviewConfig(getConfig())))
    return (
      `<div id="${CONFIG_ELEMENT_ID}" data-markdown-vista-config="${payload}" aria-hidden="true"></div>\n` +
      originalRender(source, env)
    )
  }
}

/**
 * Adds only what VS Code's built-in preview does *not* already provide.
 * Deliberately absent: math (built in since 1.72), task lists, heading anchors,
 * syntax highlighting and link/image path rewriting.
 */
export function applyMarkdownVistaPlugins(md: MarkdownIt, getConfig: () => ConfigLike): MarkdownIt {
  if (getConfig().get('extendedSyntax.enabled', true)) {
    md.use(sub)
      .use(sup)
      .use(ins)
      .use(mark)
      .use(footnote)
      .use(deflist)
      .use(abbr)
      .use(emoji)
  }

  installMermaidFence(md, getConfig)
  installDocumentLinks(md, getConfig)
  installConfigBridge(md, getConfig)
  return md
}
