import * as vscode from "vscode";

type ApplyEdit = (edit: vscode.WorkspaceEdit) => Promise<boolean>;

export class AnnotationProcessor {
  private readonly diagnosticCollection: vscode.DiagnosticCollection;
  private readonly applyEdit: ApplyEdit;
  private readonly diagnosticsByDoc = new Map<string, vscode.Diagnostic[]>();

  constructor(
    diagnosticCollection: vscode.DiagnosticCollection,
    applyEdit: ApplyEdit
  ) {
    this.diagnosticCollection = diagnosticCollection;
    this.applyEdit = applyEdit;
  }

  async processLine(
    document: vscode.TextDocument,
    lineNumber: number,
    cursorCharacter?: number
  ) {
    const line = document.lineAt(lineNumber);
    const text = line.text;
    const annotationRegex = /^(\s*)[@#]([A-Za-z]\w*)\((.*)\)\s*$/;
    const match = text.match(annotationRegex);

    if (!match) {
      this.setLineDiagnostics(document, lineNumber, []);
      return;
    }

    if (
      typeof cursorCharacter === "number" &&
      this.isCursorInsideArgs(text, cursorCharacter)
    ) {
      this.setLineDiagnostics(document, lineNumber, []);
      return;
    }

    const leadingWhitespace = match[1];
    const tag = match[2];
    const rawArgs = match[3];
    const args = this.parseArgs(rawArgs);
    const swaggerComment = this.generateSwaggerComment(tag, args);

    const edit = new vscode.WorkspaceEdit();
    const range = new vscode.Range(
      new vscode.Position(lineNumber, 0),
      new vscode.Position(lineNumber, text.length)
    );
    edit.replace(document.uri, range, leadingWhitespace + swaggerComment);

    const applied = await this.applyEdit(edit);
    if (!applied) {
      return;
    }

    const diagnostics = this.validateSwaggerComment(
      lineNumber,
      leadingWhitespace + swaggerComment
    );
    this.setLineDiagnostics(document, lineNumber, diagnostics);
  }

  private parseArgs(rawArgs: string): string[] {
    const args: string[] = [];
    let current = "";
    let inQuotes = false;
    let escaped = false;

    for (const ch of rawArgs) {
      if (escaped) {
        current += ch;
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

      if (ch === "," && !inQuotes) {
        const trimmed = current.trim();
        if (trimmed.length > 0) {
          args.push(trimmed);
        }
        current = "";
        continue;
      }

      current += ch;
    }

    const trimmed = current.trim();
    if (trimmed.length > 0) {
      args.push(trimmed);
    }

    return args.map((arg) => this.unquote(arg));
  }

  private unquote(value: string): string {
    const trimmed = value.trim();
    if (trimmed.startsWith("\"") && trimmed.endsWith("\"") && trimmed.length >= 2) {
      return trimmed.slice(1, -1).replace(/\\"/g, "\"");
    }
    return trimmed;
  }

  private isCursorInsideArgs(text: string, cursorCharacter: number): boolean {
    const openIndex = text.indexOf("(");
    const closeIndex = text.lastIndexOf(")");
    if (openIndex === -1 || closeIndex === -1) {
      return false;
    }
    return cursorCharacter > openIndex && cursorCharacter <= closeIndex;
  }

  private quote(value: string): string {
    const escaped = value.replace(/"/g, "\\\"");
    return `"${escaped}"`;
  }

  private generateSwaggerComment(tag: string, args: string[]): string {
    let commentValue = args.join(" ");
    const schemaKinds = new Set([
      "object",
      "array",
      "string",
      "number",
      "integer",
      "boolean"
    ]);

    switch (tag) {
      case "Summary":
      case "Description":
      case "ID":
        if (args.length >= 1) {
          commentValue = args.join(" ");
        }
        break;
      case "Tags":
        if (args.length >= 1) {
          commentValue = args.length === 1 ? args[0] : args.join(",");
        }
        break;
      case "Accept":
      case "Produce":
      case "Schemes":
      case "Security":
        if (args.length >= 1) {
          commentValue = args.join(" ");
        }
        break;
      case "Deprecated":
        commentValue = "";
        break;
      case "Param":
        if (args.length >= 5) {
          commentValue = `${args[1]} ${args[0]} ${args[2]} ${args[3]} ${this.quote(
            args[4]
          )}`;
        }
        break;
      case "Header":
        if (args.length >= 4) {
          commentValue = `${args[0]} {${args[1]}} ${args[2]} ${this.quote(args[3])}`;
        } else if (args.length >= 3) {
          commentValue = `${args[0]} {${args[1]}} ${args[2]}`;
        }
        break;
      case "Success":
      case "Failure":
        if (args.length >= 4 && schemaKinds.has(args[1])) {
          commentValue = `${args[0]} {${args[1]}} ${args[2]} ${this.quote(args[3])}`;
        } else if (args.length >= 3) {
          commentValue = `${args[0]} {object} ${args[1]} ${this.quote(args[2])}`;
        } else if (args.length >= 2) {
          commentValue = `${args[0]} ${this.quote(args[1])}`;
        }
        break;
      case "Router":
        if (args.length >= 2) {
          commentValue = `${args[0]} [${args[1]}]`;
        }
        break;
      default:
        break;
    }

    if (commentValue.length === 0) {
      return `// @${tag}`;
    }
    return `// @${tag} ${commentValue}`;
  }

  private validateSwaggerComment(
    lineNumber: number,
    commentText: string
  ): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const typePatternRegex = /\b\w+\.\w+\b/g;
    let match: RegExpExecArray | null;

    while ((match = typePatternRegex.exec(commentText)) !== null) {
      const typePath = match[0];
      if (!this.isValidGoTypePath(typePath)) {
        const start = match.index;
        const range = new vscode.Range(
          new vscode.Position(lineNumber, start),
          new vscode.Position(lineNumber, start + typePath.length)
        );
        diagnostics.push(
          new vscode.Diagnostic(
            range,
            `'${typePath}' does not match 'packageName.TypeName' or 'packageName.FunctionName'.`,
            vscode.DiagnosticSeverity.Warning
          )
        );
      }
    }

    return diagnostics;
  }

  private isValidGoTypePath(typePath: string): boolean {
    const regex = /^\w+\.\w+$/;
    return regex.test(typePath);
  }

  private setLineDiagnostics(
    document: vscode.TextDocument,
    lineNumber: number,
    lineDiagnostics: vscode.Diagnostic[]
  ) {
    const key = document.uri.toString();
    const existing = this.diagnosticsByDoc.get(key) ?? [];
    const filtered = existing.filter(
      (diag) => diag.range.start.line !== lineNumber
    );
    const updated = filtered.concat(lineDiagnostics);
    this.diagnosticsByDoc.set(key, updated);
    this.diagnosticCollection.set(document.uri, updated);
  }
}
