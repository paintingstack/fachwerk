const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

/** Checks JavaScript syntax without installing dependencies. @param {string} directory Source directory. @returns {void} */
function checkDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) checkDirectory(filePath);
    if (entry.isFile() && entry.name.endsWith(".js")) execFileSync(process.execPath, ["--check", filePath], { stdio: "inherit" });
  }
}

checkDirectory(path.resolve(__dirname, ".."));
console.log("JavaScript syntax checks passed.");
