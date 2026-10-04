/**
 * Static check: every Dist nav / report deep-link path has a matching React route.
 * Does not require browser login.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..", "Universal-application-system-", "apps", "launcher", "src");

const routesFile = fs.readFileSync(path.join(root, "routes", "distributionRoutes.tsx"), "utf8");
const navFile = fs.readFileSync(path.join(root, "distribution", "spec", "nav.ts"), "utf8");
const reportsFile = fs.readFileSync(path.join(root, "distribution", "spec", "reports.ts"), "utf8");
const psFile = fs.readFileSync(path.join(root, "distribution", "pages", "DistributionPsWindowPage.tsx"), "utf8");

const routePaths = new Set(
  [...routesFile.matchAll(/path="(distribution\/[^"]+)"/g)].map((m) => m[1].replace(/\/:[^/]+/g, "")),
);

function basePath(p) {
  return p
    .replace(/^\/?pops\//, "")
    .replace(/^\//, "")
    .split("?")[0]
    .replace(/\/:[^/]+/g, "");
}

const links = new Set();
for (const m of navFile.matchAll(/path:\s*"([^"]+)"/g)) links.add(m[1]);
for (const m of reportsFile.matchAll(/to:\s*"([^"]+)"/g)) links.add(m[1]);
for (const m of psFile.matchAll(/to:\s*"([^"]+)"/g)) links.add(m[1]);

const required = [
  "distribution/bonus-reports",
  "distribution/bonus-attach",
  "distribution/customer-reports",
  "distribution/reports",
  "distribution/trade-customers",
];

let fail = 0;
console.log("\n=== Dist frontend link / route check ===\n");
for (const req of required) {
  const ok = [...routePaths].some((r) => r === req || r.startsWith(req + "/"));
  console.log(`[${ok ? "PASS" : "FAIL"}] route registered: ${req}`);
  if (!ok) fail += 1;
}

const missing = [];
for (const link of links) {
  if (link.startsWith("http") || link.startsWith("accounting") || link.startsWith("auth") || link.startsWith("multi-branch") || link.startsWith("notifications") || link.startsWith("printer") || link.startsWith("tax") || link.startsWith("security") || link.startsWith("settings") || link.startsWith("closing") || link.startsWith("sync")) {
    continue;
  }
  const b = basePath(link);
  if (!b.startsWith("distribution/")) continue;
  const ok = [...routePaths].some((r) => b === r || b.startsWith(r + "/") || r.startsWith(b));
  // parameterized routes: trade-customers/:id covers trade-customers
  const ok2 =
    ok ||
    [...routePaths].some((r) => {
      const base = r.split("/").slice(0, b.split("/").length).join("/");
      return base === b;
    });
  if (!ok2) missing.push(link);
}

if (missing.length) {
  console.log("\nMissing routes for links:");
  for (const m of missing) {
    console.log("  FAIL", m);
    fail += 1;
  }
} else {
  console.log(`[PASS] all ${links.size} dist nav/report/ps links resolve to a route`);
}

// Bonus + customer report deep links
const deep = [
  "/pops/distribution/bonus-reports?tab=customer",
  "/pops/distribution/bonus-reports?tab=scheme",
  "/pops/distribution/customer-reports?tab=bonus",
  "/pops/distribution/customer-reports?tab=sales",
  "/pops/distribution/customer-reports?tab=credit",
  "/pops/distribution/reports?category=Customer",
  "/pops/distribution/reports?category=Bonus",
];
for (const d of deep) {
  const b = basePath(d);
  const ok = [...routePaths].some((r) => r === b);
  console.log(`[${ok ? "PASS" : "FAIL"}] deep link base: ${d}`);
  if (!ok) fail += 1;
}

console.log(`\n=== Link check: ${fail ? fail + " FAIL" : "ALL PASS"} ===\n`);
process.exit(fail ? 1 : 0);
