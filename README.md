# Side Docs

Side Docs is a VS Code extension that turns a folder of Markdown files into a dedicated sidebar and rendered docs experience inside your editor.

It is built for projects that keep internal documentation close to the codebase and want something lighter than a full static site generator. You point the extension at one or more docs paths, and Side Docs gives you a browsable tree, rendered preview, navigation history, and search.

## What It Does

- Shows your docs in a dedicated `Side Docs` activity bar view.
- Builds the sidebar from configured Markdown files and folders.
- Uses the first `# H1` in a file or `README.md` as the display name.
- Opens docs in a rendered preview tab instead of a raw editor by default.
- Keeps internal docs navigation inside the same preview tab.
- Opens files outside the configured docs roots in a normal editor tab.
- Renders images, code blocks, tables, links, and anchors.
- Supports back, forward, edit, and in-document search in the preview.
- Supports cross-document search from the sidebar.

## Installation

You can install Side Docs from the VS Code Marketplace once it is published.

If you are running it locally during development:

1. Clone the repository.
2. Install dependencies:

```bash
npm install
```

3. Compile the extension:

```bash
npm run compile
```

4. Press `F5` in VS Code to launch an Extension Development Host.

## Setup

Side Docs is configured through workspace settings.

Add `docsPanel.paths` to your project settings:

```json
{
  "docsPanel.paths": [
    "docs",
    "internal-guides",
    "/absolute/path/to/shared-docs"
  ]
}
```

Each entry in `docsPanel.paths` can be:

- A folder relative to the workspace.
- A single Markdown file relative to the workspace.
- An absolute path to a folder or Markdown file.

## Recommended Docs Structure

Side Docs works best when each visible folder has a `README.md` file.

Example:

```text
docs/
  README.md
  getting-started/
    README.md
    installation.md
    troubleshooting.md
  api/
    README.md
    authentication.md
```

Notes:

- A folder appears in the sidebar only if it contains a `README.md`.
- Files are labeled from their first `# H1` when present.
- Files without an `H1` fall back to the file name.

## How To Use

After configuration:

1. Open the `Side Docs` icon in the VS Code activity bar.
2. Click a doc or section in the sidebar tree.
3. Read it in the rendered preview.
4. Use links inside the document to move through docs.

Preview behavior:

- Links to Markdown files inside configured docs roots stay in the same preview tab.
- Links to files outside the configured docs roots open in a normal editor tab.
- Image references render inline in the preview.
- Anchors scroll to the target section.

## Search

Side Docs supports two types of search.

### Search In Current Document

Use the search icon inside the preview header.

- Highlights matches in the currently open rendered doc.
- Lets you move through results.
- Scrolls to the active match.

### Search Across All Docs

Use the search icon in the `Side Docs` sidebar title area.

- Searches all Markdown files inside configured docs roots.
- Shows results in a quick pick list.
- Opens the selected result in the rendered preview.
- Preserves the selected result location and highlights the query.

## Commands

Side Docs contributes the following commands:

- `Refresh Docs`
- `Search Docs`
- `Open Rendered Docs`

## Why Side Docs

Side Docs is meant to be practical.

It keeps documentation inside the editor, close to code review, implementation, and maintenance work. That makes it useful for internal team docs, onboarding guides, architecture notes, runbooks, and project-specific technical documentation.

## Open Source

Side Docs is FOSS.

The project is open source and intended to stay approachable for users and contributors. If you want to improve the extension, fix rough edges, or add features, contributions are welcome.

## Contributing

Any contribution is good to see.

You can help by:

- Reporting bugs.
- Suggesting UX improvements.
- Improving the docs.
- Sending code fixes.
- Proposing new features.
- Cleaning up internals and refactors.

Typical development flow:

```bash
npm install
npm run compile
```

Then launch the extension with `F5` in VS Code.

If you open a pull request, keeping changes focused and easy to review is appreciated.

## License

This project is licensed under the `ISC` license.

## Feedback

If Side Docs helps your workflow, or if something feels awkward, feedback is useful. Small polish suggestions are just as valuable as larger feature requests.