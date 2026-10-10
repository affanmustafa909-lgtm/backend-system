/**
 * Railway entrypoint.
 *
 * Nest (`main.ts`) binds `/health` on `$PORT` before module init, so Railway
 * healthchecks pass immediately. Schema bootstrap runs in the background and
 * must never block listen.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(scriptDir, "..");
const BOOTSTRAP_TIMEOUT_MS = Number(process.env.RAILWAY_BOOTSTRAP_TIMEOUT_MS ?? 90_000);
/** Let Nest bind /health first; then run schema work. */
const BOOTSTRAP_DELAY_MS = Number(process.env.RAILWAY_BOOTSTRAP_DELAY_MS ?? 15_000);

function warnIfMissing(name) {
  if (!process.env[name]?.trim()) {
    console.error(`[railway] Missing ${name} — starting API anyway so /health can bind.`);
  }
}

function startBootstrapInBackground() {
  if (process.env.RAILWAY_SKIP_BOOTSTRAP === "1") {
    console.warn("[railway] RAILWAY_SKIP_BOOTSTRAP=1 — skipping schema bootstrap");
    return;
  }

  console.warn(
    `[railway] Schema bootstrap starting in ${Math.round(BOOTSTRAP_DELAY_MS / 1000)}s (timeout ${Math.round(BOOTSTRAP_TIMEOUT_MS / 1000)}s)`,
  );

  setTimeout(() => {
    const child = spawn(process.execPath, [join(scriptDir, "bootstrap-live-db.mjs")], {
      cwd: apiRoot,
      stdio: "inherit",
      env: process.env,
    });

    const timer = setTimeout(() => {
      console.error(
        `[railway] Schema bootstrap exceeded ${BOOTSTRAP_TIMEOUT_MS}ms — killing bootstrap (API keeps running)`,
      );
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, BOOTSTRAP_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      console.error("[railway] Bootstrap spawn failed:", err.message);
    });

    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        console.error(`[railway] Bootstrap stopped by signal ${signal}`);
        return;
      }
      if (code === 0) {
        console.log("[railway] Schema bootstrap finished OK");
        return;
      }
      console.error(`[railway] Bootstrap exited with code ${code ?? "?"} (API keeps running)`);
    });
  }, BOOTSTRAP_DELAY_MS);
}

function startApiServer() {
  console.log("[railway] Starting API server…");
  const api = spawn(process.execPath, ["dist/main.js"], {
    cwd: apiRoot,
    stdio: "inherit",
    env: process.env,
  });

  const forward = (signal) => {
    try {
      api.kill(signal);
    } catch {
      // ignore
    }
  };
  process.on("SIGTERM", () => forward("SIGTERM"));
  process.on("SIGINT", () => forward("SIGINT"));

  api.on("error", (err) => {
    console.error("[railway] Failed to start API:", err);
    process.exit(1);
  });

  api.on("exit", (code, signal) => {
    if (signal) {
      console.error(`[railway] API exited from signal ${signal}`);
      process.exit(1);
    }
    process.exit(code ?? 0);
  });
}

warnIfMissing("DATABASE_URL");
warnIfMissing("JWT_ACCESS_SECRET");
mkdirSync(join(apiRoot, "data", "uploads"), { recursive: true });

console.log("[railway] boot-mode=early-express-v2 (Nest binds /health before module init; no public proxy)");
startApiServer();
startBootstrapInBackground();
