const vscode = require("vscode");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SectionProvider } = require("../tree");

const TOTAL_STEPS = 5;

/** Saves actual completed steps for the host runner. @param {string} directory Workspace. @param {number} steps Completed steps. @returns {void} */
function recordProgress(directory, steps) {
  fs.writeFileSync(path.join(directory, "host-result.json"), JSON.stringify({ passed: steps === TOTAL_STEPS, steps }));
}

/** Waits for actual watcher progress with a clear deadline. @param {Function} predicate Completed event. @param {string} description Expected progress. @returns {Promise<void>} Completion. */
async function waitFor(predicate, description) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `No progress: ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Checks real events from expanded links and replacement targets. @param {string} testDirectory Workspace. @returns {Promise<void>} Completion. */
async function verifyLinkedWatchers(testDirectory) {
  const root = path.join(testDirectory, "links");
  const first = path.join(path.dirname(testDirectory), "first-target");
  const second = path.join(path.dirname(testDirectory), "second-target");
  for (const folder of [root, first, second]) fs.mkdirSync(folder);
  const link = path.join(root, "linked");
  fs.symlinkSync(first, link);
  const provider = new SectionProvider();
  let changes = 0;
  const subscription = provider.onDidChangeTreeData(() => { changes += 1; });
  try {
    provider.setSection({ folder: root });
    const child = provider.getChildren()[0];
    provider.getChildren(child);
    await new Promise((resolve) => setTimeout(resolve, 500));
    let before = changes;
    fs.writeFileSync(path.join(root, "control.txt"), "control");
    await waitFor(() => changes > before, "ordinary folder file should refresh the tree");
    await new Promise((resolve) => setTimeout(resolve, 200));
    before = changes;
    fs.writeFileSync(path.join(first, ".linked.txt"), "first target");
    await waitFor(() => changes > before, "file in linked destination should refresh the tree");
    assert.equal(provider.getChildren(child)[0].label, ".linked.txt");
    recordProgress(testDirectory, 4);
    console.log("HOST STEP 4: Real linked destination events refresh the tree and dotfiles appear.");

    await new Promise((resolve) => setTimeout(resolve, 200));
    before = changes;
    fs.unlinkSync(link);
    fs.symlinkSync(second, link);
    await waitFor(() => changes > before, "replacing the link should refresh the tree");
    assert.deepEqual(provider.getChildren(child), []);
    await new Promise((resolve) => setTimeout(resolve, 500));
    before = changes;
    fs.writeFileSync(path.join(second, "new.txt"), "second target");
    await waitFor(() => changes > before, "replacement linked destination should refresh the tree");
    assert.equal(provider.getChildren(child)[0].label, "new.txt");
    recordProgress(testDirectory, 5);
    console.log("HOST STEP 5: Replacing a link observes its new destination.");
  } finally {
    subscription.dispose();
    provider.dispose();
  }
}

/** Exercises settings migration and pin commands in the real VS Code host. @returns {Promise<void>} Completion. */
async function run() {
  const extension = vscode.extensions.getExtension("gundurraga.fachwerk");
  assert.ok(extension, "Development extension must be loaded");
  await extension.activate();
  const configuration = () => vscode.workspace.getConfiguration("fachwerk");
  const originalFolders = configuration().get("folders");
  assert.equal(originalFolders.length, 1);
  assert.deepEqual(configuration().get("sections").map((section) => section.name), ["Agents", "Skills", "Instructions"]);
  const testDirectory = path.dirname(originalFolders[0]);
  recordProgress(testDirectory, 1);
  console.log("HOST STEP 1: Previous sidebar migrated, existing custom pin preserved.");

  const addedFolder = path.join(testDirectory, "added");
  fs.mkdirSync(addedFolder, { recursive: true });
  fs.writeFileSync(path.join(addedFolder, "keep.txt"), "Keep this file.");
  await vscode.commands.executeCommand("fachwerk.addFolder", vscode.Uri.file(addedFolder));
  assert.deepEqual(configuration().get("folders"), [...originalFolders, addedFolder]);
  await vscode.commands.executeCommand("fachwerk.addFolder", vscode.Uri.file(addedFolder));
  assert.equal(configuration().get("folders").length, 2);
  recordProgress(testDirectory, 2);
  console.log("HOST STEP 2: Folder command adds a pin and prevents duplicates.");

  await vscode.commands.executeCommand("fachwerk.removeFolder1");
  assert.deepEqual(configuration().get("folders"), originalFolders);
  assert.ok(fs.existsSync(path.join(addedFolder, "keep.txt")));
  await vscode.commands.executeCommand("fachwerk.removeSection0");
  assert.deepEqual(configuration().get("sections").map((section) => section.name), ["Agents", "Skills", "Instructions"]);
  assert.equal(configuration().get("sections")[0].enabled, false);
  await vscode.commands.executeCommand("fachwerk.refresh");
  console.log("HOST STEP 3: Removing pins preserves files, remaining sections refresh.");
  recordProgress(testDirectory, 3);
  await verifyLinkedWatchers(testDirectory);
  console.log("HOST PASS: All real VS Code checks passed.");
}

module.exports = { run };
