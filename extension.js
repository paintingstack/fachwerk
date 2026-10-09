const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const { migrateLayout } = require("./migration");
const { SectionProvider, realPath } = require("./tree");

const MAX_FOLDERS = 10;
const FOLDER_SLOTS_KEY = "folderViewSlots";
// Preserve view identifiers so VS Code keeps existing layout and visibility.
const SAVED_SECTION_VIEWS = ["fachwerkAgents", "fachwerkSkills", "fachwerkClaudeMd"];
const FOLDER_VIEWS = Array.from({ length: MAX_FOLDERS }, (_, index) => `fachwerkFolder${index}`);
let settingsQueue = Promise.resolve();

/** Serializes settings changes, allowing a failed write to be retried. @param {Function} operation Mutation. @returns {Promise<void>} Completion. */
function changeSettings(operation) {
  settingsQueue = settingsQueue.then(operation, operation);
  return settingsQueue;
}

/** Reads global pins with optional workspace overrides. @param {string} key Setting. @returns {object} Values and write target. */
function configuredList(key) {
  const configuration = vscode.workspace.getConfiguration("fachwerk");
  const inspection = configuration.inspect(key);
  const target = inspection?.workspaceValue !== undefined
    ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  return { configuration, values: configuration.get(key, []), target };
}

/** Adds existing folders without duplicate saved or linked targets. @param {string[]} paths Folder paths. @returns {Promise<void>} Completion. */
async function addFolderPaths(paths) {
  await changeSettings(async () => {
    const { configuration, values, target } = configuredList("folders");
    const sections = configuredList("sections");
    const folders = [...values];
    let sectionsChanged = false;
    for (const folderPath of paths) {
      const sectionIndex = sections.values.findIndex((section) => section.folder && realPath(section.folder) === realPath(folderPath));
      if (sectionIndex >= 0) {
        sections.values = sections.values.map((section, index) => index === sectionIndex ? { ...section, enabled: true } : section);
        sectionsChanged = true;
        continue;
      }
      if (folders.some((saved) => realPath(saved) === realPath(folderPath))) continue;
      if (folders.length >= MAX_FOLDERS) {
        vscode.window.showWarningMessage(`Fachwerk supports up to ${MAX_FOLDERS} folder sections.`);
        break;
      }
      try {
        if (fs.statSync(folderPath).isDirectory()) folders.push(folderPath);
      } catch (error) {
        console.error("Fachwerk: could not add folder", error);
        vscode.window.showErrorMessage("Could not open that folder. Check that it exists and you have permission to read it.");
      }
    }
    if (sectionsChanged) await sections.configuration.update("sections", sections.values, sections.target);
    if (folders.length !== values.length) await configuration.update("folders", folders, target);
  });
}

/** Removes a pin or hides a saved section without deleting files. @param {string} key Setting. @param {string|object} value Pin. @returns {Promise<void>} Completion. */
async function removePin(key, value) {
  if (!value) return;
  await changeSettings(async () => {
    const { configuration, values, target } = configuredList(key);
    const updated = key === "sections"
      ? values.map((section) => JSON.stringify(section) === JSON.stringify(value) ? { ...section, enabled: false } : section)
      : values.filter((folderPath) => folderPath !== value);
    await configuration.update(key, updated, target);
  });
}

/** Selects saved folders and file sections to keep in the sidebar. @returns {Promise<void>} Completion. */
async function manageFolders() {
  const lists = ["sections", "folders"].map((key) => ({ key, ...configuredList(key) }));
  const choices = lists.flatMap(({ key, values }) => values.map((value, index) => ({
    label: key === "sections" ? value.name : path.basename(value) || value,
    description: key === "sections" ? value.folder || "File collection" : value,
    picked: key === "folders" || value.enabled !== false, identifier: `${key}:${index}`,
  })));
  const selected = await vscode.window.showQuickPick(choices, {
    canPickMany: true, title: "Manage Folders", placeHolder: "Check sections to show them, uncheck to remove them from the sidebar",
  });
  if (selected === undefined) return;
  const retained = new Set(selected.map((choice) => choice.identifier));
  await changeSettings(async () => {
    for (const previous of lists) {
      const current = configuredList(previous.key);
      if (current.target !== previous.target) throw new Error("Folder settings changed while the list was open.");
      const changes = new Map(previous.values.map((value, index) => [JSON.stringify(value), retained.has(`${previous.key}:${index}`)]));
      const updated = previous.key === "sections"
        ? current.values.map((section) => changes.has(JSON.stringify(section)) ? { ...section, enabled: changes.get(JSON.stringify(section)) } : section)
        : current.values.filter((folderPath) => changes.get(JSON.stringify(folderPath)) !== false);
      if (JSON.stringify(updated) !== JSON.stringify(current.values)) {
        await current.configuration.update(previous.key, updated, current.target);
      }
    }
  });
}

