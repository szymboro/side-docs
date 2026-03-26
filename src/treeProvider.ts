import * as path from "path";
import * as vscode from "vscode";

import { CONFIG_SECTION, README_FILE } from "./constants";
import {
  compareEntries,
  getConfiguredEntries,
  getDirectoryReadme,
  getDisplayName,
  isMarkdownFile,
} from "./docsService";
import { ConfiguredEntry, DocsNode } from "./types";

export class DocsTreeProvider implements vscode.TreeDataProvider<DocsNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    DocsNode | undefined | void
  >();

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  refresh() {
    this.onDidChangeTreeDataEmitter.fire();
  }

  async getTreeItem(element: DocsNode): Promise<vscode.TreeItem> {
    const item = new vscode.TreeItem(element.label, element.collapsibleState);
    item.tooltip = element.uri?.fsPath ?? element.label;

    if (element.kind === "info") {
      item.iconPath = new vscode.ThemeIcon("info");
      item.command = {
        command: "workbench.action.openWorkspaceSettings",
        title: "Open Workspace Settings",
        arguments: [CONFIG_SECTION],
      };
      return item;
    }

    item.resourceUri = element.uri;
    item.description = element.configuredPath;
    item.iconPath = new vscode.ThemeIcon(
      element.kind === "directory" ? "book" : "markdown",
    );

    if (element.openUri) {
      item.command = {
        command: "docsPanel.openFile",
        title: "Open Documentation",
        arguments: [
          {
            uri: element.openUri,
            roots: element.roots,
          },
        ],
      };
    }

    return item;
  }

  async getChildren(element?: DocsNode): Promise<DocsNode[]> {
    if (!element) {
      return this.getRootNodes();
    }

    if (element.kind !== "directory" || !element.uri) {
      return [];
    }

    return buildDirectoryChildren(element.uri, element.roots);
  }

  private async getRootNodes(): Promise<DocsNode[]> {
    const entries = await getConfiguredEntries();
    if (!entries.length) {
      return [
        createInfoNode(
          "Configure docsPanel.paths in workspace settings to show your docs.",
        ),
      ];
    }

    return Promise.all(entries.map((entry) => buildEntryNode(entry)));
  }
}

function createInfoNode(label: string): DocsNode {
  return {
    kind: "info",
    label,
    roots: [],
    collapsibleState: vscode.TreeItemCollapsibleState.None,
  };
}

async function buildEntryNode(entry: ConfiguredEntry): Promise<DocsNode> {
  if (!entry.exists) {
    return {
      kind: "info",
      label: `Missing path: ${entry.configuredPath}`,
      uri: entry.uri,
      roots: [],
      collapsibleState: vscode.TreeItemCollapsibleState.None,
    };
  }

  if (entry.isDirectory) {
    return buildDirectoryNode(
      entry.uri,
      [entry.uri],
      entry.configuredPath,
      true,
    );
  }

  return buildFileNode(entry.uri, [entry.uri], entry.configuredPath);
}

async function buildDirectoryNode(
  directory: vscode.Uri,
  roots: vscode.Uri[],
  configuredPath?: string,
  expanded = false,
): Promise<DocsNode> {
  const readmeUri = await getDirectoryReadme(directory);
  const children = await buildDirectoryChildren(directory, roots);
  const label = readmeUri
    ? await getDisplayName(readmeUri)
    : path.basename(directory.fsPath);

  return {
    kind: "directory",
    label,
    uri: directory,
    openUri: readmeUri,
    configuredPath,
    roots,
    collapsibleState:
      children.length > 0
        ? expanded
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
  };
}

async function buildDirectoryChildren(
  directory: vscode.Uri,
  roots: vscode.Uri[],
): Promise<DocsNode[]> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(directory);
  } catch {
    return [];
  }

  const visibleEntries: [string, vscode.FileType][] = [];
  for (const [name, type] of entries) {
    if (name.startsWith(".")) {
      continue;
    }

    if (type === vscode.FileType.Directory) {
      const childUri = vscode.Uri.joinPath(directory, name);
      if (await getDirectoryReadme(childUri)) {
        visibleEntries.push([name, type]);
      }
      continue;
    }

    if (
      isMarkdownFile(name) &&
      name.toLowerCase() !== README_FILE.toLowerCase()
    ) {
      visibleEntries.push([name, type]);
    }
  }

  visibleEntries.sort(compareEntries);

  return Promise.all(
    visibleEntries.map(async ([name, type]) => {
      const childUri = vscode.Uri.joinPath(directory, name);
      if (type === vscode.FileType.Directory) {
        return buildDirectoryNode(childUri, roots);
      }

      return buildFileNode(childUri, roots);
    }),
  );
}

async function buildFileNode(
  file: vscode.Uri,
  roots: vscode.Uri[],
  configuredPath?: string,
): Promise<DocsNode> {
  return {
    kind: "file",
    label: await getDisplayName(file),
    uri: file,
    openUri: file,
    configuredPath,
    roots,
    collapsibleState: vscode.TreeItemCollapsibleState.None,
  };
}
