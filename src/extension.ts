import * as vscode from "vscode";
import { CONFIG_SECTION, VIEW_ID } from "./constants";
import { PreviewController } from "./previewController";
import { DocsTreeProvider } from "./treeProvider";

export function activate(context: vscode.ExtensionContext) {
  const provider = new DocsTreeProvider();
  const preview = new PreviewController(context);

  context.subscriptions.push(
    preview,
    vscode.window.registerTreeDataProvider(VIEW_ID, provider),
    vscode.commands.registerCommand("docsPanel.refresh", async () => {
      provider.refresh();
      await preview.refreshCurrentPreview();
    }),
    vscode.commands.registerCommand("docsPanel.searchDocs", async () => {
      await preview.searchAcrossDocs();
    }),
    vscode.commands.registerCommand(
      "docsPanel.openFile",
      async (
        payload: vscode.Uri | { uri: vscode.Uri; roots?: vscode.Uri[] },
      ) => {
        if (payload instanceof vscode.Uri) {
          await preview.openFile(payload);
          return;
        }

        await preview.openFile(payload.uri, { roots: payload.roots });
      },
    ),
    vscode.commands.registerCommand("docsPanel.openRendered", async () => {
      await preview.openRenderedActiveFile();
    }),
    vscode.commands.registerCommand("docsPanel.searchInPreview", async () => {
      await preview.openPreviewSearch();
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration(CONFIG_SECTION)) {
        return;
      }

      provider.refresh();
      await preview.reopenCurrentPreview();
    }),
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      provider.refresh();
      if (preview.hasOpenFile()) {
        await preview.refreshCurrentPreview();
      }
    }),
    vscode.workspace.onDidCreateFiles(() => provider.refresh()),
    vscode.workspace.onDidDeleteFiles(async () => {
      provider.refresh();
      await preview.refreshCurrentPreview();
    }),
    vscode.workspace.onDidRenameFiles(async () => {
      provider.refresh();
      await preview.refreshCurrentPreview();
    }),
  );
}

export function deactivate() {
  // Preview disposal is handled through extension subscriptions.
}
