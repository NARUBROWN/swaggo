import * as vscode from "vscode";
import { AnnotationProcessor } from "./annotationProcessor";
import { SwaggerCommentRenderer } from "./swaggerCommentRenderer";

export function activate(context: vscode.ExtensionContext) {
  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("go-swagger-genie");
  context.subscriptions.push(diagnosticCollection);

  const annotationRenderer = new SwaggerCommentRenderer();
  const swaggerAnnotationDecoration =
    vscode.window.createTextEditorDecorationType({
      before: {
        color: new vscode.ThemeColor("editorGhostText.foreground")
      }
    });
  const swaggerCommentHiddenDecoration =
    vscode.window.createTextEditorDecorationType({
      color: "transparent"
    });
  context.subscriptions.push(
    swaggerAnnotationDecoration,
    swaggerCommentHiddenDecoration
  );

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

  const annotationLineRegex = /^\s*[@#][A-Za-z]\w*\(.*\)\s*$/;
  let activeAnnotationEdit: { uri: string; line: number } | undefined;

  const finalizeAnnotationEdit = async () => {
    if (!activeAnnotationEdit) {
      return;
    }
    if (isApplyingEdit) {
      return;
    }

    const document = vscode.workspace.textDocuments.find(
      (doc) => doc.uri.toString() === activeAnnotationEdit?.uri
    );
    if (!document) {
      activeAnnotationEdit = undefined;
      return;
    }

    if (
      activeAnnotationEdit.line < 0 ||
      activeAnnotationEdit.line >= document.lineCount
    ) {
      activeAnnotationEdit = undefined;
      return;
    }

    const line = document.lineAt(activeAnnotationEdit.line);
    if (annotationLineRegex.test(line.text)) {
      await processor.processLine(document, activeAnnotationEdit.line);
    }

    activeAnnotationEdit = undefined;
  };

  const openAnnotationEdit = async (
    editor: vscode.TextEditor,
    lineNumber: number
  ) => {
    if (isApplyingEdit) {
      return false;
    }
    const line = editor.document.lineAt(lineNumber);
    const annotationLine = annotationRenderer.toAnnotationLine(line.text);
    if (!annotationLine || annotationLine === line.text) {
      return false;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(editor.document.uri, line.range, annotationLine);
    const applied = await applyEdit(edit);
    if (applied) {
      activeAnnotationEdit = {
        uri: editor.document.uri.toString(),
        line: lineNumber
      };
    }

    return applied;
  };

  let lastDecoratedEditor: vscode.TextEditor | undefined;
  const clearDecorations = (editor: vscode.TextEditor) => {
    editor.setDecorations(swaggerAnnotationDecoration, []);
    editor.setDecorations(swaggerCommentHiddenDecoration, []);
  };

  const updateSwaggerRender = (editor?: vscode.TextEditor) => {
    if (lastDecoratedEditor && editor !== lastDecoratedEditor) {
      clearDecorations(lastDecoratedEditor);
    }

    if (!editor || editor.document.languageId !== "go") {
      if (editor) {
        clearDecorations(editor);
      }
      lastDecoratedEditor = editor;
      return;
    }

    const { annotationDecorations, hiddenRanges } =
      annotationRenderer.buildDecorations(editor.document);
    editor.setDecorations(swaggerAnnotationDecoration, annotationDecorations);
    editor.setDecorations(swaggerCommentHiddenDecoration, hiddenRanges);
    lastDecoratedEditor = editor;
  };

  const updateActiveAnnotationEdit = async (editor?: vscode.TextEditor) => {
    if (!editor || editor.document.languageId !== "go") {
      await finalizeAnnotationEdit();
      updateSwaggerRender(editor);
      return;
    }

    const activeLine = editor.selection.active.line;
    if (
      activeAnnotationEdit &&
      (activeAnnotationEdit.uri !== editor.document.uri.toString() ||
        activeAnnotationEdit.line !== activeLine)
    ) {
      await finalizeAnnotationEdit();
    }

    if (!activeAnnotationEdit) {
      await openAnnotationEdit(editor, activeLine);
    }

    updateSwaggerRender(editor);
  };

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

  const annotationAttributeMap: Record<string, string[]> = {
    summary: ["summary", "description", "desc", "value", "text"],
    description: ["description", "desc", "value", "text"],
    id: ["id", "value", "text"],
    param: ["name", "in", "type", "required", "description", "desc"],
    header: ["code", "type", "name", "description", "desc"],
    success: [
      "code",
      "type",
      "schema",
      "schematype",
      "typepath",
      "description",
      "desc",
      "message"
    ],
    failure: [
      "code",
      "type",
      "schema",
      "schematype",
      "typepath",
      "description",
      "desc",
      "message"
    ],
    router: ["path", "method"]
  };

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

  const getAnnotationArgContext = (
    document: vscode.TextDocument,
    position: vscode.Position
  ): { tag: string; range: vscode.Range } | undefined => {
    const lineText = document.lineAt(position.line).text;
    const beforeCursor = lineText.slice(0, position.character);
    const lastAt = beforeCursor.lastIndexOf("@");
    const lastHash = beforeCursor.lastIndexOf("#");
    const prefixIndex = Math.max(lastAt, lastHash);
    if (prefixIndex < 0) {
      return undefined;
    }

    const afterPrefix = lineText.slice(prefixIndex + 1);
    const nameMatch = afterPrefix.match(/^([A-Za-z]\w*)\s*\(/);
    if (!nameMatch) {
      return undefined;
    }

    const tag = nameMatch[1];
    const openParenIndex =
      prefixIndex + 1 + nameMatch[0].lastIndexOf("(");
    if (position.character <= openParenIndex) {
      return undefined;
    }

    const beforeArgs = lineText.slice(openParenIndex + 1, position.character);
    let inQuotes = false;
    let escaped = false;
    let segmentHasEquals = false;

    for (const ch of beforeArgs) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inQuotes = !inQuotes;
        continue;
      }
      if (inQuotes) {
        continue;
      }
      if (ch === ")") {
        return undefined;
      }
      if (ch === ",") {
        segmentHasEquals = false;
        continue;
      }
      if (ch === "=") {
        segmentHasEquals = true;
      }
    }

    if (inQuotes || segmentHasEquals) {
      return undefined;
    }

    let wordStart = position.character;
    while (wordStart > openParenIndex + 1) {
      const prevChar = lineText[wordStart - 1];
      if (!/\s/.test(prevChar)) {
        break;
      }
      wordStart -= 1;
    }

    while (wordStart > openParenIndex + 1) {
      const prevChar = lineText[wordStart - 1];
      if (!/[\w]/.test(prevChar)) {
        break;
      }
      wordStart -= 1;
    }

    return {
      tag,
      range: new vscode.Range(
        new vscode.Position(position.line, wordStart),
        position
      )
    };
  };

  const buildAttributeCompletionItems = (
    tag: string,
    range: vscode.Range
  ): vscode.CompletionItem[] | undefined => {
    const attributes = annotationAttributeMap[tag.toLowerCase()];
    if (!attributes || attributes.length === 0) {
      return undefined;
    }

    return attributes.map((attribute, index) => {
      const item = new vscode.CompletionItem(
        attribute,
        vscode.CompletionItemKind.Property
      );
      item.insertText = `${attribute}=`;
      item.range = range;
      item.detail = `@${tag} attribute`;
      item.sortText = `${index}`.padStart(2, "0");
      return item;
    });
  };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      "go",
      {
        provideCompletionItems(document, position) {
          const argContext = getAnnotationArgContext(document, position);
          if (argContext) {
            return buildAttributeCompletionItems(
              argContext.tag,
              argContext.range
            );
          }

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
      "#",
      "(",
      ","
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
        updateSwaggerRender(editor);
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

      updateSwaggerRender(editor);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument((event) => {
      if (!activeAnnotationEdit) {
        return;
      }
      if (event.document.uri.toString() !== activeAnnotationEdit.uri) {
        return;
      }
      event.waitUntil(finalizeAnnotationEdit());
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateActiveAnnotationEdit(editor);
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      updateActiveAnnotationEdit(event.textEditor);
    })
  );

  updateActiveAnnotationEdit(vscode.window.activeTextEditor);
}

export function deactivate() {}
