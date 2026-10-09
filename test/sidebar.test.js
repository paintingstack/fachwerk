const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createFixture, loadModule } = require("./helpers");

/** Writes fixture files with their parents. @param {string} filePath File. @param {string} content Text. @returns {void} */
function writeFile(filePath, content = "fixture") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

/** Activates production code in the fixture. @param {object} fixture Fixture. @returns {Promise<void>} Completion. */
async function activate(fixture) {
  await loadModule({ fixture, filename: "extension.js" }).activate(fixture.context);
}

test("migrated views retain their IDs, directory contents, instruction precedence, and linked file deduplication", async (testContext) => {
  const fixture = createFixture({ test: testContext, metadata: { updated: true } });
  const agentsDirectory = path.join(fixture.directory, ".claude", "agents");
  writeFile(path.join(agentsDirectory, "review", "agent.md"));
  writeFile(path.join(fixture.directory, ".claude", "skills", "writing", "SKILL.md"));
  const sharedFile = path.join(fixture.directory, "shared", "instructions.md");
  writeFile(sharedFile);
  fs.symlinkSync(sharedFile, path.join(fixture.directory, ".claude", "CLAUDE.md"));
  fs.mkdirSync(path.join(fixture.directory, ".codex"));
  fs.symlinkSync(sharedFile, path.join(fixture.directory, ".codex", "AGENTS.md"));
  const project = path.join(fixture.directory, "project");
  writeFile(path.join(project, ".claude", "CLAUDE.md"));
  writeFile(path.join(project, "CLAUDE.md"));
  writeFile(path.join(project, "AGENTS.md"));
  fixture.vscode.workspace.workspaceFolders = [{ name: "Project", uri: { fsPath: project } }];
  await activate(fixture);
  assert.equal(fixture.views.get("fachwerkAgents").title, "Agents");
  assert.equal(fixture.views.get("fachwerkSkills").title, "Skills");
  assert.equal(fixture.views.get("fachwerkClaudeMd").title, "Instructions");
  assert.equal(fixture.contexts.get("fachwerkAgents.visible"), true);
  const agentProvider = fixture.providers.get("fachwerkAgents");
  assert.equal(agentProvider.getChildren()[0].label, "review");
  assert.equal(agentProvider.getChildren(agentProvider.getChildren()[0])[0].label, "agent.md");
  const instructions = fixture.providers.get("fachwerkClaudeMd").getChildren();
  assert.equal(instructions.length, 3);
  assert.equal(instructions[0].command.arguments[0].fsPath, sharedFile);
  assert.match(instructions[0].tooltip, /CLAUDE\.md.*AGENTS\.md/);
  assert.equal(instructions[1].resourceUri.fsPath, path.join(project, ".claude", "CLAUDE.md"));
  assert.equal(instructions[2].resourceUri.fsPath, path.join(project, "AGENTS.md"));
  assert.equal(fixture.commands.has("fachwerk.addAgent"), false);
  assert.equal(fixture.commands.has("fachwerk.addSkill"), false);
});

test("folder picker supports multiple folders, deduplicates linked targets, and removing pins leaves files intact", async (testContext) => {
  const fixture = createFixture({ test: testContext });
  const notes = path.join(fixture.directory, "notes");
  const reference = path.join(fixture.directory, "reference");
  writeFile(path.join(notes, "note.txt"));
  writeFile(path.join(reference, "reference.txt"));
  const alias = path.join(fixture.directory, "linked-notes");
  fs.symlinkSync(notes, alias);
  await activate(fixture);
  assert.equal(fixture.contexts.get("fachwerkAgents.visible"), false);
  fixture.dialogSelection = [notes, reference, alias].map((fsPath) => ({ fsPath }));
  await fixture.commands.get("fachwerk.addFolder")();
  assert.equal(fixture.dialogOptions.canSelectMany, true);
  assert.deepEqual(fixture.settings.folders, [notes, reference]);
  await fixture.commands.get("fachwerk.removeFolder0")();
  assert.deepEqual(fixture.settings.folders, [reference]);
  assert.equal(fs.existsSync(path.join(notes, "note.txt")), true);
});

test("workspace pin removal writes the workspace override and leaves global pins untouched", async (testContext) => {
  const fixture = createFixture({ test: testContext, settings: { folders: ["/global"] }, workspaceSettings: { folders: ["/workspace"] } });
  await activate(fixture);
  await fixture.commands.get("fachwerk.removeFolder0")();
  assert.deepEqual(fixture.settings.folders, ["/global"]);
  assert.deepEqual(fixture.workspaceSettings.folders, []);
});

test("folder management cancellation preserves pins and unchecking all removes only pins", async (testContext) => {
  const fixture = createFixture({ test: testContext, settings: { folders: ["/first", "/second"], sections: [{ name: "Instructions", files: ["/instructions.md"] }] } });
  await activate(fixture);
  await fixture.commands.get("fachwerk.manageFolders")();
  assert.deepEqual(fixture.settings.folders, ["/first", "/second"]);
  assert.equal(fixture.settings.sections.length, 1);
  fixture.quickPickSelection = () => [];
  await fixture.commands.get("fachwerk.manageFolders")();
  assert.deepEqual(fixture.settings.folders, []);
  assert.equal(fixture.settings.sections[0].enabled, false);
});