/** Keeps folder identities attached to their existing view slots. @param {string[]} previous Saved slots. @param {string[]} folders Current pins. @returns {Array<string|null>} Assigned slots. */
function assignFolderSlots(previous, folders) {
  const remaining = [...folders];
  const slots = Array.from({ length: MAX_FOLDERS }, (_, index) => {
    const folderPath = previous[index];
    const position = folderPath ? remaining.indexOf(folderPath) : -1;
    if (position < 0) return null;
    remaining.splice(position, 1);
    return folderPath;
  });
  for (const folderPath of remaining) {
    const slot = slots.indexOf(null);
    if (slot < 0) break;
    slots[slot] = folderPath;
  }
  return slots;
}

/** Checks a single file or folder name. @param {string} name Name. @returns {boolean} Valid name. */
function isValidName(name) {
  return name.trim().length > 0 && !name.includes("/") && !name.includes("\\") && !name.includes("..");
}

/** Renames files inside browsed folders. @param {object} item Sidebar item. @returns {Promise<void>} Completion. */
async function renameItem(item) {
  if (!item?.resourceUri) return;
  if (item.contextValue === "referenceFile") throw new Error("Files in collections can be opened and copied, but cannot be renamed here.");
  const oldPath = item.resourceUri.fsPath;
  const name = await vscode.window.showInputBox({ prompt: "Enter new name", value: path.basename(oldPath) });
  if (!name || name === path.basename(oldPath)) return;
  if (!isValidName(name)) throw new Error("Name cannot contain path separators or '..'.");
  const destination = path.join(path.dirname(oldPath), name);
  if (fs.existsSync(destination)) throw new Error(`"${name}" already exists.`);
  await vscode.workspace.fs.rename(item.resourceUri, vscode.Uri.file(destination), { overwrite: false });
}

/** Sends items inside browsed folders to Trash. @param {object} item Sidebar item. @returns {Promise<void>} Completion. */
async function deleteItem(item) {
  if (!item?.resourceUri) return;
  if (item.contextValue === "referenceFile") throw new Error("Files in collections can be opened and copied, but cannot be moved to Trash here.");
  const choice = await vscode.window.showWarningMessage(`Move "${path.basename(item.resourceUri.fsPath)}" to Trash?`, "Move to Trash");
  if (choice === "Move to Trash") await vscode.workspace.fs.delete(item.resourceUri, { recursive: true, useTrash: true });
}

/** Registers a command with visible failures and diagnostic details. @param {object} options Context, identifier, and handler. @returns {void} */
function registerCommand({ context, identifier, handler }) {
  context.subscriptions.push(vscode.commands.registerCommand(identifier, async (...arguments_) => {
    try { await handler(...arguments_); } catch (error) {
      console.error(`Fachwerk: ${identifier} failed`, error);
      const messages = {
        "fachwerk.addFolder": "Could not save your folders. Please try again.",
        "fachwerk.manageFolders": "Could not save your selection. Open Manage Folders and try again.",
        "fachwerk.copyItem": "Could not copy the file. Check that it exists and can be read.",
        "fachwerk.copyPath": "Could not copy the path. Please try again.",
        "fachwerk.renameItem": itemError(arguments_[0], "rename", "Could not rename the item. Check the name, folder permissions, and whether the name is already in use."),
        "fachwerk.deleteItem": itemError(arguments_[0], "delete", "Could not move the item to Trash. Check that it exists and you have permission."),
      };
      vscode.window.showErrorMessage(messages[identifier] || "Could not update your sidebar. Please try again.");
    }
  }));
}

/** Explains unavailable actions on file references. @param {object} item Item. @param {string} action Action. @param {string} fallback Message. @returns {string} Message. */
function itemError(item, action, fallback) {
  if (item?.contextValue === "referenceFile") return `Open the file from its folder to ${action} it. File collections only open and copy files.`;
  return fallback;
}

