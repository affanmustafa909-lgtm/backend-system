/**
 * Copy API + shared packages from Universal-application-system into backend-system/.
 *
 * Run from backend-system/ after changing apps/api or packages/* in Universal.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const standaloneRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const parent = join(standaloneRoot, "..");

function resolveMonorepoRoot() {
  const sibling = join(parent, "Universal-application-system");
  if (existsSync(join(sibling, "apps", "api", "src"))) return sibling;
  if (existsSync(join(parent, "apps", "api", "src"))) return parent;
  return sibling;
}

const monorepoRoot = resolveMonorepoRoot();

const SKIP_DIR_NAMES = new Set(["node_modules", "dist", ".turbo", "data"]);

function copyTree(src, dest) {
  if (!existsSync(src)) {
    console.warn(`[sync] Skip missing: ${src}`);
    return;
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });

  cpSync(src, dest, {
    recursive: true,
    filter: (sourcePath) => {
      const parts = sourcePath.split(/[/\\]/);
      return !parts.some((part) => SKIP_DIR_NAMES.has(part));
    },
  });
  console.log(`[sync] ${basename(src)} → ${dest}`);
}

if (!existsSync(join(monorepoRoot, "apps", "api", "src"))) {
  console.error(`[sync] Universal API not found at ${monorepoRoot}\\apps\\api\\src`);
  process.exit(1);
}

const copies = [
  [join(monorepoRoot, "apps", "api", "src"), join(standaloneRoot, "api", "src")],
  [join(monorepoRoot, "apps", "api", "scripts"), join(standaloneRoot, "api", "scripts")],
  [join(monorepoRoot, "packages", "contracts"), join(standaloneRoot, "packages", "contracts")],
  [join(monorepoRoot, "packages", "database-pg"), join(standaloneRoot, "packages", "database-pg")],
  [join(monorepoRoot, "packages", "config"), join(standaloneRoot, "packages", "config")],
];

console.log(`[sync] Source: ${monorepoRoot}`);
for (const [src, dest] of copies) {
  copyTree(src, dest);
}

const startScript = join(standaloneRoot, "api", "scripts", "start-railway.mjs");
if (existsSync(startScript)) {
  const text = readFileSync(startScript, "utf8");
  if (!text.includes("resolve-workspace.mjs")) {
    console.warn("[sync] Warning: start-railway.mjs may need resolve-workspace import — check api/scripts/");
  }
}

console.log("[sync] backend-system is up to date with Universal-application-system.");
