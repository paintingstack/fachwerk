const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const PROJECT_DIRECTORY = path.resolve(__dirname, "..");

/** Loads production modules with only the VS Code and home boundaries replaced. @param {object} options Fixture and module. @returns {object} Module exports. */
function loadModule({ fixture, filename }) {
  const cache = new Map();
  function load(filePath) {
    if (cache.has(filePath)) return cache.get(filePath).exports;
    const module = { exports: {} };
    cache.set(filePath, module);
    const nativeRequire = createRequire(filePath);
    const requireModule = (identifier) => {
      if (identifier === "vscode") return fixture.vscode;
      if (identifier === "node:os") return { homedir: () => fixture.directory };
      if (identifier.startsWith(".")) return load(nativeRequire.resolve(identifier));
      return nativeRequire(identifier);
    };
    const wrapper = vm.runInThisContext(`(function(require, module, exports) {${fs.readFileSync(filePath, "utf8")}\n})`, { filename: filePath });
    wrapper(requireModule, module, module.exports);
    return module.exports;
  }
  return load(path.join(PROJECT_DIRECTORY, filename));
}

/** Builds an isolated filesystem and controllable editor boundary. @param {object} options Test context, metadata, and settings. @returns {object} Fixture. */
function createFixture({ test, metadata = { updated: false }, settings = {}, workspaceSettings = {} }) {
  const directory = fs.mkdtempSync(path.join(PROJECT_DIRECTORY, ".test-fixture-"));
  test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ __metadata: metadata }));
  const commands = new Map();
  const providers = new Map();
  const views = new Map();
  const contexts = new Map();
  const markers = new Map();
  const workspaceMarkers = new Map();
  const errors = [];
  const updates = [];
  const watchers = [];
  const configurationListeners = [];
  const workspaceListeners = [];
  const prompts = [];
  const fixture = { directory, settings, workspaceSettings, commands, providers, views, contexts, markers, workspaceMarkers, errors, updates, watchers, prompts };
  const disposable = () => ({ dispose() { this.disposed = true; } });
  const configuration = {
    get: (key, fallback) => workspaceSettings[key] ?? settings[key] ?? fallback,
    inspect: (key) => ({ globalValue: settings[key], workspaceValue: workspaceSettings[key] }),
    update: async (key, value, target) => {
      if (fixture.failUpdate) throw new Error("Settings write failed");
      if (fixture.beforeUpdate) await fixture.beforeUpdate({ key, value, target });
      updates.push({ key, value, target });
      (target === 2 ? workspaceSettings : settings)[key] = value;
      configurationListeners.forEach((listener) => listener({ affectsConfiguration: () => true }));
    },
  };
  fixture.vscode = {
    ConfigurationTarget: { Global: 1, Workspace: 2 }, ExtensionMode: { Production: 1, Development: 2 },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1 },
    TreeItem: class { constructor(label, state) { this.label = label; this.collapsibleState = state; } },
    ThemeIcon: class { constructor(identifier) { this.id = identifier; } },
    RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
    EventEmitter: class {
      constructor() {
        this.listeners = new Set();
        this.event = (listener) => {
          this.listeners.add(listener);
          return { dispose: () => this.listeners.delete(listener) };
        };
      }
      fire(value) { this.listeners.forEach((listener) => listener(value)); }
      dispose() { this.listeners.clear(); this.disposed = true; }
    },
    Uri: { file: (filePath) => ({ fsPath: filePath }) },
    workspace: {
      workspaceFolders: [], getConfiguration: () => configuration,
      createFileSystemWatcher: (pattern) => {
        const watcher = { ...disposable(), pattern };
        for (const event of ["Create", "Delete", "Change"]) watcher[`onDid${event}`] = (listener) => { watcher[event] = listener; return disposable(); };
        watchers.push(watcher);
        return watcher;
      },
      onDidChangeConfiguration: (listener) => { configurationListeners.push(listener); return disposable(); },
      onDidChangeWorkspaceFolders: (listener) => { workspaceListeners.push(listener); return disposable(); },
      fs: { rename: async () => {}, delete: async () => {} },
    },
    window: {
      createTreeView: (identifier, options) => {
        const view = disposable(); views.set(identifier, view); providers.set(identifier, options.treeDataProvider); return view;
      },
      registerTreeDataProvider: (identifier, provider) => { providers.set(identifier, provider); return disposable(); },
      showInformationMessage: async (...arguments_) => { prompts.push(arguments_); return fixture.messageChoice; },
      showWarningMessage: async () => fixture.warningChoice,
      showErrorMessage: (message) => errors.push(message),
      showOpenDialog: async (options) => { fixture.dialogOptions = options; return fixture.dialogSelection; },
      showQuickPick: async (choices) => fixture.quickPickSelection?.(choices),
      showInputBox: async () => fixture.inputName,
    },
    commands: {
      registerCommand: (identifier, handler) => { commands.set(identifier, handler); return disposable(); },
      executeCommand: async (identifier, key, value) => {
        if (identifier === "setContext") {
          if (fixture.beforeContext) await fixture.beforeContext({ key, value });
          return contexts.set(key, value);
        }
        return commands.get(identifier)?.(key, value);
      },
    },
    env: { clipboard: { writeText: async (value) => { fixture.clipboard = value; } } },
  };
  fixture.context = {
    extensionPath: directory, extensionMode: 1, subscriptions: [],
    globalState: {
      get: (key, fallback) => markers.get(key) ?? fallback,
      update: async (key, value) => {
        if (fixture.beforeStateUpdate) await fixture.beforeStateUpdate({ key, value });
        markers.set(key, value);
      },
    },
    workspaceState: {
      get: (key, fallback) => workspaceMarkers.get(key) ?? fallback,
      update: async (key, value) => { workspaceMarkers.set(key, value); },
    },
  };
  test.after(() => fixture.context.subscriptions.forEach((subscription) => subscription.dispose()));
  fixture.changeWorkspace = () => workspaceListeners.forEach((listener) => listener());
  fixture.changeConfiguration = () => configurationListeners.forEach((listener) => listener({ affectsConfiguration: () => true }));
  return fixture;
}

/** Waits for observable work, failing promptly when it stops advancing. @param {Function} predicate Expected state. @returns {Promise<void>} Completion. */
async function waitFor(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Expected test progress was not observed within two seconds.");
    await new Promise((resolve) => setImmediate(resolve));
  }
}

module.exports = { createFixture, loadModule, waitFor };
