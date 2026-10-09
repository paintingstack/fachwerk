const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const MIGRATION_KEY = "folderLayoutInitialized";
const CONFIGURATION_SCOPES = ["globalValue", "workspaceValue", "workspaceFolderValue"];

/** Returns whether a setting was explicitly saved in any scope. @param {object} setting Configuration inspection. @returns {boolean} Saved setting. */
function isConfigured(setting) {
  return CONFIGURATION_SCOPES.some((scope) => setting?.[scope] !== undefined);
}

/** Builds ordinary saved sections matching the previous sidebar. @param {string} homeDirectory User home. @returns {object[]} Sections. */
function previousSections(homeDirectory) {
  const claudeDirectory = path.join(homeDirectory, ".claude");
  return [
    { name: "Agents", folder: path.join(claudeDirectory, "agents") },
    { name: "Skills", folder: path.join(claudeDirectory, "skills") },
    {
      name: "Instructions",
      files: [path.join(claudeDirectory, "CLAUDE.md"), path.join(homeDirectory, ".codex", "AGENTS.md")],
      workspaceFiles: [[".claude/CLAUDE.md", "CLAUDE.md"], ["AGENTS.md"]],
    },
  ];
}

/** Reads installer metadata, which the extension API may omit. @param {object} context Extension context. @returns {object} Installation metadata. */
function installationMetadata(context) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(context.extensionPath, "package.json"), "utf8"));
    return manifest.__metadata || {};
  } catch {
    return {};
  }
}

/** Preserves previous sections once, without changing folder settings or files. @param {object} options VS Code, context, and optional test home. @returns {Promise<boolean|undefined>} Whether to open the folder picker. */
async function migrateLayout({ vscode, context, homeDirectory = os.homedir() }) {
  if (context.globalState.get(MIGRATION_KEY)) return;
  const configuration = vscode.workspace.getConfiguration("fachwerk");
  if (isConfigured(configuration.inspect("sections"))) {
    await context.globalState.update(MIGRATION_KEY, true);
    return;
  }

  const metadata = installationMetadata(context);
  let chooseFolders = false;
  let keepPrevious = isConfigured(configuration.inspect("folders")) || metadata.updated === true;
  if (!keepPrevious && metadata.updated === undefined && context.extensionMode === vscode.ExtensionMode.Production) {
    const choice = await vscode.window.showInformationMessage(
      "Choose your Fachwerk sidebar. Keep Previous Sidebar preserves Agents, Skills, and Instructions from earlier versions.",
      "Keep Previous Sidebar",
      "Add Folders"
    );
    if (!choice) return;
    keepPrevious = choice === "Keep Previous Sidebar";
    chooseFolders = choice === "Add Folders";
  }

  if (keepPrevious) {
    await configuration.update("sections", previousSections(homeDirectory), vscode.ConfigurationTarget.Global);
  }
  // Write only after settings succeed, so a failed migration can be retried.
  await context.globalState.update(MIGRATION_KEY, true);
  return chooseFolders;
}

module.exports = { migrateLayout, previousSections, MIGRATION_KEY };
