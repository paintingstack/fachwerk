const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createFixture, loadModule, waitFor } = require("./helpers");

/** Starts the real extension in an isolated editor boundary. @param {object} fixture Fixture. @returns {Promise<void>} Completion. */
const activate = (fixture) => loadModule({ fixture, filename: "extension.js" }).activate(fixture.context);

/** Creates a real directory and returns its absolute path. @param {object} fixture Fixture. @param {string} name Directory name. @returns {string} Path. */
function directory(fixture, name) {
  const folder = path.join(fixture.directory, name);
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

/** Lists active watchers of one real directory. @param {object} fixture Fixture. @param {string} folder Watched directory. @returns {object[]} Watchers. */
const watchersFor = (fixture, folder) => fixture.watchers.filter((watcher) => !watcher.disposed && watcher.pattern.base === folder);

test("Manage Folders preserves concurrent additions and external section edits", async (context) => {
  const fixture = createFixture({ test: context, settings: {
    sections: [{ name: "Instructions", files: ["/instructions.md"] }], folders: ["/first", "/second"],
  } });
  const added = directory(fixture, "added");
  await activate(fixture);
  fixture.quickPickSelection = async (choices) => {
    await fixture.commands.get("fachwerk.addFolder")({ fsPath: added });
    fixture.settings.sections = [{ name: "Instructions", files: ["/edited.md"] }];
    return choices.filter((choice) => choice.label !== "first");
  };
  await fixture.commands.get("fachwerk.manageFolders")();
  assert.deepEqual(fixture.settings.folders, ["/second", added]);
  assert.deepEqual(fixture.settings.sections[0].files, ["/edited.md"]);
});

test("two Add Folders commands preserve both selections when settings writes are pending", async (context) => {
  const fixture = createFixture({ test: context, settings: { sections: [], folders: [] } });
  await activate(fixture);
  const first = directory(fixture, "first");
  const second = directory(fixture, "second");
  let release;
  let blocked = false;
  fixture.beforeUpdate = async ({ key }) => {
    if (key === "folders" && !blocked) {
      blocked = true;
      await new Promise((resolve) => { release = resolve; });
    }
  };
  const firstAdd = fixture.commands.get("fachwerk.addFolder")({ fsPath: first });
  await waitFor(() => Boolean(release));
  const secondAdd = fixture.commands.get("fachwerk.addFolder")({ fsPath: second });
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([firstAdd, secondAdd]);
  assert.deepEqual(fixture.settings.folders, [first, second]);
});

test("a failed pin write does not block subsequent additions", async (context) => {
  const fixture = createFixture({ test: context, settings: { sections: [] } });
  await activate(fixture);
  const folder = directory(fixture, "folder");
  fixture.failUpdate = true;
  await fixture.commands.get("fachwerk.addFolder")({ fsPath: folder });
  assert.match(fixture.errors[0], /Could not save/);
  fixture.failUpdate = false;
  await fixture.commands.get("fachwerk.addFolder")({ fsPath: folder });
  assert.deepEqual(fixture.settings.folders, [folder]);
});

test("configuration events repaint latest folders when an older render is pending", async (context) => {
  const fixture = createFixture({ test: context, settings: {
    sections: [{ name: "Fixed", files: [] }, { name: "first", files: [] }], folders: ["/first"],
  } });
  await activate(fixture);
  let release;
  let blocked = false;
  fixture.beforeContext = async () => {
    if (!blocked) {
      blocked = true;
      await new Promise((resolve) => { release = resolve; });
    }
  };
  fixture.settings.folders = ["/second"];
  fixture.settings.sections = [{ name: "Fixed", files: [] }, { name: "second", files: [] }];
  fixture.changeConfiguration();
  await waitFor(() => Boolean(release));
  fixture.settings.folders = ["/third"];
  fixture.settings.sections = [{ name: "Fixed", files: [] }, { name: "third", files: [] }];
  fixture.changeConfiguration();
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await waitFor(() => [...fixture.views].some(([identifier, view]) => identifier.startsWith("fachwerkFolder") && view.title === "third"));
  await new Promise((resolve) => setImmediate(resolve));
  const active = [...fixture.views].filter(([identifier]) => {
    const match = /^fachwerkFolder(\d+)$/.exec(identifier);
    return match && fixture.contexts.get(`fachwerk.hasFolder${match[1]}`);
  });
  assert.deepEqual(active.map(([, view]) => view.title), ["third"]);
  assert.equal(fixture.views.get("fachwerkSkills").title, "third");
});

test("hiding and restoring a section keeps remaining view identities and definitions", async (context) => {
  const sections = [
    { name: "Agents", folder: "/agents" },
    { name: "Skills", folder: "/skills" },
    { name: "Instructions", files: ["/instructions.md"] },
  ];
  const fixture = createFixture({ test: context, settings: { sections } });
  await activate(fixture);
  await fixture.commands.get("fachwerk.removeSection0")();
  await fixture.commands.get("fachwerk.refresh")();
  assert.equal(fixture.contexts.get("fachwerkAgents.visible"), false);
  assert.equal(fixture.views.get("fachwerkSkills").title, "Skills");
  assert.equal(fixture.views.get("fachwerkClaudeMd").title, "Instructions");
  assert.deepEqual(fixture.settings.sections[0], { ...sections[0], enabled: false });
  fixture.quickPickSelection = (choices) => {
    assert.equal(choices.find((choice) => choice.label === "Agents").picked, false);
    return choices;
  };
  await fixture.commands.get("fachwerk.manageFolders")();
  await fixture.commands.get("fachwerk.refresh")();
  assert.equal(fixture.contexts.get("fachwerkAgents.visible"), true);
  assert.equal(fixture.views.get("fachwerkAgents").title, "Agents");
});

test("removing an earlier folder keeps the remaining view slot and its remove command", async (context) => {
  const fixture = createFixture({ test: context, settings: { sections: [], folders: ["/first", "/second"] } });
  await activate(fixture);
  await fixture.commands.get("fachwerk.removeFolder0")();
  await fixture.commands.get("fachwerk.refresh")();
  assert.equal(fixture.contexts.get("fachwerk.hasFolder1"), true);
  assert.equal(fixture.views.get("fachwerkFolder1").title, "second");
  await fixture.commands.get("fachwerk.removeFolder1")();
  assert.deepEqual(fixture.settings.folders, []);
});

test("file collections allow copying but reject Rename and Trash on shared link targets", async (context) => {
  const fixture = createFixture({ test: context });
  const target = path.join(fixture.directory, "shared.md");
  const alias = path.join(fixture.directory, "instructions.md");
  fs.writeFileSync(target, "shared instructions");
  fs.symlinkSync(target, alias);
  fixture.settings.sections = [{ name: "Instructions", files: [alias] }];
  await activate(fixture);
  const item = fixture.providers.get("fachwerkAgents").getChildren()[0];
  assert.equal(item.contextValue, "referenceFile");
  await fixture.commands.get("fachwerk.copyItem")(item);
  assert.equal(fixture.clipboard, "shared instructions");
  const writes = [];
  fixture.vscode.workspace.fs.rename = async (...arguments_) => writes.push(arguments_);
  fixture.vscode.workspace.fs.delete = async (...arguments_) => writes.push(arguments_);
  fixture.inputName = "renamed.md";
  fixture.warningChoice = "Move to Trash";
  await fixture.commands.get("fachwerk.renameItem")(item);
  await fixture.commands.get("fachwerk.deleteItem")(item);
  assert.deepEqual(writes, []);
  assert.equal(fs.readFileSync(target, "utf8"), "shared instructions");
  assert.deepEqual(fixture.settings.sections[0].files, [alias]);
});

test("folder trees show dotfiles and distinguish missing folders from empty folders", async (context) => {
  const fixture = createFixture({ test: context });
  const root = directory(fixture, "root");
  fs.writeFileSync(path.join(root, ".gitignore"), "build");
  fs.mkdirSync(path.join(root, ".config"));
  fixture.settings.sections = [{ name: "Root", folder: root }];
  await activate(fixture);
  const provider = fixture.providers.get("fachwerkAgents");
  assert.deepEqual(provider.getChildren().map((item) => item.label), [".config", ".gitignore"]);
  fs.rmSync(root, { recursive: true });
  const message = provider.getChildren();
  assert.equal(message.length, 1);
  assert.equal(message[0].contextValue, "message");
  assert.ok(message[0].label && !message[0].resourceUri);
});

test("expanded linked folders watch their destination and rebind after link replacement", async (context) => {
  const fixture = createFixture({ test: context });
  const root = directory(fixture, "root");
  const first = directory(fixture, "first");
  const second = directory(fixture, "second");
  const link = path.join(root, "link");
  fs.symlinkSync(first, link);
  fixture.settings.sections = [{ name: "Root", folder: root }];
  await activate(fixture);
  const provider = fixture.providers.get("fachwerkAgents");
  const child = provider.getChildren()[0];
  provider.getChildren(child);
  assert.ok(watchersFor(fixture, first).length > 0);
  let changes = 0;
  provider.onDidChangeTreeData(() => { changes += 1; });
  watchersFor(fixture, first)[0].Create({ fsPath: path.join(first, "new.txt") });
  assert.ok(changes > 0);
  fs.unlinkSync(link);
  fs.symlinkSync(second, link);
  watchersFor(fixture, root)[0].Change({ fsPath: link });
  provider.getChildren(child);
  assert.ok(watchersFor(fixture, second).length > 0);
  assert.equal(watchersFor(fixture, first).length, 0);
});

test("a file reference created or retargeted after activation watches its current destination", async (context) => {
  const fixture = createFixture({ test: context });
  const first = directory(fixture, "first");
  const second = directory(fixture, "second");
  const firstFile = path.join(first, "first.md");
  const secondFile = path.join(second, "second.md");
  const alias = path.join(fixture.directory, "instructions.md");
  fs.writeFileSync(firstFile, "first");
  fs.writeFileSync(secondFile, "second");
  fixture.settings.sections = [{ name: "Instructions", files: [alias] }];
  await activate(fixture);
  fs.symlinkSync(firstFile, alias);
  watchersFor(fixture, fixture.directory)[0].Create({ fsPath: alias });
  assert.ok(watchersFor(fixture, first).length > 0);
  fs.unlinkSync(alias);
  fs.symlinkSync(secondFile, alias);
  watchersFor(fixture, fixture.directory)[0].Change({ fsPath: alias });
  assert.ok(watchersFor(fixture, second).length > 0);
  assert.equal(watchersFor(fixture, first).length, 0);
  assert.equal(fixture.providers.get("fachwerkAgents").getChildren()[0].resourceUri.fsPath, secondFile);
});

test("removing a newly added folder waits for its pending persistent view assignment", async (context) => {
  const fixture = createFixture({ test: context, settings: { sections: [], folders: ["/first"] } });
  await activate(fixture);
  const added = directory(fixture, "added");
  let release;
  fixture.beforeStateUpdate = async ({ key, value }) => {
    if (key === "folderViewSlots" && value.includes(added) && !release) {
      await new Promise((resolve) => { release = resolve; });
    }
  };
  const addition = fixture.commands.get("fachwerk.addFolder")({ fsPath: added });
  await waitFor(() => Boolean(release));
  const removal = fixture.commands.get("fachwerk.removeFolder1")();
  release();
  await Promise.all([addition, removal]);
  assert.deepEqual(fixture.settings.folders, ["/first"]);
});

test("workspace overrides preserve global folder view identities when returning to global pins", async (context) => {
  const fixture = createFixture({ test: context, settings: { sections: [], folders: ["/A", "/B", "/C"] } });
  await activate(fixture);
  await fixture.commands.get("fachwerk.removeFolder0")();
  assert.deepEqual(fixture.settings.folders, ["/B", "/C"]);
  fixture.workspaceSettings.folders = ["/X", "/Y"];
  fixture.changeConfiguration();
  await fixture.commands.get("fachwerk.refresh")();
  assert.equal(fixture.views.get("fachwerkFolder0").title, "X");
  assert.equal(fixture.views.get("fachwerkFolder1").title, "Y");
  delete fixture.workspaceSettings.folders;
  fixture.changeConfiguration();
  await fixture.commands.get("fachwerk.refresh")();
  assert.equal(fixture.contexts.get("fachwerk.hasFolder0"), false);
  assert.equal(fixture.views.get("fachwerkFolder1").title, "B");
  assert.equal(fixture.views.get("fachwerkFolder2").title, "C");
});
