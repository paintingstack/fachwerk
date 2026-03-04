const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const os = require("os");

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const AGENTS_DIR = path.join(CLAUDE_DIR, "agents");
const SKILLS_DIR = path.join(CLAUDE_DIR, "skills");
const GLOBAL_CLAUDE_MD = path.join(CLAUDE_DIR, "CLAUDE.md");
const MAX_FOLDER_SLOTS = 10;

function ensureDirectories() {
  if (!fs.existsSync(AGENTS_DIR)) {
    fs.mkdirSync(AGENTS_DIR, { recursive: true });
  }
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }
}

async function addFolderPaths(paths) {
  const config = vscode.workspace.getConfiguration("fachwerk");
  const folders = config.get("folders", []);
  const newFolders = [...folders];

  for (const folderPath of paths) {
    if (newFolders.length >= MAX_FOLDER_SLOTS) {
      vscode.window.showWarningMessage(
        `Fachwerk supports up to ${MAX_FOLDER_SLOTS} folder sections`
      );
      break;
    }
    if (!fs.existsSync(folderPath)) continue;
    const stats = fs.statSync(folderPath);
    if (!stats.isDirectory()) continue;
    if (newFolders.includes(folderPath)) continue;
    newFolders.push(folderPath);
  }

  if (newFolders.length > folders.length) {
    await config.update(
      "folders",
      newFolders,
      vscode.ConfigurationTarget.Global
    );
  }
}

function isValidName(name) {
  return !name.includes("/") && !name.includes("\\") && !name.includes("..");
}

function readDirectory(directory, fileContextValue) {
  if (!fs.existsSync(directory)) return [];

  try {
    const items = fs.readdirSync(directory, { withFileTypes: true });
    return items
      .filter((item) => !item.name.startsWith("."))
      .map((item) => {
        const itemPath = path.join(directory, item.name);
        const isDirectory = item.isDirectory();

        const treeItem = new vscode.TreeItem(
          item.name,
          isDirectory
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None
        );

        if (isDirectory) {
          treeItem.contextValue = "folder";
          treeItem.iconPath = new vscode.ThemeIcon("folder");
        } else {
          treeItem.command = {
            command: "vscode.open",
            title: "Open",
            arguments: [vscode.Uri.file(itemPath)],
          };
          treeItem.contextValue = fileContextValue;
          treeItem.iconPath = new vscode.ThemeIcon("file");
        }

        treeItem.resourceUri = vscode.Uri.file(itemPath);
        return treeItem;
      })
      .sort((a, b) => {
        if (a.contextValue === "folder" && b.contextValue !== "folder")
          return -1;
        if (a.contextValue !== "folder" && b.contextValue === "folder")
          return 1;
        return a.label.localeCompare(b.label);
      });
  } catch (err) {
    console.error(`Fachwerk: failed to read ${directory}:`, err.message);
    return [];
  }
}

class ItemProvider {
  constructor(rootDir, itemType) {
    this.rootDir = rootDir;
    this.itemType = itemType;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    const directory = element ? element.resourceUri.fsPath : this.rootDir;
    return readDirectory(directory, this.itemType);
  }
}

class FolderSlotProvider {
  constructor() {
    this.folderPath = null;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this._watcher = null;
  }

  setFolder(folderPath) {
    this.folderPath = folderPath;
    if (this._watcher) {
      this._watcher.dispose();
      this._watcher = null;
    }
    if (folderPath && fs.existsSync(folderPath)) {
      this._watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folderPath, "**/*")
      );
      this._watcher.onDidCreate(() => this.refresh());
      this._watcher.onDidDelete(() => this.refresh());
      this._watcher.onDidChange(() => this.refresh());
    }
    this._onDidChangeTreeData.fire();
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  dispose() {
    if (this._watcher) this._watcher.dispose();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (!this.folderPath) return [];
    const directory = element ? element.resourceUri.fsPath : this.folderPath;
    return readDirectory(directory, "folderFile");
  }
}

class ClaudeMdProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren() {
    const items = [];

    if (fs.existsSync(GLOBAL_CLAUDE_MD)) {
      const item = new vscode.TreeItem(
        "Global CLAUDE.md",
        vscode.TreeItemCollapsibleState.None
      );
      item.command = {
        command: "vscode.open",
        title: "Open",
        arguments: [vscode.Uri.file(GLOBAL_CLAUDE_MD)],
      };
      item.contextValue = "claudemd";
      item.iconPath = new vscode.ThemeIcon("book");
      item.resourceUri = vscode.Uri.file(GLOBAL_CLAUDE_MD);
      item.description = "~/.claude/";
      items.push(item);
    }

    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    for (const folder of workspaceFolders) {
      const dotClaudePath = path.join(
        folder.uri.fsPath,
        ".claude",
        "CLAUDE.md"
      );
      const rootPath = path.join(folder.uri.fsPath, "CLAUDE.md");

      if (fs.existsSync(dotClaudePath)) {
        const item = new vscode.TreeItem(
          "Project CLAUDE.md",
          vscode.TreeItemCollapsibleState.None
        );
        item.command = {
          command: "vscode.open",
          title: "Open",
          arguments: [vscode.Uri.file(dotClaudePath)],
        };
        item.contextValue = "claudemd";
        item.iconPath = new vscode.ThemeIcon("book");
        item.resourceUri = vscode.Uri.file(dotClaudePath);
        item.description = folder.name;
        items.push(item);
      } else if (fs.existsSync(rootPath)) {
        const item = new vscode.TreeItem(
          "Project CLAUDE.md",
          vscode.TreeItemCollapsibleState.None
        );
        item.command = {
          command: "vscode.open",
          title: "Open",
          arguments: [vscode.Uri.file(rootPath)],
        };
        item.contextValue = "claudemd";
        item.iconPath = new vscode.ThemeIcon("book");
        item.resourceUri = vscode.Uri.file(rootPath);
        item.description = folder.name;
        items.push(item);
      }
    }

    return items;
  }
}

