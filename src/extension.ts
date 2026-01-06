import * as vscode from "vscode";
import { AnnotationProcessor } from "./annotationProcessor";

export function activate(context: vscode.ExtensionContext) {
  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("go-swagger-genie");
  context.subscriptions.push(diagnosticCollection);

  let isApplyingEdit = false;
  const applyEdit = async (edit: vscode.WorkspaceEdit) => {
    if (isApplyingEdit) {
      return false;
    }
    isApplyingEdit = true;
    try {
      return await vscode.workspace.applyEdit(edit);
    } finally {
      isApplyingEdit = false;
    }
  };

  const processor = new AnnotationProcessor(diagnosticCollection, applyEdit);

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(async (event) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document !== event.document) {
        return;
      }
      if (event.document.languageId !== "go") {
        return;
      }
      if (isApplyingEdit) {
        return;
      }

      const lineNumbers = new Set<number>();
      for (const change of event.contentChanges) {
        const startLine = change.range.start.line;
        const newlineCount = change.text.split(/\r\n|\r|\n/).length - 1;
        const endLine = startLine + newlineCount;

        lineNumbers.add(startLine);
        lineNumbers.add(endLine);
        if (startLine > 0) {
          lineNumbers.add(startLine - 1);
        }
      }

      for (const lineNumber of lineNumbers) {
        if (lineNumber < 0 || lineNumber >= event.document.lineCount) {
          continue;
        }
        await processor.processLine(event.document, lineNumber);
      }
    })
  );
}

export function deactivate() {}
