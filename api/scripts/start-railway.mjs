import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapLiveDb } from "./bootstrap-live-db.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(scriptDir, "..");

function warnIfMissing(name) {
  if (!process.env[name]?.trim()) {
    console.error(`[railway] Missing ${name} — starting API anyway so /health can bind.`);
  }
}

warnIfMissing("DATABASE_URL");
warnIfMissing("JWT_ACCESS_SECRET");

// Empty Railway Postgres has no tables — login then 500s. Create schema before listen
// when `users` is missing. Later deploys skip the full push (healthcheck stays fast).
console.warn("[railway] Checking live database schema… (boot 2026-09-05)");
bootstrapLiveDb();

mkdirSync(join(apiRoot, "data", "uploads"), { recursive: true });
console.log("[railway] Starting API server…");
const api = spawnSync("node", ["dist/main.js"], {
  cwd: apiRoot,
  stdio: "inherit",
  env: process.env,
});
process.exit(api.status ?? 0);
