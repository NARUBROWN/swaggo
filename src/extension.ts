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

  const completionItems = [
    "Summary",
    "Description",
    "ID",
    "Tags",
    "Accept",
    "Produce",
    "Schemes",
    "Security",
    "Deprecated",
    "Param",
    "Header",
    "Success",
    "Failure",
    "Router"
  ];

  const getAnnotationPrefixRange = (
    document: vscode.TextDocument,
    position: vscode.Position
  ) => {
    const lineText = document.lineAt(position.line).text;
    const beforeCursor = lineText.slice(0, position.character);
    const lastAt = beforeCursor.lastIndexOf("@");
    const lastHash = beforeCursor.lastIndexOf("#");
    const prefixIndex = Math.max(lastAt, lastHash);
    if (prefixIndex < 0) {
      return undefined;
    }
    const typed = beforeCursor.slice(prefixIndex + 1);
    if (!/^\w*$/.test(typed)) {
      return undefined;
    }
    return new vscode.Range(
      new vscode.Position(position.line, prefixIndex + 1),
      position
    );
  };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      "go",
      {
        provideCompletionItems(document, position) {
          const range = getAnnotationPrefixRange(document, position);
          if (!range) {
            return undefined;
          }

          return completionItems.map((entry) => {
            const item = new vscode.CompletionItem(
              entry,
              vscode.CompletionItemKind.Keyword
            );
            item.insertText = entry;
            item.range = range;
            item.detail = "@ annotation";
            item.filterText = entry;
            return item;
          });
        }
      },
      "@",
      "#"
    )
  );

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

      const lineNumbers = new Map<number, number>();
      for (const change of event.contentChanges) {
        if (!/\r\n|\r|\n/.test(change.text)) {
          continue;
        }
        const startLine = change.range.start.line;
        if (!lineNumbers.has(startLine)) {
          lineNumbers.set(startLine, change.range.start.character);
        }
      }

      for (const [lineNumber, cursorCharacter] of lineNumbers) {
        if (lineNumber < 0 || lineNumber >= event.document.lineCount) {
          continue;
        }
        await processor.processLine(event.document, lineNumber, cursorCharacter);
      }
    })
  );
}

export function deactivate() {}
