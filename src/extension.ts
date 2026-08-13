import * as vscode from 'vscode'
import type MarkdownIt from 'markdown-it'
import { applyMarkdownVistaPlugins } from './markdown-plugins'

/**
 * The extension host side is deliberately tiny: everything it does is hand a
 * configured markdown-it instance back to VS Code's built-in preview. Rendering,
 * scroll sync, theming, the outline and the security policy all stay owned by
 * the built-in preview.
 */
export function activate(context: vscode.ExtensionContext): unknown {
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('markdownVista')) return
      // Repaints open previews so viewer/mermaid settings take effect at once.
      // Toggling `extendedSyntax.enabled` still needs a window reload, because
      // markdown-it plugins can only be registered when the engine is created.
      void Promise.resolve(vscode.commands.executeCommand('markdown.preview.refresh')).then(
        undefined,
        () => undefined
      )
    })
  )

  return {
    extendMarkdownIt(md: MarkdownIt): MarkdownIt {
      return applyMarkdownVistaPlugins(md, () => vscode.workspace.getConfiguration('markdownVista'))
    }
  }
}

export function deactivate(): void {
  /* nothing to tear down */
}
