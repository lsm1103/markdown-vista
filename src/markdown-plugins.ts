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
}

export const CONFIG_ELEMENT_ID = 'markdown-vista-config'
export const MERMAID_CANDIDATE_CLASS = 'mermaid-diagram-candidate'

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
    tocMaxLevel: config.get('toc.maxLevel', 6)
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
  installConfigBridge(md, getConfig)
  return md
}
