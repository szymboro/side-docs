import MarkdownIt from "markdown-it";
import * as path from "path";
import * as vscode from "vscode";

import {
  escapeHtml,
  findDocsMatches,
  findHeadingLine,
  getConfiguredRootUris,
  getDirectoryReadme,
  getDisplayName,
  getLocalResourceRoots,
  haveSameRoots,
  isExternalHref,
  isMarkdownFile,
  isWithinDocsRoots,
  pathExists,
  resolveMarkdownTarget,
  slugify,
  splitHref,
  tryStat,
} from "./docsService";
import {
  DocsSearchQuickPickItem,
  LinkTarget,
  OpenFileOptions,
  PreviewHistoryEntry,
} from "./types";

export class PreviewController {
  private previewPanel: vscode.WebviewPanel | undefined;
  private currentFile: vscode.Uri | undefined;
  private currentRoots: vscode.Uri[] = [];
  private currentAnchor: string | undefined;
  private previewHistory: PreviewHistoryEntry[] = [];
  private previewHistoryIndex = -1;

  constructor(private readonly context: vscode.ExtensionContext) {}

  dispose() {
    this.previewPanel?.dispose();
  }

  hasOpenFile(): boolean {
    return Boolean(this.currentFile);
  }

  async refreshCurrentPreview() {
    if (!this.previewPanel || !this.currentFile) {
      return;
    }

    const exists = await pathExists(this.currentFile);
    if (!exists) {
      this.previewPanel.webview.html = getMissingFileContent(this.currentFile);
      return;
    }

    await this.renderPreview(
      this.previewPanel,
      this.currentFile,
      this.currentRoots,
      this.currentAnchor,
    );
  }

  async reopenCurrentPreview() {
    if (!this.currentFile) {
      return;
    }

    await this.openFile(this.currentFile, {
      roots: this.currentRoots,
      anchor: this.currentAnchor,
      pushHistory: false,
    });
  }

  async openFile(file: vscode.Uri, options?: OpenFileOptions) {
    const target = await resolveMarkdownTarget(file);
    if (!target) {
      await vscode.commands.executeCommand("vscode.open", file);
      return;
    }

    const effectiveRoots = options?.roots ?? (await getConfiguredRootUris());
    const anchor = options?.anchor;
    const panel = this.ensurePreviewPanel();

    if (options?.pushHistory !== false) {
      this.pushPreviewHistory({
        file: target,
        roots: effectiveRoots,
        anchor,
      });
    }

    await this.renderPreview(panel, target, effectiveRoots, anchor);
    panel.reveal(vscode.ViewColumn.Active, false);
  }

  async openRenderedActiveFile() {
    const activeFile = vscode.window.activeTextEditor?.document.uri;
    if (!activeFile || activeFile.scheme !== "file") {
      return;
    }

    await this.openFile(activeFile);
  }

  async openPreviewSearch() {
    if (!this.previewPanel || !this.currentFile) {
      const activeFile = vscode.window.activeTextEditor?.document.uri;
      if (!activeFile || activeFile.scheme !== "file") {
        void vscode.window.showInformationMessage(
          "Open a docs file in the preview before searching.",
        );
        return;
      }

      await this.openFile(activeFile);
    }

    this.previewPanel?.reveal(vscode.ViewColumn.Active, false);
    this.previewPanel?.webview.postMessage({ type: "openSearch" });
  }

  async navigateBack() {
    await this.navigatePreviewHistory("back");
  }

  async navigateForward() {
    await this.navigatePreviewHistory("forward");
  }

