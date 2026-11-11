#!/usr/bin/env node

/**
 * CLI wrapper — runs apps/web/cli/index.ts via tsx (for pnpm link / bin).
 */

const { spawn } = require("child_process");
const path = require("path");

const tsxPath = require.resolve("tsx/cli");
const cliPath = path.join(__dirname, "index.ts");

const child = spawn("node", [tsxPath, cliPath, ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: path.join(__dirname, ".."),
});

child.on("exit", (code) => {
  process.exit(code || 0);
});
