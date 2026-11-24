/**
 * Runs inside the short-lived webview the export command creates.
 *
 * Mermaid only exists as a browser renderer, so a self-contained export has to
 * go through a real DOM once. This is the one webview we own, so unlike the
 * built-in preview it *does* have a message channel back to the extension.
 */
import { renderMermaidBlocks } from './mermaid'

declare function acquireVsCodeApi(): { postMessage(message: unknown): void }

const api = acquireVsCodeApi()

async function run(): Promise<void> {
  let error: string | null = null
  try {
    await renderMermaidBlocks()
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure)
  }

  // Settings ride in the rendered HTML; they are of no use in an exported file.
  document.getElementById('markdown-vista-config')?.remove()

  api.postMessage({ type: 'markdown-vista-export', html: document.body.innerHTML, error })
}

void run()
