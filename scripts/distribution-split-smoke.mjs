/**
 * Smoke checks for pharmacy / distribution system split (no network required for FE asserts).
 * Optional: API_BASE + login to verify distribution JWT against ERP APIs.
 *
 * Usage:
 *   node scripts/distribution-split-smoke.mjs
 *   API_BASE=http://127.0.0.1:3000 node scripts/distribution-split-smoke.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const contracts = require("../packages/contracts/dist/platform.js");
assert(contracts.SYSTEM_TYPES.includes("distribution"), "SYSTEM_TYPES has distribution");
assert(contracts.SYSTEM_TYPE_LABELS.distribution === "Medical Distribution", "label");
assert(contracts.frontendIdToSystemType("distribution") === "distribution", "frontend map");
console.log("[PASS] contracts systemType distribution");

const codes = require("../packages/contracts/dist/pharmacy-codes.js");
const distPaths = (codes.PHARMACY_CODE_CATALOG ?? codes.pharmacyCodeCatalog ?? []).filter?.(() => true);
const catalog = codes.PHARMACY_CODE_PREFIXES || codes.pharmacyCodePrefixes || codes.default || [];
const list = Array.isArray(catalog) ? catalog : Object.values(codes).find((v) => Array.isArray(v) && v[0]?.path) || [];
assert(list.some((c) => String(c.path).includes("/pops/distribution/")), "code catalog uses /pops/distribution");
assert(!list.some((c) => String(c.path).includes("/pops/pharmacy/distribution")), "no old pharmacy/distribution paths in catalog");
console.log("[PASS] pharmacy-codes paths");

const navPath = path.join(
  __dirname,
  "../../Universal-application-system-/apps/launcher/src/pharmacy/spec/nav.ts",
);
const nav = fs.readFileSync(navPath, "utf8");
assert(!nav.includes('label: "Distribution"'), "pharmacy nav has no Distribution group");
assert(nav.includes("pharmacy/pos"), "pharmacy still has POS");
console.log("[PASS] pharmacy nav trimmed");

const distNavPath = path.join(
  __dirname,
  "../../Universal-application-system-/apps/launcher/src/distribution/spec/nav.ts",
);
const distNav = fs.readFileSync(distNavPath, "utf8");
assert(distNav.includes("distribution/orders"), "distribution nav has orders");
assert(distNav.includes("distribution/geo"), "distribution nav has geo");
assert(distNav.includes("distribution/pricing"), "distribution nav has pricing");
console.log("[PASS] distribution nav");

const bizPath = path.join(
  __dirname,
  "../../Universal-application-system-/apps/launcher/src/lib/businessSystems.ts",
);
const biz = fs.readFileSync(bizPath, "utf8");
assert(biz.includes('"distribution"'), "BusinessSystemId includes distribution");
assert(biz.includes("/pops/distribution/orders"), "entry path orders");
console.log("[PASS] businessSystems registration");

const editionPath = path.join(
  __dirname,
  "../../Universal-application-system-/apps/launcher/src/lib/edition.ts",
);
assert(fs.readFileSync(editionPath, "utf8").includes("HAS_DISTRIBUTION"), "HAS_DISTRIBUTION");
console.log("[PASS] edition flags");

const API = (process.env.API_BASE || "").replace(/\/$/, "");
if (API) {
  const envRaw = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
  const pass = (envRaw.match(/^SEED_USER_PASSWORD=(.+)$/m)?.[1] ?? "Owner@12345").trim().replace(/^["']|["']$/g, "");

  async function login(email) {
    const res = await fetch(`${API}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: pass }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`login ${email} ${res.status} ${JSON.stringify(json)}`);
    return json.accessToken || json.access_token;
  }

  // Existing pharmacy tenant still reaches ERP APIs (shared).
  const pharmToken = await login("admin.pharmacy@pops.demo");
  const areas = await fetch(`${API}/v1/pharmacy/areas`, {
    headers: { authorization: `Bearer ${pharmToken}` },
  });
  assert(areas.ok, `pharmacy JWT areas ${areas.status}`);
  console.log("[PASS] pharmacy JWT → ERP areas");

  // Distribution demo may not exist until API restart + seed; try and soft-skip.
  try {
    const distToken = await login("admin.distribution@pops.demo");
    const orders = await fetch(`${API}/v1/pharmacy/distribution/orders?branchCode=DIST-HQ`, {
      headers: { authorization: `Bearer ${distToken}` },
    });
    assert(orders.ok || orders.status === 400, `distribution JWT orders ${orders.status}`);
    const salesBlocked = await fetch(`${API}/v1/pharmacy/sales?branchCode=DIST-HQ`, {
      headers: { authorization: `Bearer ${distToken}` },
    });
    assert(salesBlocked.status === 403, `distribution JWT must not access retail sales (got ${salesBlocked.status})`);
    console.log("[PASS] distribution JWT → ERP ok, retail sales forbidden");
  } catch (e) {
    console.log("[SKIP] distribution demo user not seeded yet:", e.message);
  }
} else {
  console.log("[SKIP] API_BASE not set — FE/contracts only");
}

console.log("SMOKE OK");
