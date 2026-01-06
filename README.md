# swaggo

GoSwagger Genie for VS Code. Write virtual annotations like `#Summary("...")` and have them converted into `// @Summary ...` Go Swagger comments.

## Features

- Virtual annotation syntax (`#Tag(args)`) for Go Swagger comments.
- Automatic conversion to `// @Tag ...` on edit.
- Basic type-path validation (`package.Type`) with diagnostics.
- Optional snippets for common Swagger blocks.

## Quick start

1. Install dependencies: `npm install`
2. Build the extension: `npm run compile`
3. Press `F5` in VS Code to launch the Extension Development Host.

## Notes

- Validation is pattern-only; it does not inspect your Go codebase.
- The conversion runs on document changes in Go files.
