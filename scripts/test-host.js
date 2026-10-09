const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const assert = require("node:assert/strict");

const PROJECT_DIRECTORY = path.resolve(__dirname, "..");
const TIMEOUT_MILLISECONDS = 60000;
const REPORT_INTERVAL_MILLISECONDS = 10000;
const TOTAL_STEPS = 5;

/** Runs real VS Code tests in disposable settings and extension directories. @returns {Promise<void>} Completion. */
async function run() {
  const directory = fs.mkdtempSync(path.join(PROJECT_DIRECTORY, ".test-host-"));
  const profileDirectory = path.join(directory, "profile");
  const workspaceDirectory = path.join(directory, "workspace");
  const extensionsDirectory = path.join(directory, "extensions");
  const resultPath = path.join(workspaceDirectory, "host-result.json");
  for (const folder of [path.join(profileDirectory, "User"), path.join(workspaceDirectory, "pinned"), extensionsDirectory]) {
    fs.mkdirSync(folder, { recursive: true });
  }
  fs.writeFileSync(path.join(profileDirectory, "User", "settings.json"), JSON.stringify({
    "fachwerk.folders": [path.join(workspaceDirectory, "pinned")],
    "workbench.startupEditor": "none", "telemetry.telemetryLevel": "off",
    "extensions.autoUpdate": false, "extensions.autoCheckUpdates": false,
    "window.restoreWindows": "none",
  }));
  const reporter = setInterval(() => {
    const progress = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, "utf8")).steps : 0;
    console.log(`VS Code host: ${progress}/${TOTAL_STEPS} steps completed. Still waiting for completion, timeout after 60 seconds.`);
  }, REPORT_INTERVAL_MILLISECONDS);
  try {
    console.log(`Opening isolated VS Code host, 0/${TOTAL_STEPS} steps completed.`);
    const result = await promisify(execFile)("code", [
      "--new-window", "--wait", "--user-data-dir", profileDirectory, "--extensions-dir", extensionsDirectory,
      `--extensionDevelopmentPath=${PROJECT_DIRECTORY}`,
      `--extensionTestsPath=${path.join(PROJECT_DIRECTORY, "test", "extension-host.js")}`, workspaceDirectory,
    ], { timeout: TIMEOUT_MILLISECONDS });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    assert.ok(fs.existsSync(resultPath), "VS Code exited without completing tests, inspect the host logs");
    assert.deepEqual(JSON.parse(fs.readFileSync(resultPath, "utf8")), { passed: true, steps: TOTAL_STEPS });
    console.log(`VS Code host passed, ${TOTAL_STEPS}/${TOTAL_STEPS} steps completed.`);
  } catch (error) {
    console.error(`VS Code host failed. Logs: ${profileDirectory}/logs`);
    throw error;
  } finally {
    clearInterval(reporter);
  }
  fs.rmSync(directory, { recursive: true, force: true });
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
