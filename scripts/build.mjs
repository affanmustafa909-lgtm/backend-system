import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function runPnpm(args) {
  const cmd = process.platform === "win32" ? "corepack" : "pnpm";
  const fullArgs = process.platform === "win32" ? ["pnpm", ...args] : args;
  const result = spawnSync(cmd, fullArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

runPnpm(["--filter", "@platform/contracts", "build"]);
runPnpm(["--filter", "@platform/database-pg", "build"]);
runPnpm(["--filter", "@platform/api", "build"]);
console.log("[build] Done.");
