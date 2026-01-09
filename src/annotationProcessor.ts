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

  private extractNamedArgs(
    args: string[],
    allowedKeys: Set<string>
  ): { named: Record<string, string>; positional: string[] } {
    const named: Record<string, string> = {};
    const positional: string[] = [];

    for (const arg of args) {
      const equalIndex = arg.indexOf("=");
      if (equalIndex === -1) {
        positional.push(arg);
        continue;
      }

      const key = arg.slice(0, equalIndex).trim().toLowerCase();
      if (!allowedKeys.has(key)) {
        positional.push(arg);
        continue;
      }

      const value = this.unquote(arg.slice(equalIndex + 1).trim());
      named[key] = value;
    }

    return { named, positional };
  }

  private getNamedValue(
    named: Record<string, string>,
    keys: string[]
  ): string | undefined {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(named, key)) {
        return named[key];
      }
    }
    return undefined;
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
          const { named, positional } = this.extractNamedArgs(
            args,
            new Set(["summary", "description", "desc", "id", "value", "text"])
          );
          let namedValue: string | undefined;
          if (tag === "Summary") {
            namedValue = this.getNamedValue(named, [
              "summary",
              "description",
              "desc",
              "value",
              "text"
            ]);
          } else if (tag === "Description") {
            namedValue = this.getNamedValue(named, [
              "description",
              "desc",
              "value",
              "text"
            ]);
          } else {
            namedValue = this.getNamedValue(named, ["id", "value", "text"]);
          }

          if (namedValue !== undefined) {
            commentValue = namedValue;
          } else {
            commentValue = positional.join(" ");
          }
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
          const { named, positional } = this.extractNamedArgs(
            args,
            new Set(["in", "name", "type", "required", "description", "desc"])
          );
          const inValue = this.getNamedValue(named, ["in"]) ?? positional[0];
          const name = this.getNamedValue(named, ["name"]) ?? positional[1];
          const type = this.getNamedValue(named, ["type"]) ?? positional[2];
          const required =
            this.getNamedValue(named, ["required"]) ?? positional[3];
          const description =
            this.getNamedValue(named, ["description", "desc"]) ?? positional[4];

          if (
            name !== undefined &&
            inValue !== undefined &&
            type !== undefined &&
            required !== undefined &&
            description !== undefined
          ) {
            commentValue = `${name} ${inValue} ${type} ${required} ${this.quote(
              description
            )}`;
          }
        }
        break;
      case "Header":
        if (args.length >= 3) {
          const { named, positional } = this.extractNamedArgs(
            args,
            new Set(["code", "type", "name", "description", "desc"])
          );
          const code = this.getNamedValue(named, ["code"]) ?? positional[0];
          const type = this.getNamedValue(named, ["type"]) ?? positional[1];
          const name = this.getNamedValue(named, ["name"]) ?? positional[2];
          const description =
            this.getNamedValue(named, ["description", "desc"]) ?? positional[3];

          if (code !== undefined && type !== undefined && name !== undefined) {
            if (description !== undefined) {
              commentValue = `${code} {${type}} ${name} ${this.quote(
                description
              )}`;
            } else {
              commentValue = `${code} {${type}} ${name}`;
            }
          }
        }
        break;
      case "Success":
      case "Failure":
        if (args.length >= 2) {
          const { named, positional } = this.extractNamedArgs(
            args,
            new Set([
              "code",
              "schema",
              "schematype",
              "type",
              "typepath",
              "description",
              "desc",
              "message"
            ])
          );
          const namedCode = this.getNamedValue(named, ["code"]);
          let positionalIndex = 0;
          const code = namedCode ?? positional[positionalIndex];
          if (namedCode === undefined && code !== undefined) {
            positionalIndex += 1;
          }

          const namedSchema = this.getNamedValue(named, [
            "schema",
            "schematype"
          ]);
          let schema = namedSchema;
          if (schema === undefined) {
            const candidate = positional[positionalIndex];
            if (candidate !== undefined && schemaKinds.has(candidate)) {
              schema = candidate;
              positionalIndex += 1;
            }
          }

          const namedTypePath = this.getNamedValue(named, ["type", "typepath"]);
          let typePath = namedTypePath;
          if (typePath === undefined) {
            typePath = positional[positionalIndex];
            if (typePath !== undefined) {
              positionalIndex += 1;
            }
          }

          const description =
            this.getNamedValue(named, ["description", "desc", "message"]) ??
            positional[positionalIndex];

          if (code !== undefined) {
            if (typePath !== undefined && description !== undefined) {
              if (schema !== undefined && schemaKinds.has(schema)) {
                commentValue = `${code} {${schema}} ${typePath} ${this.quote(
                  description
                )}`;
              } else {
                commentValue = `${code} {object} ${typePath} ${this.quote(
                  description
                )}`;
              }
            } else if (description !== undefined) {
              commentValue = `${code} ${this.quote(description)}`;
            }
          }
        }
        break;
      case "Router":
        if (args.length >= 2) {
          const { named, positional } = this.extractNamedArgs(
            args,
            new Set(["path", "method"])
          );
          const path = this.getNamedValue(named, ["path"]) ?? positional[0];
          const method = this.getNamedValue(named, ["method"]) ?? positional[1];
          if (path !== undefined && method !== undefined) {
            commentValue = `${path} [${method}]`;
          }
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
