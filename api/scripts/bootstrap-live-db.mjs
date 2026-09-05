/**
 * First-boot Railway helper: if `users` is missing, push the full Drizzle schema.
 * Safe to run on every start — skips push when tables already exist.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureCriticalSchema } from "./ensure-schema.mjs";
import { resolveWorkspaceRoot } from "./resolve-workspace.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(scriptDir, "..");

function probeUsersTable() {
  const runner = `
const { Client } = require("pg");
function stripSsl(raw) {
  try {
    const url = new URL(raw);
    url.searchParams.delete("sslmode");
    url.searchParams.delete("ssl");
    url.searchParams.delete("uselibpqcompat");
    return url.toString();
  } catch {
    return raw;
  }
}
(async () => {
  const raw = process.env.DATABASE_URL || "";
  const local = /localhost|127\\.0\\.0\\.1/.test(raw);
  const client = new Client({
    connectionString: stripSsl(raw),
    connectionTimeoutMillis: 10_000,
    ssl: local ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  const res = await client.query("select to_regclass('public.users') as present");
  await client.end();
  process.exit(res.rows[0] && res.rows[0].present ? 0 : 2);
})().catch((err) => {
  console.error("[bootstrap-live-db] probe failed:", err && err.message ? err.message : err);
  process.exit(1);
});
`;

  const appRoot = resolveWorkspaceRoot(apiRoot);
  const dbPkgRoot = join(appRoot, "packages", "database-pg");
  return spawnSync(process.execPath, ["-e", runner], {
    cwd: dbPkgRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
  }).status;
}

function runDrizzlePush() {
  const appRoot = resolveWorkspaceRoot(apiRoot);
  const dbPkgRoot = join(appRoot, "packages", "database-pg");
  const kitCandidates = [
    join(appRoot, "node_modules", "drizzle-kit", "bin.cjs"),
    join(dbPkgRoot, "node_modules", "drizzle-kit", "bin.cjs"),
  ];
  const kit = kitCandidates.find((p) => existsSync(p));
  if (!kit) {
    console.error("[bootstrap-live-db] drizzle-kit not found in image");
    return false;
  }
  console.log("[bootstrap-live-db] Pushing schema with drizzle-kit…");
  const result = spawnSync(process.execPath, [kit, "push", "--force"], {
    cwd: dbPkgRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  return result.status === 0;
}

export function bootstrapLiveDb() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("[bootstrap-live-db] DATABASE_URL missing — skip");
    return false;
  }
  try {
    const probe = probeUsersTable();
    if (probe === 0) {
      console.log("[bootstrap-live-db] users table present — verifying columns");
      return ensureCriticalSchema();
    }
    if (probe === 1) {
      console.error("[bootstrap-live-db] could not reach Postgres");
      return false;
    }
    console.warn("[bootstrap-live-db] users table missing — applying full schema");
    if (!runDrizzlePush()) {
      console.error("[bootstrap-live-db] schema push failed");
      return false;
    }
    return ensureCriticalSchema();
  } catch (err) {
    console.error("[bootstrap-live-db]", err instanceof Error ? err.message : err);
    return false;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(bootstrapLiveDb() ? 0 : 1);
}