/** Starts the folder sidebar and migrates saved views. @param {object} context Extension context. @returns {Promise<void>} Completion. */
async function activate(context) {
  const chooseFolders = await migrateLayout({ vscode, context });
  const providers = new Map();
  const views = new Map();
  let folderSlots = [];
  let renderQueue = Promise.resolve();
  for (const identifier of [...SAVED_SECTION_VIEWS, ...FOLDER_VIEWS]) {
    const provider = new SectionProvider();
    const view = vscode.window.createTreeView(identifier, { treeDataProvider: provider, showCollapseAll: true });
    providers.set(identifier, provider);
    views.set(identifier, view);
    context.subscriptions.push(provider, view);
  }
  context.subscriptions.push(vscode.window.registerTreeDataProvider("fachwerkFolders", {
    getTreeItem: (element) => element, getChildren: () => [],
  }));

  /** Applies current settings while preserving panel identities. @returns {Promise<void>} Completion. */
  async function renderViews() {
    const configuration = vscode.workspace.getConfiguration("fachwerk");
    const sections = configuration.get("sections", []);
    const { values: folders, target } = configuredList("folders");
    const folderState = target === vscode.ConfigurationTarget.Workspace ? context.workspaceState : context.globalState;
    const previousSlots = folderState.get(FOLDER_SLOTS_KEY, []);
    const assignedSlots = assignFolderSlots(previousSlots, folders);
    if (JSON.stringify(assignedSlots) !== JSON.stringify(previousSlots)) {
      await folderState.update(FOLDER_SLOTS_KEY, assignedSlots);
    }
    folderSlots = assignedSlots;
    for (const [index, identifier] of SAVED_SECTION_VIEWS.entries()) {
      const section = sections[index];
      const isEnabled = Boolean(section) && section.enabled !== false;
      providers.get(identifier).setSection(isEnabled ? section : null);
      if (section) views.get(identifier).title = section.name;
      await vscode.commands.executeCommand("setContext", `${identifier}.visible`, isEnabled);
    }
    for (const [index, identifier] of FOLDER_VIEWS.entries()) {
      const folderPath = folderSlots[index];
      providers.get(identifier).setSection(folderPath ? { folder: folderPath } : null);
      if (folderPath) views.get(identifier).title = path.basename(folderPath) || folderPath;
      await vscode.commands.executeCommand("setContext", `fachwerk.hasFolder${index}`, Boolean(folderPath));
    }
    await vscode.commands.executeCommand("setContext", "fachwerk.hasPins", folders.length > 0 || sections.length > 0);
  }

  /** Serializes renders so an older update cannot replace a newer one. @returns {Promise<void>} Completion. */
  function updateViews() {
    renderQueue = renderQueue.then(renderViews, renderViews);
    return renderQueue;
  }
  await updateViews();
  const requestUpdate = () => updateViews().catch((error) => {
    console.error("Fachwerk: sidebar refresh failed", error);
    vscode.window.showErrorMessage("Could not refresh the sidebar. Please try Refresh again.");
  });
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("fachwerk")) requestUpdate();
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(requestUpdate));

  const handlers = {
    "fachwerk.addFolder": async (uri, selectedUris) => {
      if (uri?.fsPath) return addFolderPaths((selectedUris || [uri]).map((selected) => selected.fsPath));
      const folders = await vscode.window.showOpenDialog({
        canSelectFiles: false, canSelectFolders: true, canSelectMany: true, openLabel: "Add Folders",
        title: "Choose folders for your sidebar",
      });
      if (folders) await addFolderPaths(folders.map((folder) => folder.fsPath));
    },
    "fachwerk.manageFolders": manageFolders,
    "fachwerk.copyItem": async (item) => {
      if (item?.resourceUri) await vscode.env.clipboard.writeText(fs.readFileSync(realPath(item.resourceUri.fsPath), "utf8"));
    },
    "fachwerk.copyPath": async (item) => {
      if (item?.resourceUri) await vscode.env.clipboard.writeText(item.resourceUri.fsPath);
    },
    "fachwerk.renameItem": renameItem,
    "fachwerk.deleteItem": deleteItem,
    "fachwerk.refresh": updateViews,
  };
  for (const [index] of FOLDER_VIEWS.entries()) handlers[`fachwerk.removeFolder${index}`] = async () => {
    await updateViews();
    await removePin("folders", folderSlots[index]);
    await updateViews();
  };
  for (const [index] of SAVED_SECTION_VIEWS.entries()) handlers[`fachwerk.removeSection${index}`] = async () => {
    await removePin("sections", configuredList("sections").values[index]);
    await updateViews();
  };
  for (const [identifier, handler] of Object.entries(handlers)) registerCommand({ context, identifier, handler });
  if (chooseFolders) await vscode.commands.executeCommand("fachwerk.addFolder");
}

module.exports = { activate };