test("generic saved sections browse linked directories and release replaced watchers", async (testContext) => {
  const fixture = createFixture({ test: testContext });
  const root = path.join(fixture.directory, "root");
  const target = path.join(fixture.directory, "target");
  writeFile(path.join(target, "inside.txt"));
  fs.mkdirSync(root);
  fs.symlinkSync(target, path.join(root, "linked-directory"));
  fixture.settings.sections = [{ name: "Anything", folder: root }];
  await activate(fixture);
  const provider = fixture.providers.get("fachwerkAgents");
  const linked = provider.getChildren()[0];
  assert.equal(linked.contextValue, "folder");
  assert.equal(provider.getChildren(linked)[0].label, "inside.txt");
  const watcher = fixture.watchers[0];
  await fixture.commands.get("fachwerk.refresh")();
  assert.equal(watcher.disposed, true);
  await fixture.commands.get("fachwerk.removeSection0")();
  assert.equal(fixture.settings.sections[0].enabled, false);
  assert.equal(fs.existsSync(root), true);
});

test("folder file rename preserves content, refuses overwrites, and deletion requests Trash", async (testContext) => {
  const fixture = createFixture({ test: testContext, settings: { sections: [] } });
  const filePath = path.join(fixture.directory, "file.txt");
  writeFile(filePath);
  writeFile(path.join(fixture.directory, "existing.txt"));
  fixture.settings.folders = [fixture.directory];
  await activate(fixture);
  fixture.inputName = "existing.txt";
  const provider = fixture.providers.get("fachwerkFolder0");
  let item = provider.getChildren().find((child) => child.resourceUri?.fsPath === filePath);
  await fixture.commands.get("fachwerk.renameItem")(item);
  assert.match(fixture.errors[0], /already in use/);
  fixture.vscode.workspace.fs.rename = async (source, destination) => fs.renameSync(source.fsPath, destination.fsPath);
  fixture.inputName = "renamed.txt";
  await fixture.commands.get("fachwerk.renameItem")(item);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(fs.readFileSync(path.join(fixture.directory, "renamed.txt"), "utf8"), "fixture");
  item = provider.getChildren().find((child) => child.label === "renamed.txt");
  fixture.warningChoice = "Move to Trash";
  let deleteOptions;
  fixture.vscode.workspace.fs.delete = async (uri, options) => { deleteOptions = options; };
  await fixture.commands.get("fachwerk.deleteItem")(item);
  assert.deepEqual(deleteOptions, { recursive: true, useTrash: true });
});

test("choosing a fresh sidebar during manual installation opens the folder picker", async (testContext) => {
  const fixture = createFixture({ test: testContext, metadata: {} });
  fixture.messageChoice = "Add Folders";
  fixture.dialogSelection = [];
  await activate(fixture);
  assert.equal(fixture.dialogOptions.canSelectMany, true);
  assert.equal(fixture.settings.sections, undefined);
});

test("Manage Folders includes migrated folder and file sections alongside custom folders", async (testContext) => {
  const sections = [
    { name: "Agents", folder: "/agents" },
    { name: "Skills", folder: "/skills" },
    { name: "Instructions", files: ["/instructions.md"] },
  ];
  const fixture = createFixture({ test: testContext, settings: { sections, folders: ["/home/.agents"] } });
  await activate(fixture);
  fixture.quickPickSelection = (choices) => {
    assert.deepEqual(choices.map((choice) => choice.label), ["Agents", "Skills", "Instructions", ".agents"]);
    assert.ok(choices.every((choice) => choice.picked));
    return choices.filter((choice) => choice.label === "Agents" || choice.label === "Instructions");
  };
  await fixture.commands.get("fachwerk.manageFolders")();
  assert.deepEqual(fixture.settings.sections.map((section) => section.name), ["Agents", "Skills", "Instructions"]);
  assert.equal(fixture.settings.sections[1].enabled, false);
  assert.ok(fixture.settings.sections[0].enabled !== false && fixture.settings.sections[2].enabled !== false);
  assert.deepEqual(fixture.settings.folders, []);
  await fixture.commands.get("fachwerk.refresh")();
  assert.equal(fixture.contexts.get("fachwerk.hasPins"), true);
});

test("Manage Folders respects independent workspace and global settings for migrated sections and folders", async (testContext) => {
  const fixture = createFixture({
    test: testContext,
    settings: { sections: [{ name: "Instructions", files: ["/instructions.md"] }], folders: ["/global"] },
    workspaceSettings: { folders: ["/workspace"] },
  });
  await activate(fixture);
  fixture.quickPickSelection = () => [];
  await fixture.commands.get("fachwerk.manageFolders")();
  assert.equal(fixture.settings.sections[0].enabled, false);
  assert.deepEqual(fixture.settings.folders, ["/global"]);
  assert.deepEqual(fixture.workspaceSettings.folders, []);
  assert.deepEqual(fixture.updates.map(({ key, target }) => ({ key, target })), [
    { key: "sections", target: fixture.vscode.ConfigurationTarget.Global },
    { key: "folders", target: fixture.vscode.ConfigurationTarget.Workspace },
  ]);
});