  async searchAcrossDocs() {
    const roots = await getConfiguredRootUris();
    if (!roots.length) {
      void vscode.window.showInformationMessage(
        "Configure docsPanel.paths before searching docs.",
      );
      return;
    }

    const query = await vscode.window.showInputBox({
      prompt: "Search all configured docs",
      placeHolder: "Enter text to search across markdown files",
      ignoreFocusOut: true,
    });
    const normalizedQuery = query?.trim();
    if (!normalizedQuery) {
      return;
    }

    const matches = await findDocsMatches(roots, normalizedQuery);
    if (!matches.length) {
      void vscode.window.showInformationMessage(
        `No docs matches found for "${normalizedQuery}".`,
      );
      return;
    }

    const items: DocsSearchQuickPickItem[] = matches.map((match) => ({
      label:
        match.heading ??
        path.basename(match.file.fsPath, path.extname(match.file.fsPath)),
      description: `${vscode.workspace.asRelativePath(match.file, false)}:${match.lineNumber + 1}`,
      detail: match.lineText.trim(),
      match,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `${matches.length} matches for "${normalizedQuery}"`,
      matchOnDescription: true,
      matchOnDetail: true,
      ignoreFocusOut: true,
    });
    if (!selected) {
      return;
    }

    await this.openFile(selected.match.file, {
      roots: selected.match.roots,
      anchor: selected.match.anchor,
    });
    this.previewPanel?.webview.postMessage({
      type: "openSearch",
      query: normalizedQuery,
      keepPosition: true,
    });
  }

  private ensurePreviewPanel(): vscode.WebviewPanel {
    if (this.previewPanel) {
      return this.previewPanel;
    }

    this.previewPanel = vscode.window.createWebviewPanel(
      "docsPanel.preview",
      "Side Docs",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: getLocalResourceRoots(this.context),
      },
    );

    this.previewPanel.onDidDispose(() => {
      this.previewPanel = undefined;
      this.currentFile = undefined;
      this.currentRoots = [];
      this.currentAnchor = undefined;
      this.previewHistory = [];
      this.previewHistoryIndex = -1;
    });

    this.previewPanel.webview.onDidReceiveMessage(async (message) => {
      if (!this.currentFile) {
        return;
      }

      if (message?.type === "openLink" && typeof message.href === "string") {
        await this.handleLinkClick(message.href, this.currentFile);
        return;
      }

      if (message?.type === "editCurrentFile") {
        await this.openCurrentFileInEditor();
        return;
      }

      if (message?.type === "navigateHistory") {
        await this.navigatePreviewHistory(message.direction);
      }
    });

    return this.previewPanel;
  }

  private async renderPreview(
    panel: vscode.WebviewPanel,
    file: vscode.Uri,
    roots: vscode.Uri[],
    anchor?: string,
  ) {
    const bytes = await vscode.workspace.fs.readFile(file);
    const markdown = Buffer.from(bytes).toString("utf8");
    const webview = panel.webview;
    const renderer = createMarkdownRenderer(webview, file);
    const htmlContent = renderer.render(markdown);
    const title = await getDisplayName(file);

    panel.title = title;
    panel.webview.html = getWebviewContent({
      context: this.context,
      webview,
      htmlContent,
      title,
      anchor,
      file,
      previewHistoryIndex: this.previewHistoryIndex,
      previewHistoryLength: this.previewHistory.length,
    });
    this.currentFile = file;
    this.currentRoots = roots;
    this.currentAnchor = anchor;
  }

  private async handleLinkClick(href: string, baseFile: vscode.Uri) {
    if (href.startsWith("#")) {
      this.previewPanel?.webview.postMessage({
        type: "scrollToAnchor",
        anchor: href,
      });
      return;
    }

    const target = await resolveLinkTarget(baseFile, href);
    if (!target) {
      return;
    }

    if (target.kind === "external") {
      await vscode.env.openExternal(target.uri);
      return;
    }

    if (target.isMarkdown && isWithinDocsRoots(target.uri, this.currentRoots)) {
      await this.openFile(target.uri, {
        roots: this.currentRoots,
        anchor: target.anchor,
      });
      return;
    }

    if (target.anchor) {
      const document = await vscode.workspace.openTextDocument(target.uri);
      const editor = await vscode.window.showTextDocument(document, {
        preview: false,
        preserveFocus: false,
      });
      const anchorLine = findHeadingLine(document, target.anchor.slice(1));
      if (anchorLine !== undefined) {
        const position = new vscode.Position(anchorLine, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position));
      }
      return;
    }

