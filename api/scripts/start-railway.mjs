import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(scriptDir, "..");

function warnIfMissing(name) {
  if (!process.env[name]?.trim()) {
    console.error(`[railway] Missing ${name} — starting API anyway so /health can bind.`);
  }
}

warnIfMissing("DATABASE_URL");
warnIfMissing("JWT_ACCESS_SECRET");

// Schema/seed used to run here and blocked Railway /health for the full retry window.
// Nest now listens first; seed + schema patches run after listen inside the API.
console.warn("[railway] Starting API immediately (schema/seed deferred until after /health).");

mkdirSync(join(apiRoot, "data", "uploads"), { recursive: true });
console.log("[railway] Starting API server…");
const api = spawnSync("node", ["dist/main.js"], {
  cwd: apiRoot,
  stdio: "inherit",
  env: process.env,
});
process.exit(api.status ?? 0);
