import * as vscode from 'vscode'
import { diagnosticPrompt, selectionPrompt } from './editor-prompts'

const SEVERITIES = ['error', 'warning', 'information', 'hint']

/** A range ending at column 0 does not include that last line. */
const lastLine = (range: vscode.Range) => range.end.line + (range.end.character === 0 && !range.isEmpty ? 0 : 1)

/** Draft text quoting the active selection, or undefined when nothing is selected. */
export function selectionDraft(): string | undefined {
  const editor = vscode.window.activeTextEditor
  const selection = editor?.selection
  if (!editor || !selection || selection.isEmpty) return undefined
  return selectionPrompt({
    path: vscode.workspace.asRelativePath(editor.document.uri, false),
    startLine: selection.start.line + 1,
    endLine: lastLine(selection),
    languageId: editor.document.languageId,
    text: editor.document.getText(selection),
  })
}

export const FIX_DIAGNOSTIC_COMMAND = 'apex.fixDiagnostic'

/** Offers "Fix with Apex" for diagnostics under the cursor; running it inserts a draft prompt and never sends. */
export class DiagnosticActions implements vscode.CodeActionProvider {
  provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    return context.diagnostics.map(diagnostic => {
      const action = new vscode.CodeAction('Fix with Apex', vscode.CodeActionKind.QuickFix)
      action.diagnostics = [diagnostic]
      action.command = {
        command: FIX_DIAGNOSTIC_COMMAND,
        title: 'Fix with Apex',
        arguments: [diagnosticPrompt({
          path: vscode.workspace.asRelativePath(document.uri, false),
          startLine: diagnostic.range.start.line + 1,
          endLine: lastLine(diagnostic.range),
          severity: SEVERITIES[diagnostic.severity] ?? 'problem',
          source: diagnostic.source,
          code: typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code,
          message: diagnostic.message,
          lineText: document.lineAt(Math.min(diagnostic.range.start.line, document.lineCount - 1)).text,
        })],
      }
      return action
    })
  }
}