    await vscode.commands.executeCommand("vscode.open", target.uri);
  }

  private pushPreviewHistory(entry: PreviewHistoryEntry) {
    const currentEntry = this.previewHistory[this.previewHistoryIndex];
    if (
      currentEntry &&
      currentEntry.file.fsPath === entry.file.fsPath &&
      currentEntry.anchor === entry.anchor &&
      haveSameRoots(currentEntry.roots, entry.roots)
    ) {
      return;
    }

    this.previewHistory = this.previewHistory.slice(
      0,
      this.previewHistoryIndex + 1,
    );
    this.previewHistory.push(entry);
    this.previewHistoryIndex = this.previewHistory.length - 1;
  }

  private async navigatePreviewHistory(direction: unknown) {
    if (direction !== "back" && direction !== "forward") {
      return;
    }

    const nextIndex =
      direction === "back"
        ? this.previewHistoryIndex - 1
        : this.previewHistoryIndex + 1;
    const nextEntry = this.previewHistory[nextIndex];
    if (!nextEntry) {
      return;
    }

    this.previewHistoryIndex = nextIndex;
    await this.openFile(nextEntry.file, {
      roots: nextEntry.roots,
      anchor: nextEntry.anchor,
      pushHistory: false,
    });
  }

  private async openCurrentFileInEditor() {
    if (!this.currentFile) {
      return;
    }

    const document = await vscode.workspace.openTextDocument(this.currentFile);
    await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false,
    });
  }
}

async function resolveLinkTarget(
  baseFile: vscode.Uri,
  href: string,
): Promise<LinkTarget | undefined> {
  if (!href) {
    return undefined;
  }

  if (isExternalHref(href)) {
    return {
      kind: "external",
      uri: vscode.Uri.parse(href),
    };
  }

  const [rawPath, rawAnchor] = splitHref(href);
  const normalizedPath = decodeURIComponent(rawPath);
  const absolutePath = path.resolve(
    path.dirname(baseFile.fsPath),
    normalizedPath,
  );
  let targetUri = vscode.Uri.file(absolutePath);

  const stat = await tryStat(targetUri);
  if (stat?.type === vscode.FileType.Directory) {
    const readmeUri = await getDirectoryReadme(targetUri);
    if (!readmeUri) {
      return undefined;
    }

    targetUri = readmeUri;
  }

  return {
    kind: "local",
    uri: targetUri,
    isMarkdown: isMarkdownFile(targetUri.fsPath),
    anchor: rawAnchor,
  };
}

function createMarkdownRenderer(
  webview: vscode.Webview,
  currentDocument: vscode.Uri,
): MarkdownIt {
  const markdown = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
  });

  markdown.core.ruler.push("docs_heading_ids", (state) => {
    const slugCounts = new Map<string, number>();
    const tokens = state.tokens;

    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index].type !== "heading_open") {
        continue;
      }

      const inline = tokens[index + 1];
      const text = inline?.content ?? "section";
      const baseSlug = slugify(text);
      const count = slugCounts.get(baseSlug) ?? 0;
      slugCounts.set(baseSlug, count + 1);
      const slug = count === 0 ? baseSlug : `${baseSlug}-${count}`;
      tokens[index].attrSet("id", slug);
    }
  });

  const defaultLinkOpen = markdown.renderer.rules.link_open;
  markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const hrefIndex = tokens[index].attrIndex("href");
    if (hrefIndex >= 0) {
      const href = tokens[index].attrs?.[hrefIndex]?.[1] ?? "";
      tokens[index].attrSet("data-docs-link", href);

      if (isExternalHref(href)) {
        tokens[index].attrSet("target", "_blank");
        tokens[index].attrSet("rel", "noreferrer noopener");
      }
    }

    return defaultLinkOpen
      ? defaultLinkOpen(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options);
  };

  const defaultImage = markdown.renderer.rules.image;
  markdown.renderer.rules.image = (tokens, index, options, env, self) => {
    const sourceIndex = tokens[index].attrIndex("src");
    if (sourceIndex >= 0) {
      const originalSource = tokens[index].attrs?.[sourceIndex]?.[1] ?? "";
      const resolvedSource = resolveImageSource(
        webview,
        currentDocument,
        originalSource,
      );
      if (tokens[index].attrs) {
        tokens[index].attrs[sourceIndex][1] = resolvedSource;
      }
    }

    return defaultImage
      ? defaultImage(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options);
  };

  return markdown;
}

