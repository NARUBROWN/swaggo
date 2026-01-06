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

  const getActiveCursorCharacter = (
    editor: vscode.TextEditor,
    lineNumber: number
  ) => {
    const active = editor.selection.active;
    if (active.line !== lineNumber) {
      return undefined;
    }
    return active.character;
  };

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
        const cursorCharacter = getActiveCursorCharacter(editor, lineNumber);
        await processor.processLine(event.document, lineNumber, cursorCharacter);
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(async (event) => {
      const editor = event.textEditor;
      if (editor.document.languageId !== "go") {
        return;
      }
      if (isApplyingEdit) {
        return;
      }
      const lineNumber = editor.selection.active.line;
      if (lineNumber < 0 || lineNumber >= editor.document.lineCount) {
        return;
      }
      await processor.processLine(
        editor.document,
        lineNumber,
        editor.selection.active.character
      );
    })
  );
}

export function deactivate() {}
