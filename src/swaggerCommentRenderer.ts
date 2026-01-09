import * as vscode from "vscode";

type RenderResult = {
  annotationDecorations: vscode.DecorationOptions[];
  hiddenRanges: vscode.Range[];
};

export class SwaggerCommentRenderer {
  private readonly supportedTags = new Set([
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
  ]);

  buildDecorations(document: vscode.TextDocument): RenderResult {
    const annotationDecorations: vscode.DecorationOptions[] = [];
    const hiddenRanges: vscode.Range[] = [];

    for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
      const line = document.lineAt(lineNumber);
      const parsed = this.parseSwaggerLine(line.text);
      if (!parsed) {
        continue;
      }
      if (!this.supportedTags.has(parsed.tag)) {
        continue;
      }

      const annotation = this.convertToAnnotation(parsed.tag, parsed.value);
      if (!annotation) {
        continue;
      }

      const contentText = parsed.indent + annotation;
      annotationDecorations.push({
        range: new vscode.Range(line.range.start, line.range.start),
        renderOptions: {
          before: {
            contentText
          }
        }
      });
      hiddenRanges.push(line.range);
    }

    return { annotationDecorations, hiddenRanges };
  }

  toAnnotationLine(text: string): string | undefined {
    const parsed = this.parseSwaggerLine(text);
    if (!parsed) {
      return undefined;
    }
    if (!this.supportedTags.has(parsed.tag)) {
      return undefined;
    }

    const annotation = this.convertToAnnotation(parsed.tag, parsed.value);
    if (!annotation) {
      return undefined;
    }

    return parsed.indent + annotation;
  }

  private parseSwaggerLine(
    text: string
  ): { indent: string; tag: string; value: string } | undefined {
    const match = text.match(/^(\s*)\/\/\s*@([A-Za-z]\w*)\s*(.*)$/);
    if (!match) {
      return undefined;
    }

    return {
      indent: match[1],
      tag: match[2],
      value: match[3].trim()
    };
  }

  private convertToAnnotation(tag: string, value: string): string | undefined {
    switch (tag) {
      case "Summary":
      case "Description":
      case "ID":
        return this.renderSimpleText(tag, value);
      case "Tags":
        return this.renderTags(value);
      case "Accept":
      case "Produce":
      case "Schemes":
      case "Security":
        return this.renderList(tag, value);
      case "Deprecated":
        return "@Deprecated()";
      case "Param":
        return this.renderParam(value);
      case "Header":
        return this.renderHeader(value);
      case "Success":
      case "Failure":
        return this.renderResponse(tag, value);
      case "Router":
        return this.renderRouter(value);
      default:
        return undefined;
    }
  }

  private renderSimpleText(tag: string, value: string): string {
    if (!value) {
      return `@${tag}()`;
    }
    const key = this.getSimpleTextKey(tag);
    return `@${tag}(${key}=${this.quote(value)})`;
  }

  private getSimpleTextKey(tag: string): string {
    switch (tag) {
      case "Summary":
      case "Description":
        return "desc";
      case "Summary":
        return "desc";
      case "ID":
        return "id";
      default:
        return "value";
    }
  }

  private renderTags(value: string): string {
    const tags = this.splitByComma(value);
    if (tags.length === 0) {
      return "@Tags()";
    }
    return `@Tags(${tags.map((tag) => this.quote(tag)).join(", ")})`;
  }

  private renderList(tag: string, value: string): string {
    const items = this.splitByWhitespace(value);
    if (items.length === 0) {
      return `@${tag}()`;
    }
    return `@${tag}(${items.map((item) => this.quote(item)).join(", ")})`;
  }

  private renderParam(value: string): string | undefined {
    const parts = this.splitBySpacesPreserveQuotes(value);
    if (parts.length < 4) {
      return undefined;
    }

    const name = parts[0];
    const inValue = parts[1];
    const type = parts[2];
    const required = parts[3];
    const description = parts.slice(4).join(" ");

    const segments = [
      `in=${this.quote(inValue)}`,
      `name=${this.quote(name)}`,
      `type=${type}`,
      `required=${required}`
    ];

    if (description) {
      segments.push(`desc=${this.quote(description)}`);
    }

    return `@Param(${segments.join(", ")})`;
  }

  private renderHeader(value: string): string | undefined {
    const parts = this.splitBySpacesPreserveQuotes(value);
    if (parts.length < 3) {
      return undefined;
    }

    const code = parts[0];
    const type = parts[1].replace(/^\{/, "").replace(/\}$/, "");
    const name = parts[2];
    const description = parts.slice(3).join(" ");

    const segments = [
      `code=${code}`,
      `type=${type}`,
      `name=${this.quote(name)}`
    ];

    if (description) {
      segments.push(`desc=${this.quote(description)}`);
    }

    return `@Header(${segments.join(", ")})`;
  }

  private renderResponse(tag: string, value: string): string | undefined {
    const parts = this.splitBySpacesPreserveQuotes(value);
    if (parts.length < 1) {
      return undefined;
    }

    const code = parts[0];
    let schema: string | undefined;
    let typePath: string | undefined;
    let description = "";

    const schemaCandidate = parts[1];
    if (schemaCandidate && schemaCandidate.startsWith("{") && schemaCandidate.endsWith("}")) {
      schema = schemaCandidate.slice(1, -1);
      typePath = parts[2];
      description = parts.slice(3).join(" ");
    } else if (parts.length >= 3) {
      typePath = parts[1];
      description = parts.slice(2).join(" ");
    } else {
      description = parts.slice(1).join(" ");
    }

    const segments = [`code=${code}`];
    if (schema && schema !== "object") {
      segments.push(`schema=${this.quote(schema)}`);
    }
    if (typePath) {
      segments.push(`type=${typePath}`);
    }
    if (description) {
      segments.push(`desc=${this.quote(description)}`);
    }

    return `@${tag}(${segments.join(", ")})`;
  }

  private renderRouter(value: string): string | undefined {
    const parts = this.splitBySpacesPreserveQuotes(value);
    if (parts.length < 2) {
      return undefined;
    }

    const path = parts[0];
    const method = parts[1].replace(/^\[/, "").replace(/\]$/, "");

    return `@Router(path=${this.quote(path)}, method=${this.quote(method)})`;
  }

  private splitByComma(value: string): string[] {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private splitByWhitespace(value: string): string[] {
    return value
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private splitBySpacesPreserveQuotes(value: string): string[] {
    const parts: string[] = [];
    let current = "";
    let inQuotes = false;
    let escaped = false;

    for (const ch of value) {
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

      if (!inQuotes && /\s/.test(ch)) {
        const trimmed = current.trim();
        if (trimmed.length > 0) {
          parts.push(this.unquote(trimmed));
        }
        current = "";
        continue;
      }

      current += ch;
    }

    const trimmed = current.trim();
    if (trimmed.length > 0) {
      parts.push(this.unquote(trimmed));
    }

    return parts;
  }

  private unquote(value: string): string {
    if (value.startsWith("\"") && value.endsWith("\"") && value.length >= 2) {
      return value.slice(1, -1).replace(/\\"/g, "\"");
    }
    return value;
  }

  private quote(value: string): string {
    const escaped = value.replace(/"/g, "\\\"");
    return `"${escaped}"`;
  }
}