function resolveImageSource(
  webview: vscode.Webview,
  currentDocument: vscode.Uri,
  source: string,
): string {
  if (!source || isExternalHref(source) || source.startsWith("data:")) {
    return source;
  }

  const sanitizedSource = source.split("#", 1)[0];
  if (!sanitizedSource) {
    return source;
  }

  const assetUri = vscode.Uri.file(
    path.resolve(
      path.dirname(currentDocument.fsPath),
      decodeURIComponent(sanitizedSource),
    ),
  );

  return webview.asWebviewUri(assetUri).toString();
}

function getWebviewContent({
  context,
  webview,
  htmlContent,
  title,
  anchor,
  file,
  previewHistoryIndex,
  previewHistoryLength,
}: {
  context: vscode.ExtensionContext;
  webview: vscode.Webview;
  htmlContent: string;
  title: string;
  anchor?: string;
  file: vscode.Uri;
  previewHistoryIndex: number;
  previewHistoryLength: number;
}): string {
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "media", "style.css"),
  );
  const nonce = String(Date.now());
  const initialAnchor = anchor ?? "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <div class="page-shell">
      <div class="page-search" data-search-panel hidden>
        <input
          type="search"
          class="page-search-input"
          data-search-input
          placeholder="Search this document"
          spellcheck="false"
        />
        <span class="page-search-count" data-search-count>0 results</span>
        <button
          type="button"
          class="page-action page-search-action"
          data-search-nav="previous"
          aria-label="Previous result"
          title="Previous"
        >
          <span class="page-action-icon" aria-hidden="true">
            <svg viewBox="0 0 16 16" focusable="false">
              <path d="M11 10 8 6 5 10" />
            </svg>
          </span>
        </button>
        <button
          type="button"
          class="page-action page-search-action"
          data-search-nav="next"
          aria-label="Next result"
          title="Next"
        >
          <span class="page-action-icon" aria-hidden="true">
            <svg viewBox="0 0 16 16" focusable="false">
              <path d="M5 6 8 10 11 6" />
            </svg>
          </span>
        </button>
        <button
          type="button"
          class="page-action page-search-action"
          data-search-close
          aria-label="Close search"
          title="Close search"
        >
          <span class="page-action-icon" aria-hidden="true">
            <svg viewBox="0 0 16 16" focusable="false">
              <path d="M4 4 12 12" />
              <path d="M12 4 4 12" />
            </svg>
          </span>
        </button>
      </div>
      <header class="page-header">
        <div class="page-header-top">
          <div>
            <p class="page-kicker">Side Docs</p>
            <h1>${escapeHtml(title)}</h1>
            <p class="page-path">${escapeHtml(
              vscode.workspace.asRelativePath(file, false),
            )}</p>
          </div>
          <div class="page-actions">
            <button
              type="button"
              class="page-action"
              data-action="search"
              aria-label="Search in document"
              title="Search"
            >
              <span class="page-action-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16" focusable="false">
                  <circle cx="7" cy="7" r="4.25" />
                  <path d="M10.3 10.3 13.25 13.25" />
                </svg>
              </span>
            </button>
            <button
              type="button"
              class="page-action"
              data-action="back"
              aria-label="Go back"
              title="Back"
              ${previewHistoryIndex <= 0 ? "disabled" : ""}
            >
              <span class="page-action-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16" focusable="false">
                  <path d="M9.75 3.25 5 8l4.75 4.75" />
                </svg>
              </span>
            </button>
            <button
              type="button"
              class="page-action"
              data-action="forward"
              aria-label="Go forward"
              title="Forward"
              ${previewHistoryIndex >= previewHistoryLength - 1 ? "disabled" : ""}
            >
              <span class="page-action-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16" focusable="false">
                  <path d="M6.25 3.25 11 8l-4.75 4.75" />
                </svg>
              </span>
            </button>
            <button
              type="button"
              class="page-action page-action-primary"
              data-action="edit"
              aria-label="Edit current file"
              title="Edit"
            >
              <span class="page-action-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16" focusable="false">
                  <path d="M11.85 2.15a1.2 1.2 0 0 1 1.7 1.7l-7.7 7.7-2.6.9.9-2.6 7.7-7.7Z" />
                  <path d="M10.75 3.25 12.75 5.25" />
                </svg>
              </span>
            </button>
          </div>
        </div>
      </header>
      <main class="markdown-body">${htmlContent}</main>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const initialAnchor = ${JSON.stringify(initialAnchor)};
      const searchPanel = document.querySelector('[data-search-panel]');
      const searchInput = document.querySelector('[data-search-input]');
      const searchCount = document.querySelector('[data-search-count]');
      const searchRoot = document.querySelector('.markdown-body');
      const body = document.body;
      let searchMatches = [];
      let activeSearchIndex = -1;

      function isSearchInputFocused() {
        return document.activeElement === searchInput;
      }

      function navigateHistory(direction) {
        vscode.postMessage({ type: 'navigateHistory', direction });
      }

      function normalizeAnchor(anchor) {
        return anchor.startsWith('#') ? anchor.slice(1) : anchor;
      }

      function scrollToAnchor(anchor) {
        const id = normalizeAnchor(anchor);
        if (!id) {
          return;
        }

        const target = document.getElementById(id);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }

      function setSearchCount(activeIndex, total) {
        if (!searchCount) {
          return;
        }

        if (!total) {
          searchCount.textContent = '0 results';
          return;
        }

        if (activeIndex < 0) {
          searchCount.textContent = String(total) + ' results';
          return;
        }

        searchCount.textContent = String(activeIndex + 1) + ' / ' + String(total);
      }

      function clearSearchHighlights() {
        for (const mark of document.querySelectorAll('mark.docs-search-match')) {
          const parent = mark.parentNode;
          if (!parent) {
            continue;
          }

          parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
          parent.normalize();
        }

        searchMatches = [];
        activeSearchIndex = -1;
        setSearchCount(-1, 0);
      }

      function updateActiveSearchMatch(shouldScroll = true) {
        searchMatches.forEach((match, index) => {
          match.classList.toggle('is-active', index === activeSearchIndex);
        });

        if (activeSearchIndex < 0 || activeSearchIndex >= searchMatches.length) {
          setSearchCount(-1, searchMatches.length);
          return;
        }

        const activeMatch = searchMatches[activeSearchIndex];
        if (shouldScroll) {
          activeMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        setSearchCount(activeSearchIndex, searchMatches.length);
      }

      function moveSearch(direction) {
        if (!searchMatches.length) {
          return;
        }

        if (direction === 'previous') {
          activeSearchIndex = (activeSearchIndex - 1 + searchMatches.length) % searchMatches.length;
        } else {
          activeSearchIndex = (activeSearchIndex + 1) % searchMatches.length;
        }

        updateActiveSearchMatch();
      }

      function collectSearchableTextNodes() {
        if (!searchRoot) {
          return [];
        }

        const walker = document.createTreeWalker(searchRoot, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            const parentElement = node.parentElement;
            if (!parentElement) {
              return NodeFilter.FILTER_REJECT;
            }

            if (['SCRIPT', 'STYLE', 'MARK'].includes(parentElement.tagName)) {
              return NodeFilter.FILTER_REJECT;
            }

            if (!node.textContent || !node.textContent.trim()) {
              return NodeFilter.FILTER_REJECT;
            }

            return NodeFilter.FILTER_ACCEPT;
          },
        });

        const nodes = [];
        while (walker.nextNode()) {
          nodes.push(walker.currentNode);
        }

        return nodes;
      }

      function applySearch(query, shouldScrollToFirst = true) {
        clearSearchHighlights();

        const normalizedQuery = query.trim();
        if (!normalizedQuery) {
          return;
        }

        const textNodes = collectSearchableTextNodes();
        const pattern = normalizedQuery.toLowerCase();

        for (const textNode of textNodes) {
          const text = textNode.textContent || '';
          const lowerText = text.toLowerCase();
          let startIndex = 0;
          let foundIndex = lowerText.indexOf(pattern, startIndex);

          if (foundIndex === -1) {
            continue;
          }

          const fragment = document.createDocumentFragment();
          while (foundIndex !== -1) {
            const before = text.slice(startIndex, foundIndex);
            if (before) {
              fragment.appendChild(document.createTextNode(before));
            }

            const match = document.createElement('mark');
            match.className = 'docs-search-match';
            match.textContent = text.slice(foundIndex, foundIndex + pattern.length);
            fragment.appendChild(match);
            searchMatches.push(match);

            startIndex = foundIndex + pattern.length;
            foundIndex = lowerText.indexOf(pattern, startIndex);
          }

          const after = text.slice(startIndex);
          if (after) {
            fragment.appendChild(document.createTextNode(after));
          }

          textNode.parentNode?.replaceChild(fragment, textNode);
        }

        if (!searchMatches.length) {
          setSearchCount(-1, 0);
          return;
        }

        activeSearchIndex = shouldScrollToFirst ? 0 : -1;
        updateActiveSearchMatch(shouldScrollToFirst);
      }

      function openSearchPanel(query = '', keepPosition = false) {
        if (!searchPanel || !searchInput) {
          return;
        }

        searchPanel.hidden = false;
        body.classList.add('search-open');
        if (query) {
          searchInput.value = query;
          applySearch(query, !keepPosition);
        }
        searchInput.focus();
        if (!query) {
          searchInput.select();
        }
      }

      function closeSearchPanel() {
        if (!searchPanel || !searchInput) {
          return;
        }

        searchPanel.hidden = true;
        body.classList.remove('search-open');
        searchInput.value = '';
        clearSearchHighlights();
      }

      document.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'editCurrentFile' });
      });

      document.querySelector('[data-action="search"]')?.addEventListener('click', () => {
        openSearchPanel();
      });

      document.querySelector('[data-action="back"]')?.addEventListener('click', () => {
        navigateHistory('back');
      });

      document.querySelector('[data-action="forward"]')?.addEventListener('click', () => {
        navigateHistory('forward');
      });

      document.querySelector('[data-search-close]')?.addEventListener('click', () => {
        closeSearchPanel();
      });

      document.querySelector('[data-search-nav="previous"]')?.addEventListener('click', () => {
        moveSearch('previous');
      });

      document.querySelector('[data-search-nav="next"]')?.addEventListener('click', () => {
        moveSearch('next');
      });

      searchInput?.addEventListener('input', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
          return;
        }

        applySearch(target.value);
      });

      searchInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          moveSearch(event.shiftKey ? 'previous' : 'next');
          return;
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          closeSearchPanel();
        }
      });

      document.addEventListener('keydown', (event) => {
        const isModifierSearch = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f';
        if (isModifierSearch) {
          event.preventDefault();
          openSearchPanel(searchInput instanceof HTMLInputElement ? searchInput.value : '', true);
          return;
        }

        if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            navigateHistory('back');
            return;
          }

          if (event.key === 'ArrowRight') {
            event.preventDefault();
            navigateHistory('forward');
            return;
          }
        }

        if (event.key === 'Escape' && searchPanel && !searchPanel.hidden && !isSearchInputFocused()) {
          event.preventDefault();
          closeSearchPanel();
        }
      });

      document.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }

        const link = target.closest('a[data-docs-link]');
        if (!link) {
          return;
        }

        const href = link.getAttribute('href');
        if (!href) {
          return;
        }

        if (href.startsWith('#')) {
          event.preventDefault();
          scrollToAnchor(href);
          return;
        }

        event.preventDefault();
        vscode.postMessage({ type: 'openLink', href });
      });

      window.addEventListener('message', (event) => {
        if (event.data?.type === 'scrollToAnchor') {
          scrollToAnchor(event.data.anchor || '');
          return;
        }

        if (event.data?.type === 'openSearch') {
          openSearchPanel(event.data.query || '', Boolean(event.data.keepPosition));
        }
      });

      if (initialAnchor) {
        window.requestAnimationFrame(() => scrollToAnchor(initialAnchor));
      }
    </script>
  </body>
</html>`;
}

function getMissingFileContent(file: vscode.Uri): string {
  return `<!DOCTYPE html>
<html lang="en">
  <body>
    <p>File not found: ${escapeHtml(file.fsPath)}</p>
  </body>
</html>`;
}
