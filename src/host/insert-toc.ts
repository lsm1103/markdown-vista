import * as vscode from 'vscode'
import { BEGIN, END, buildToc } from './toc-markdown'

/** Replaces an existing block, otherwise reports where a new one should go. */
function findExistingBlock(document: vscode.TextDocument): vscode.Range | null {
  const text = document.getText()
  const start = text.indexOf(BEGIN)
  if (start < 0) return null
  const end = text.indexOf(END, start)
  if (end < 0) return null
  return new vscode.Range(document.positionAt(start), document.positionAt(end + END.length))
}

export function registerInsertToc(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('markdownVista.insertToc', async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor || editor.document.languageId !== 'markdown') {
        void vscode.window.showWarningMessage('Open a Markdown file to insert a table of contents.')
        return
      }

      const config = vscode.workspace.getConfiguration('markdownVista')
      const toc = buildToc(editor.document.getText(), config.get('toc.maxLevel', 6), 2)
      const existing = findExistingBlock(editor.document)

      await editor.edit((edit) => {
        if (existing) edit.replace(existing, toc)
        else edit.insert(editor.selection.active, `${toc}\n`)
      })

      void vscode.window.setStatusBarMessage(
        existing ? 'Table of contents updated.' : 'Table of contents inserted.',
        3000
      )
    })
  )
}
