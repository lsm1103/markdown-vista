import type { PreviewConfig } from '../markdown-plugins'

const DEFAULTS: PreviewConfig = {
  viewerEnabled: true,
  includeImages: true,
  includeMath: true,
  minimap: true,
  mermaidEnabled: true,
  pngExport: 'auto',
  tocEnabled: true,
  tocOpenByDefault: false,
  tocMaxLevel: 6
}

/**
 * Settings are injected into the rendered HTML by the extension host, because a
 * `markdown.previewScripts` script has no API bridge back to the extension.
 */
export function readConfig(): PreviewConfig {
  const raw = document
    .getElementById('markdown-vista-config')
    ?.getAttribute('data-markdown-vista-config')
  if (!raw) return DEFAULTS
  try {
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PreviewConfig>) }
  } catch {
    return DEFAULTS
  }
}

export type { PreviewConfig }
