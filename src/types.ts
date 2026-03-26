import * as vscode from "vscode";

export type ConfiguredEntry = {
  configuredPath: string;
  uri: vscode.Uri;
  exists: boolean;
  isDirectory: boolean;
};

export type DocsNode = {
  kind: "directory" | "file" | "info";
  label: string;
  uri?: vscode.Uri;
  openUri?: vscode.Uri;
  configuredPath?: string;
  roots: vscode.Uri[];
  collapsibleState: vscode.TreeItemCollapsibleState;
};

export type LinkTarget =
  | { kind: "external"; uri: vscode.Uri }
  | { kind: "local"; uri: vscode.Uri; isMarkdown: boolean; anchor?: string };

export type PreviewHistoryEntry = {
  file: vscode.Uri;
  roots: vscode.Uri[];
  anchor?: string;
};

export type OpenFileOptions = {
  roots?: vscode.Uri[];
  anchor?: string;
  pushHistory?: boolean;
};

export type DocsSearchMatch = {
  file: vscode.Uri;
  roots: vscode.Uri[];
  anchor?: string;
  heading?: string;
  lineNumber: number;
  lineText: string;
};

export type DocsSearchQuickPickItem = vscode.QuickPickItem & {
  match: DocsSearchMatch;
};
