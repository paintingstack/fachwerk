const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const AGENTS_DIR = path.join(CLAUDE_DIR, 'agents');
const SKILLS_DIR = path.join(CLAUDE_DIR, 'skills');

function ensureDirectories() {
    if (!fs.existsSync(AGENTS_DIR)) {
        fs.mkdirSync(AGENTS_DIR, { recursive: true });
    }
    if (!fs.existsSync(SKILLS_DIR)) {
        fs.mkdirSync(SKILLS_DIR, { recursive: true });
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

    getParent(element) {
        if (!element || !element.resourceUri) return null;
        const parentPath = path.dirname(element.resourceUri.fsPath);
        if (parentPath === this.rootDir) return null;

        const parentName = path.basename(parentPath);
        const item = new vscode.TreeItem(parentName, vscode.TreeItemCollapsibleState.Collapsed);
        item.contextValue = 'folder';
        item.resourceUri = vscode.Uri.file(parentPath);
        return item;
    }

    getChildren(element) {
        const directory = element ? element.resourceUri.fsPath : this.rootDir;

        if (!fs.existsSync(directory)) {
            return [];
        }

        try {
            const items = fs.readdirSync(directory, { withFileTypes: true });
            return items
                .filter(item => !item.name.startsWith('.'))
                .map(item => {
                    const itemPath = path.join(directory, item.name);
                    const isDirectory = item.isDirectory();

                    const treeItem = new vscode.TreeItem(
                        item.name,
                        isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
                    );

                    if (isDirectory) {
                        treeItem.contextValue = 'folder';
                        treeItem.iconPath = new vscode.ThemeIcon('folder');
                    } else {
                        treeItem.command = {
                            command: 'vscode.open',
                            title: 'Open',
                            arguments: [vscode.Uri.file(itemPath)]
                        };
                        treeItem.contextValue = this.itemType;
                        treeItem.iconPath = new vscode.ThemeIcon('file');
                    }

                    treeItem.resourceUri = vscode.Uri.file(itemPath);
                    return treeItem;
                })
                .sort((a, b) => {
                    if (a.contextValue === 'folder' && b.contextValue !== 'folder') return -1;
                    if (a.contextValue !== 'folder' && b.contextValue === 'folder') return 1;
                    return a.label.localeCompare(b.label);
                });
        } catch (err) {
            return [];
        }
    }
}

function activate(context) {
    ensureDirectories();

    const agentsProvider = new ItemProvider(AGENTS_DIR, 'agent');
    const skillsProvider = new ItemProvider(SKILLS_DIR, 'skill');

    vscode.window.createTreeView('fachwerkAgents', {
        treeDataProvider: agentsProvider,
        showCollapseAll: true
    });

    vscode.window.createTreeView('fachwerkSkills', {
        treeDataProvider: skillsProvider,
        showCollapseAll: true
    });

    const agentsWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(AGENTS_DIR, '**/*')
    );
    const skillsWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(SKILLS_DIR, '**/*')
    );

    agentsWatcher.onDidCreate(() => agentsProvider.refresh());
    agentsWatcher.onDidDelete(() => agentsProvider.refresh());
    agentsWatcher.onDidChange(() => agentsProvider.refresh());

    skillsWatcher.onDidCreate(() => skillsProvider.refresh());
    skillsWatcher.onDidDelete(() => skillsProvider.refresh());
    skillsWatcher.onDidChange(() => skillsProvider.refresh());

    const addAgent = vscode.commands.registerCommand('fachwerk.addAgent', async () => {
        const name = await vscode.window.showInputBox({
            prompt: 'Agent name',
            placeHolder: 'e.g., code-reviewer'
        });

        if (!name) return;

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
            fs.writeFileSync(filePath, template, 'utf8');
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc);
            agentsProvider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to create agent: ${err.message}`);
        }
    });

    const addSkill = vscode.commands.registerCommand('fachwerk.addSkill', async () => {
        const name = await vscode.window.showInputBox({
            prompt: 'Skill name',
            placeHolder: 'e.g., commit'
        });

        if (!name) return;

        const skillDir = path.join(SKILLS_DIR, name);
        const filePath = path.join(skillDir, 'SKILL.md');

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
            fs.writeFileSync(filePath, template, 'utf8');
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc);
            skillsProvider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to create skill: ${err.message}`);
        }
    });

    const copyItem = vscode.commands.registerCommand('fachwerk.copyItem', async (item) => {
        try {
            const content = fs.readFileSync(item.resourceUri.fsPath, 'utf8');
            await vscode.env.clipboard.writeText(content);
            vscode.window.showInformationMessage(`Copied: ${item.label}`);
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to copy: ${err.message}`);
        }
    });

    const deleteItem = vscode.commands.registerCommand('fachwerk.deleteItem', async (item) => {
        const isFolder = item.contextValue === 'folder';
        const itemType = isFolder ? 'folder' : item.contextValue;

        const result = await vscode.window.showWarningMessage(
            `Delete ${itemType} "${item.label}"?`,
            'Delete',
            'Cancel'
        );

        if (result === 'Delete') {
            try {
                if (isFolder || item.contextValue === 'skill') {
                    fs.rmSync(item.resourceUri.fsPath, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(item.resourceUri.fsPath);
                }
                agentsProvider.refresh();
                skillsProvider.refresh();
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to delete: ${err.message}`);
            }
        }
    });

    const renameItem = vscode.commands.registerCommand('fachwerk.renameItem', async (item) => {
        const newName = await vscode.window.showInputBox({
            prompt: 'Enter new name',
            value: item.label
        });

        if (!newName || newName === item.label) return;

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
    });

    const refresh = vscode.commands.registerCommand('fachwerk.refresh', () => {
        agentsProvider.refresh();
        skillsProvider.refresh();
    });

    context.subscriptions.push(
        addAgent,
        addSkill,
        copyItem,
        deleteItem,
        renameItem,
        refresh,
        agentsWatcher,
        skillsWatcher
    );
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