function activate(context) {
  ensureDirectories();

  const agentsProvider = new ItemProvider(AGENTS_DIR, "agent");
  const skillsProvider = new ItemProvider(SKILLS_DIR, "skill");
  const claudeMdProvider = new ClaudeMdProvider();

  vscode.window.createTreeView("fachwerkAgents", {
    treeDataProvider: agentsProvider,
    showCollapseAll: true,
  });

  vscode.window.createTreeView("fachwerkSkills", {
    treeDataProvider: skillsProvider,
    showCollapseAll: true,
  });

  vscode.window.createTreeView("fachwerkClaudeMd", {
    treeDataProvider: claudeMdProvider,
  });

  // Empty folders view (shows only when no folders configured)
  vscode.window.registerTreeDataProvider("fachwerkFolders", {
    getTreeItem: (e) => e,
    getChildren: () => [],
  });

  // Folder slots
  const folderSlots = [];
  const folderViews = [];
  for (let i = 0; i < MAX_FOLDER_SLOTS; i++) {
    const provider = new FolderSlotProvider();
    const view = vscode.window.createTreeView(`fachwerkFolder${i}`, {
      treeDataProvider: provider,
      showCollapseAll: true,
    });
    folderSlots.push(provider);
    folderViews.push(view);
  }

  function updateFolderSlots() {
    const folders = vscode.workspace
      .getConfiguration("fachwerk")
      .get("folders", []);

    for (let i = 0; i < MAX_FOLDER_SLOTS; i++) {
      if (i < folders.length) {
        folderSlots[i].setFolder(folders[i]);
        folderViews[i].title = path.basename(folders[i]);
        vscode.commands.executeCommand(
          "setContext",
          `fachwerk.hasFolder${i}`,
          true
        );
      } else {
        folderSlots[i].setFolder(null);
        vscode.commands.executeCommand(
          "setContext",
          `fachwerk.hasFolder${i}`,
          false
        );
      }
    }
  }

  updateFolderSlots();

  // File watchers for agents/skills
  const agentsWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(AGENTS_DIR, "**/*")
  );
  const skillsWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(SKILLS_DIR, "**/*")
  );

  agentsWatcher.onDidCreate(() => agentsProvider.refresh());
  agentsWatcher.onDidDelete(() => agentsProvider.refresh());
  agentsWatcher.onDidChange(() => agentsProvider.refresh());

  skillsWatcher.onDidCreate(() => skillsProvider.refresh());
  skillsWatcher.onDidDelete(() => skillsProvider.refresh());
  skillsWatcher.onDidChange(() => skillsProvider.refresh());

  const claudeMdWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(CLAUDE_DIR, "CLAUDE.md")
  );
  claudeMdWatcher.onDidCreate(() => claudeMdProvider.refresh());
  claudeMdWatcher.onDidDelete(() => claudeMdProvider.refresh());
  claudeMdWatcher.onDidChange(() => claudeMdProvider.refresh());

  function watchProjectClaudeMd() {
    const watchers = [];
    for (const folder of vscode.workspace.workspaceFolders || []) {
      const w1 = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, ".claude/CLAUDE.md")
      );
      const w2 = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, "CLAUDE.md")
      );
      for (const w of [w1, w2]) {
        w.onDidCreate(() => claudeMdProvider.refresh());
        w.onDidDelete(() => claudeMdProvider.refresh());
        w.onDidChange(() => claudeMdProvider.refresh());
        watchers.push(w);
      }
    }
    return watchers;
  }

  let projectClaudeMdWatchers = watchProjectClaudeMd();
  context.subscriptions.push(...projectClaudeMdWatchers);

  vscode.workspace.onDidChangeWorkspaceFolders(() => {
    for (const w of projectClaudeMdWatchers) w.dispose();
    projectClaudeMdWatchers = watchProjectClaudeMd();
    context.subscriptions.push(...projectClaudeMdWatchers);
    claudeMdProvider.refresh();
  });

  vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("fachwerk.folders")) {
      updateFolderSlots();
    }
  });

  // Commands
  const addAgent = vscode.commands.registerCommand(
    "fachwerk.addAgent",
    async () => {
      const name = await vscode.window.showInputBox({
        prompt: "Agent name",
        placeHolder: "e.g., code-reviewer",
      });

      if (!name) return;
      if (!isValidName(name)) {
        vscode.window.showErrorMessage("Name cannot contain path separators or '..'");
        return;
      }

      const agentDir = path.join(AGENTS_DIR, name);
      const filePath = path.join(agentDir, `${name}.md`);

      if (fs.existsSync(agentDir)) {
        vscode.window.showErrorMessage(`Agent "${name}" already exists`);
        return;
      }

      const template = `---
name: ${name}
description: Describe what this agent does
tools:
  - Read
  - Glob
  - Grep
---

# Instructions

Write your agent instructions here.
`;

      try {
        fs.mkdirSync(agentDir, { recursive: true });
        fs.writeFileSync(filePath, template, "utf8");
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc);
        agentsProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to create agent: ${err.message}`
        );
      }
    }
  );

  const addSkill = vscode.commands.registerCommand(
    "fachwerk.addSkill",
    async () => {
      const name = await vscode.window.showInputBox({
        prompt: "Skill name",
        placeHolder: "e.g., commit",
      });

      if (!name) return;
      if (!isValidName(name)) {
        vscode.window.showErrorMessage("Name cannot contain path separators or '..'");
        return;
      }

      const skillDir = path.join(SKILLS_DIR, name);
      const filePath = path.join(skillDir, "SKILL.md");

      if (fs.existsSync(skillDir)) {
        vscode.window.showErrorMessage(`Skill "${name}" already exists`);
        return;
      }

      const template = `---
name: ${name}
description: Describe what this skill does
user_invocable: true
---

# Instructions

Write your skill instructions here.
`;

      try {
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(filePath, template, "utf8");
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc);
        skillsProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to create skill: ${err.message}`
        );
      }
    }
  );

  const addFolder = vscode.commands.registerCommand(
    "fachwerk.addFolder",
    async (uri) => {
      if (uri && uri.fsPath) {
        await addFolderPaths([uri.fsPath]);
        return;
      }

      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Add Folder",
      });

      if (!uris || uris.length === 0) return;
      await addFolderPaths([uris[0].fsPath]);
    }
  );

  // Remove folder commands (one per slot)
  for (let i = 0; i < MAX_FOLDER_SLOTS; i++) {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        `fachwerk.removeFolder${i}`,
        async () => {
          const config = vscode.workspace.getConfiguration("fachwerk");
          const folders = config.get("folders", []);
          if (i >= folders.length) return;
          const updated = [...folders];
          updated.splice(i, 1);
          await config.update(
            "folders",
            updated,
            vscode.ConfigurationTarget.Global
          );
        }
      )
    );
  }

  const copyItem = vscode.commands.registerCommand(
    "fachwerk.copyItem",
    async (item) => {
      if (!item || !item.resourceUri) return;
      try {
        const content = fs.readFileSync(item.resourceUri.fsPath, "utf8");
        await vscode.env.clipboard.writeText(content);
        vscode.window.showInformationMessage(`Copied: ${item.label}`);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to copy: ${err.message}`);
      }
    }
  );

  const deleteItem = vscode.commands.registerCommand(
    "fachwerk.deleteItem",
    async (item) => {
      if (!item || !item.resourceUri) return;
      const isFolder = item.contextValue === "folder";
      const itemType = isFolder ? "folder" : item.contextValue;

      const result = await vscode.window.showWarningMessage(
        `Delete ${itemType} "${item.label}"?`,
        "Delete",
        "Cancel"
      );

      if (result === "Delete") {
        try {
          const targetPath = item.resourceUri.fsPath;
          const stats = fs.statSync(targetPath);
          if (stats.isDirectory()) {
            fs.rmSync(targetPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(targetPath);
          }
          agentsProvider.refresh();
          skillsProvider.refresh();
          claudeMdProvider.refresh();
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to delete: ${err.message}`);
        }
      }
    }
  );

  const renameItem = vscode.commands.registerCommand(
    "fachwerk.renameItem",
    async (item) => {
      if (!item || !item.resourceUri) return;
      const newName = await vscode.window.showInputBox({
        prompt: "Enter new name",
        value: item.label,
      });

      if (!newName || newName === item.label) return;
      if (!isValidName(newName)) {
        vscode.window.showErrorMessage("Name cannot contain path separators or '..'");
        return;
      }

      const parentDir = path.dirname(item.resourceUri.fsPath);
      const newPath = path.join(parentDir, newName);

      if (fs.existsSync(newPath)) {
        vscode.window.showErrorMessage(`"${newName}" already exists`);
        return;
      }

      try {
        fs.renameSync(item.resourceUri.fsPath, newPath);
        agentsProvider.refresh();
        skillsProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to rename: ${err.message}`);
      }
    }
  );

  const refresh = vscode.commands.registerCommand("fachwerk.refresh", () => {
    agentsProvider.refresh();
    skillsProvider.refresh();
    claudeMdProvider.refresh();
    for (const slot of folderSlots) slot.refresh();
  });

  context.subscriptions.push(
    addAgent,
    addSkill,
    addFolder,
    copyItem,
    deleteItem,
    renameItem,
    refresh,
    agentsWatcher,
    skillsWatcher,
    claudeMdWatcher,
    ...folderSlots
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
