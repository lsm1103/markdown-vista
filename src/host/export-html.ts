import * as vscode from 'vscode'
import { basename, dirname, extname, resolve as resolvePath } from 'node:path'

const RENDER_TIMEOUT_MS = 30_000

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif'
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) =>
    character === '&' ? '&amp;' : character === '<' ? '&lt;' : character === '>' ? '&gt;' : '&quot;'
  )
}

/** Renders through the built-in engine, so contributed plugins — ours included — apply. */
async function renderMarkdown(document: vscode.TextDocument): Promise<string> {
  const rendered = await vscode.commands.executeCommand<string | { html?: string }>(
    'markdown.api.render',
    document
  )
  const html = typeof rendered === 'string' ? rendered : rendered?.html
  if (!html) throw new Error('The built-in Markdown renderer returned nothing.')
  return html
}

/**
 * Replaces local image sources with data URIs. An exported file is meant to be
 * mailed or dropped in a wiki, where a relative path resolves to nothing.
 */
async function inlineImages(html: string, documentPath: string): Promise<string> {
  const base = dirname(documentPath)
  const sources = new Map<string, string>()

  for (const match of html.matchAll(/<img\b[^>]*?\ssrc=["']([^"']+)["']/gi)) {
    const source = match[1]
    if (!source || sources.has(source)) continue
    if (/^(https?:|data:)/i.test(source)) continue

    const path = source.startsWith('file://')
      ? vscode.Uri.parse(source).fsPath
      : resolvePath(base, decodeURIComponent(source.replace(/[?#].*$/, '')))
    const mime = IMAGE_MIME[extname(path).toLowerCase()]
    if (!mime) continue

    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(path))
      sources.set(source, `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`)
    } catch {
      /* a missing image stays a broken link, exactly as it renders today */
    }
  }

  let result = html
  for (const [source, dataUri] of sources) {
    result = result.split(`"${source}"`).join(`"${dataUri}"`).split(`'${source}'`).join(`'${dataUri}'`)
  }
  return result
}

/** Drives the hidden-ish webview that turns Mermaid sources into SVG. */
function renderInWebview(
  context: vscode.ExtensionContext,
  bodyHtml: string
): Promise<{ html: string; error: string | null }> {
  const panel = vscode.window.createWebviewPanel(
    'markdownVistaExport',
    'Rendering diagrams…',
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
    }
  )

  const media = (name: string): vscode.Uri =>
    panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', name))
  const nonce = Buffer.from(String(Math.floor(Math.random() * 1e16))).toString('base64')

  panel.webview.html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} data: https:; style-src ${panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${panel.webview.cspSource}; font-src ${panel.webview.cspSource} data:;" />
<link rel="stylesheet" href="${media('preview.css')}" />
</head>
<body class="vscode-light">
${bodyHtml}
<script nonce="${nonce}" src="${media('export-runner.js')}"></script>
</body>
</html>`

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      panel.dispose()
      reject(new Error('Timed out while rendering diagrams.'))
    }, RENDER_TIMEOUT_MS)

    panel.webview.onDidReceiveMessage((message: { type?: string; html?: string; error?: string }) => {
      if (message?.type !== 'markdown-vista-export') return
      clearTimeout(timer)
      panel.dispose()
      resolve({ html: message.html ?? '', error: message.error ?? null })
    })

    panel.onDidDispose(() => {
      clearTimeout(timer)
      reject(new Error('The render window was closed before the export finished.'))
    })
  })
}

function buildDocument(title: string, styles: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
${styles}
</style>
</head>
<body class="markdown-vista-export">
<article class="markdown-body">
${body}
</article>
</body>
</html>
`
}

async function readMedia(context: vscode.ExtensionContext, name: string): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'media', name))
  return Buffer.from(bytes).toString('utf8')
}

export function registerExportHtml(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('markdownVista.exportHtml', async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor || editor.document.languageId !== 'markdown') {
        void vscode.window.showWarningMessage('Open a Markdown file to export it.')
        return
      }
      const document = editor.document

      const target = await vscode.window.showSaveDialog({
        filters: { HTML: ['html'] },
        saveLabel: 'Export',
        defaultUri: vscode.Uri.file(document.uri.fsPath.replace(/\.md$/i, '') + '.html')
      })
      if (!target) return

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Exporting to HTML' },
        async (progress) => {
          try {
            progress.report({ message: 'rendering Markdown…' })
            const rendered = await renderMarkdown(document)

            progress.report({ message: 'rendering diagrams…' })
            const { html, error } = await renderInWebview(context, rendered)

            progress.report({ message: 'inlining images…' })
            const withImages = await inlineImages(html, document.uri.fsPath)

            const styles = [await readMedia(context, 'export.css'), await readMedia(context, 'preview.css')].join(
              '\n'
            )
            const title = basename(document.uri.fsPath).replace(/\.md$/i, '')
            const page = buildDocument(title, styles, withImages)

            await vscode.workspace.fs.writeFile(target, Buffer.from(page, 'utf8'))

            const open = 'Open'
            const message = error
              ? `Exported with a diagram problem: ${error}`
              : `Exported to ${basename(target.fsPath)}.`
            const choice = await vscode.window.showInformationMessage(message, open)
            if (choice === open) void vscode.env.openExternal(target)
          } catch (failure) {
            void vscode.window.showErrorMessage(
              `Export failed: ${failure instanceof Error ? failure.message : String(failure)}`
            )
          }
        }
      )
    })
  )
}
