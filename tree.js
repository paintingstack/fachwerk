const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

/** Resolves links when possible. @param {string} filePath File or directory. @returns {string} Target path. */
function realPath(filePath) {
  try { return fs.realpathSync(filePath); } catch { return filePath; }
}

/** Creates an openable file or expandable folder. @param {string} filePath Item path. @returns {object} Tree item. */
function createItem(filePath) {
  const isDirectory = fs.statSync(filePath).isDirectory();
  const item = new vscode.TreeItem(path.basename(filePath), isDirectory
    ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
  item.resourceUri = vscode.Uri.file(filePath);
  item.contextValue = isDirectory ? "folder" : "file";
  item.iconPath = new vscode.ThemeIcon(item.contextValue);
  if (!isDirectory) {
    item.command = { command: "vscode.open", title: "Open", arguments: [vscode.Uri.file(realPath(filePath))] };
  }
  return item;
}

/** Explains a directory read failure in the tree. @param {string} directory Directory. @param {object} error Filesystem error. @returns {object} Message item. */
function directoryError(directory, error) {
  const missing = error.code === "ENOENT";
  const item = new vscode.TreeItem(missing ? "Folder not found" : "Cannot read this folder", vscode.TreeItemCollapsibleState.None);
  item.contextValue = "message";
  item.iconPath = new vscode.ThemeIcon("warning");
  item.tooltip = missing ? `${directory}\nReconnect the drive or check the folder path, then refresh.`
    : `${directory}\nCheck your folder permissions, then refresh.`;
  return item;
}

/** Reads children, including hidden entries and linked directories. @param {string} directory Directory path. @returns {object[]} Items. */
function readDirectory(directory) {
  try {
    return fs.readdirSync(directory)
      .flatMap((name) => {
        try { return [createItem(path.join(directory, name))]; } catch { return []; }
      })
      .sort((first, second) => {
        if (first.contextValue !== second.contextValue) return first.contextValue === "folder" ? -1 : 1;
        return first.label.localeCompare(second.label);
      });
  } catch (error) {
    console.error(`Fachwerk: failed to read ${directory}: ${error.message}`);
    return [directoryError(directory, error)];
  }
}

/** Finds saved files and first existing workspace alternatives. @param {object} section Saved section. @returns {object[]} Candidates with scope. */
function fileCandidates(section) {
  const candidates = (section.files || []).map((filePath) => ({ scope: "Global", filePath }));
  for (const folder of vscode.workspace.workspaceFolders || []) {
    for (const alternatives of section.workspaceFiles || []) {
      const filePath = alternatives.map((relativePath) => path.join(folder.uri.fsPath, relativePath))
        .find((candidate) => fs.existsSync(candidate));
      if (filePath) candidates.push({ scope: "Project", filePath, folder: folder.name });
    }
  }
  return candidates;
}

/** Lists each real file once while keeping collections read only. @param {object} section Saved section. @returns {object[]} File items. */
function readFiles(section) {
  const entries = new Map();
  for (const candidate of fileCandidates(section)) {
    if (!fs.existsSync(candidate.filePath)) continue;
    const target = realPath(candidate.filePath);
    if (!entries.has(target)) entries.set(target, { ...candidate, aliases: [] });
    entries.get(target).aliases.push(candidate.filePath);
  }
  return [...entries].flatMap(([target, entry]) => {
    try {
      const item = createItem(target);
      if (item.contextValue === "folder") return [];
      item.contextValue = "referenceFile";
      item.label = `${entry.scope} ${path.basename(target)}`;
      item.description = entry.folder || path.dirname(target).replace(os.homedir(), "~") + "/";
      item.tooltip = `${target}\nRead as: ${entry.aliases.join(", ")}`;
      return [item];
    } catch { return []; }
  });
}

class SectionProvider {
  constructor() {
    this.section = null;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.watchers = new Map();
    this.sourceTargets = new Map();
    this.expandedLinks = new Set();
    this.isDisposed = false;
  }

  /** Refreshes the tree. @returns {void} */
  refresh() { this.emitter.fire(); }

  /** Rebinds watchers if an observed link has moved. @returns {void} */
  handleChange() {
    if (this.isDisposed) return;
    const changed = [...this.sourceTargets].some(([source, target]) => realPath(source) !== target);
    if (changed) this.setSection(this.section);
    this.refresh();
  }

  /** Returns a tree item. @param {object} element Item. @returns {object} Item. */
  getTreeItem(element) { return element; }

  /** Returns section contents and observes expanded linked directories. @param {object} element Optional parent. @returns {object[]} Children. */
  getChildren(element) {
    if (element?.resourceUri) {
      const directory = element.resourceUri.fsPath;
      if (realPath(directory) !== directory) {
        this.expandedLinks.add(directory);
        this.watchDirectory(directory);
      }
      return readDirectory(directory);
    }
    if (!this.section) return [];
    if (this.section.folder) return readDirectory(this.section.folder);
    return readFiles(this.section);
  }

  /** Watches a deduplicated directory pattern. @param {string} directory Directory. @param {string} pattern Glob. @returns {void} */
  watch(directory, pattern) {
    const key = `${directory}\n${pattern}`;
    if (this.watchers.has(key)) return;
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(directory, pattern));
    watcher.onDidCreate(() => this.handleChange());
    watcher.onDidDelete(() => this.handleChange());
    watcher.onDidChange(() => this.handleChange());
    this.watchers.set(key, watcher);
  }

  /** Watches creation, deletion, or replacement of a source path. @param {string} source Source path. @returns {void} */
  watchSource(source) {
    this.sourceTargets.set(source, realPath(source));
    let directory = path.dirname(source);
    while (!fs.existsSync(directory) && path.dirname(directory) !== directory) directory = path.dirname(directory);
    this.watch(directory, path.relative(directory, source).split(path.sep).join("/"));
  }

  /** Watches a directory target and its alias. @param {string} directory Directory path. @returns {void} */
  watchDirectory(directory) {
    this.watch(realPath(directory), "**/*");
    this.watchSource(directory);
  }

  /** Watches a referenced file and its alias. @param {string} filePath File path. @returns {void} */
  watchFile(filePath) {
    this.watchSource(filePath);
    const target = realPath(filePath);
    if (target !== filePath) this.watchSource(target);
  }

  /** Replaces the section and refreshes all observed link targets. @param {object|null} section Section. @returns {void} */
  setSection(section) {
    if (this.section?.folder !== section?.folder) this.expandedLinks.clear();
    this.watchers.forEach((watcher) => watcher.dispose());
    this.watchers.clear();
    this.sourceTargets.clear();
    this.section = section;
    if (section?.folder) this.watchDirectory(section.folder);
    for (const filePath of section?.files || []) this.watchFile(filePath);
    for (const folder of vscode.workspace.workspaceFolders || []) {
      for (const alternatives of section?.workspaceFiles || []) {
        alternatives.forEach((relativePath) => this.watchFile(path.join(folder.uri.fsPath, relativePath)));
      }
    }
    for (const directory of this.expandedLinks) this.watchDirectory(directory);
    this.refresh();
  }

  /** Releases watchers and events. @returns {void} */
  dispose() {
    this.isDisposed = true;
    this.watchers.forEach((watcher) => watcher.dispose());
    this.watchers.clear();
    this.emitter.dispose();
  }
}

module.exports = { SectionProvider, realPath };
