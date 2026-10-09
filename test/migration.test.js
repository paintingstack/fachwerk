const test = require("node:test");
const assert = require("node:assert/strict");
const { createFixture, loadModule } = require("./helpers");

/** Runs the migration against an isolated editor. @param {object} fixture Fixture. @returns {Promise<void>} Completion. */
function migrate(fixture) {
  const { migrateLayout } = loadModule({ fixture, filename: "migration.js" });
  return migrateLayout({ vscode: fixture.vscode, context: fixture.context });
}

test("fresh Marketplace install starts empty and never creates Claude directories", async (testContext) => {
  const fixture = createFixture({ test: testContext });
  await migrate(fixture);
  assert.deepEqual(fixture.settings, {});
  assert.equal(fixture.prompts.length, 0);
  assert.equal(fixture.markers.get("folderLayoutInitialized"), true);
  assert.equal(require("node:fs").existsSync(fixture.directory + "/.claude"), false);
});

test("upgrade preserves all ten custom pins including missing paths without consuming their slots", async (testContext) => {
  const folders = Array.from({ length: 10 }, (_, index) => `/missing/folder${index}`);
  const fixture = createFixture({ test: testContext, metadata: { updated: true }, settings: { folders } });
  await migrate(fixture);
  assert.deepEqual(fixture.settings.folders, folders);
  assert.equal(fixture.settings.sections.length, 3);
  assert.deepEqual(fixture.settings.sections.map((section) => section.name), ["Agents", "Skills", "Instructions"]);
  assert.deepEqual(fixture.updates.map((update) => update.key), ["sections"]);
});

test("an explicitly saved empty folder list identifies an older manual installation", async (testContext) => {
  const fixture = createFixture({ test: testContext, metadata: {}, settings: { folders: [] } });
  await migrate(fixture);
  assert.equal(fixture.settings.sections.length, 3);
  assert.deepEqual(fixture.settings.folders, []);
  assert.equal(fixture.prompts.length, 0);
});

test("unknown manual installation asks once and can preserve the previous sidebar", async (testContext) => {
  const fixture = createFixture({ test: testContext, metadata: {} });
  fixture.messageChoice = "Keep Previous Sidebar";
  await migrate(fixture);
  await migrate(fixture);
  assert.equal(fixture.prompts.length, 1);
  assert.equal(fixture.settings.sections.length, 3);
});

test("choosing folders on a manual install leaves all previous sections absent", async (testContext) => {
  const fixture = createFixture({ test: testContext, metadata: {} });
  fixture.messageChoice = "Add Folders";
  await migrate(fixture);
  assert.equal(fixture.settings.sections, undefined);
  assert.equal(fixture.markers.get("folderLayoutInitialized"), true);
});

test("dismissing the installation choice leaves migration available on next activation", async (testContext) => {
  const fixture = createFixture({ test: testContext, metadata: {} });
  await migrate(fixture);
  assert.equal(fixture.markers.size, 0);
  fixture.messageChoice = "Keep Previous Sidebar";
  await migrate(fixture);
  assert.equal(fixture.settings.sections.length, 3);
});

test("failed settings write leaves no success marker and retries cleanly", async (testContext) => {
  const fixture = createFixture({ test: testContext, metadata: { updated: true } });
  fixture.failUpdate = true;
  await assert.rejects(migrate(fixture), /Settings write failed/);
  assert.equal(fixture.markers.size, 0);
  fixture.failUpdate = false;
  await migrate(fixture);
  assert.equal(fixture.settings.sections.length, 3);
});

test("saved section choices win even when the migration marker is missing or restored settings are empty", async (testContext) => {
  for (const sections of [[], [{ name: "Notes", folder: "/my/notes" }]]) {
    const fixture = createFixture({ test: testContext, metadata: { updated: true }, settings: { sections } });
    await migrate(fixture);
    assert.deepEqual(fixture.settings.sections, sections);
    assert.equal(fixture.updates.length, 0);
  }
});

test("subsequent activation never brings back removed sections", async (testContext) => {
  const fixture = createFixture({ test: testContext, metadata: { updated: true } });
  await migrate(fixture);
  fixture.settings.sections = [];
  await migrate(fixture);
  assert.deepEqual(fixture.settings.sections, []);
  assert.equal(fixture.updates.length, 1);
});

test("workspace overrides stay separate and custom pins are never rewritten during migration", async (testContext) => {
  const fixture = createFixture({ test: testContext, metadata: {}, settings: { folders: ["/global"] }, workspaceSettings: { folders: ["/workspace"] } });
  await migrate(fixture);
  assert.deepEqual(fixture.settings.folders, ["/global"]);
  assert.deepEqual(fixture.workspaceSettings.folders, ["/workspace"]);
  assert.equal(fixture.updates[0].target, fixture.vscode.ConfigurationTarget.Global);
});
