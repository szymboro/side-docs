import * as path from "path";
import * as vscode from "vscode";

import { CONFIG_PATHS, CONFIG_SECTION, README_FILE } from "./constants";
import { ConfiguredEntry, DocsSearchMatch } from "./types";

export async function getConfiguredEntries(): Promise<ConfiguredEntry[]> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const configuredPaths = config.get<string[]>(CONFIG_PATHS, ["docs"]);
  const uniqueEntries = new Map<string, ConfiguredEntry>();

  for (const configuredPath of configuredPaths) {
    const trimmed = configuredPath.trim();
    if (!trimmed) {
      continue;
    }

    const uri = resolveConfiguredPath(trimmed);
    if (!uri) {
      continue;
    }

    const stat = await tryStat(uri);
    uniqueEntries.set(uri.fsPath, {
      configuredPath: trimmed,
      uri,
      exists: Boolean(stat),
      isDirectory: stat?.type === vscode.FileType.Directory,
    });
  }

  return [...uniqueEntries.values()];
}

export async function getConfiguredRootUris(): Promise<vscode.Uri[]> {
  const entries = await getConfiguredEntries();
  return entries.filter((entry) => entry.exists).map((entry) => entry.uri);
}

export function resolveConfiguredPath(
  configuredPath: string,
): vscode.Uri | undefined {
  if (path.isAbsolute(configuredPath)) {
    return vscode.Uri.file(path.normalize(configuredPath));
  }

  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return undefined;
  }

  for (const folder of folders) {
    const candidate = vscode.Uri.joinPath(folder.uri, configuredPath);
    if (pathExistsSync(candidate)) {
      return candidate;
    }
  }

  return vscode.Uri.joinPath(folders[0].uri, configuredPath);
}

export async function resolveMarkdownTarget(
  file: vscode.Uri,
): Promise<vscode.Uri | undefined> {
  const stat = await tryStat(file);
  if (stat?.type === vscode.FileType.Directory) {
    return getDirectoryReadme(file);
  }

  if (stat?.type === vscode.FileType.File && isMarkdownFile(file.fsPath)) {
    return file;
  }

  return undefined;
}

export async function getDirectoryReadme(
  directory: vscode.Uri,
): Promise<vscode.Uri | undefined> {
  const readmeUri = vscode.Uri.joinPath(directory, README_FILE);
  return (await pathExists(readmeUri)) ? readmeUri : undefined;
}

export async function getDisplayName(file: vscode.Uri): Promise<string> {
  try {
    const bytes = await vscode.workspace.fs.readFile(file);
    const markdown = Buffer.from(bytes).toString("utf8");
    const heading = extractFirstHeading(markdown);
    if (heading) {
      return heading;
    }
  } catch {
    // Ignore broken files and fall back to the file name.
  }

  return path.basename(file.fsPath, path.extname(file.fsPath));
}

export function extractFirstHeading(markdown: string): string | undefined {
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    const match = /^#\s+(.+?)\s*$/.exec(line.trim());
    if (match) {
      return match[1];
    }
  }

  return undefined;
}

export function getLocalResourceRoots(
  context: vscode.ExtensionContext,
): vscode.Uri[] {
  const roots = [vscode.Uri.joinPath(context.extensionUri, "media")];
  const folders =
    vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? [];
  return [...roots, ...folders];
}

export function splitHref(href: string): [string, string | undefined] {
  const hashIndex = href.indexOf("#");
  if (hashIndex === -1) {
    return [href, undefined];
  }

  return [href.slice(0, hashIndex), href.slice(hashIndex)];
}

export function compareEntries(
  left: [string, vscode.FileType],
  right: [string, vscode.FileType],
): number {
  if (left[1] !== right[1]) {
    return left[1] === vscode.FileType.Directory ? -1 : 1;
  }

  return left[0].localeCompare(right[0]);
}

export function isMarkdownFile(fileName: string): boolean {
  return path.extname(fileName).toLowerCase() === ".md";
}

export function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:|vscode:)/i.test(href);
}

export function isWithinDocsRoots(
  file: vscode.Uri,
  roots: vscode.Uri[],
): boolean {
  return roots.some((root) => {
    const rootPath = root.fsPath;
    const filePath = file.fsPath;

    if (rootPath === filePath) {
      return true;
    }

    return filePath.startsWith(`${rootPath}${path.sep}`);
  });
}

export function pathExistsSync(uri: vscode.Uri): boolean {
  try {
    return require("fs").existsSync(uri.fsPath) as boolean;
  } catch {
    return false;
  }
}

export async function pathExists(uri: vscode.Uri): Promise<boolean> {
  return Boolean(await tryStat(uri));
}

export async function tryStat(
  uri: vscode.Uri,
): Promise<vscode.FileStat | undefined> {
  try {
    return await vscode.workspace.fs.stat(uri);
  } catch {
    return undefined;
  }
}

export async function findDocsMatches(
  roots: vscode.Uri[],
  query: string,
): Promise<DocsSearchMatch[]> {
  const normalizedQuery = query.toLowerCase();
  const results: DocsSearchMatch[] = [];

  for (const root of roots) {
    const files = await collectMarkdownFiles(root);
    for (const file of files) {
      const bytes = await vscode.workspace.fs.readFile(file);
      const markdown = Buffer.from(bytes).toString("utf8");
      const lines = markdown.split(/\r?\n/);
      let currentHeading: string | undefined;
      let currentAnchor: string | undefined;

      for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
        const line = lines[lineNumber];
        const headingMatch = /^#{1,6}\s+(.+?)\s*$/.exec(line.trim());
        if (headingMatch) {
          currentHeading = headingMatch[1];
          currentAnchor = `#${slugify(headingMatch[1])}`;
        }

        if (!line.toLowerCase().includes(normalizedQuery)) {
          continue;
        }

        results.push({
          file,
          roots: [root],
          anchor: currentAnchor,
          heading: currentHeading,
          lineNumber,
          lineText: line,
        });

        if (results.length >= 200) {
          return results;
        }
      }
    }
  }

  return results;
}

export async function collectMarkdownFiles(
  root: vscode.Uri,
): Promise<vscode.Uri[]> {
  const stat = await tryStat(root);
  if (!stat) {
    return [];
  }

  if (stat.type === vscode.FileType.File) {
    return isMarkdownFile(root.fsPath) ? [root] : [];
  }

  const files: vscode.Uri[] = [];
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(root);
  } catch {
    return files;
  }

  for (const [name, type] of entries) {
    if (name.startsWith(".")) {
      continue;
    }

    const childUri = vscode.Uri.joinPath(root, name);
    if (type === vscode.FileType.Directory) {
      files.push(...(await collectMarkdownFiles(childUri)));
      continue;
    }

    if (type === vscode.FileType.File && isMarkdownFile(name)) {
      files.push(childUri);
    }
  }

  return files;
}

export function haveSameRoots(
  left: vscode.Uri[],
  right: vscode.Uri[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((uri, index) => uri.fsPath === right[index]?.fsPath);
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-") || "section"
  );
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function findHeadingLine(
  document: vscode.TextDocument,
  targetSlug: string,
): number | undefined {
  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(
      document.lineAt(lineNumber).text.trim(),
    );
    if (match && slugify(match[1]) === targetSlug) {
      return lineNumber;
    }
  }

  return undefined;
}
