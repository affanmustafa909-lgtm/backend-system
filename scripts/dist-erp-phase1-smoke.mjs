/**
 * Phase 1 Dist ERP smoke: geo + ps-window + order advance + reports.
 * Usage: node scripts/dist-erp-phase1-smoke.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
const envRaw = fs.readFileSync(envPath, "utf8");
const API = (envRaw.match(/^API_URL=(.+)$/m) || envRaw.match(/^PUBLIC_API_URL=(.+)$/m) || [])[1]?.trim()
  || process.env.API_URL
  || "https://backend-system-production-28a3.up.railway.app";
const PASS = (envRaw.match(/^SEED_USER_PASSWORD=(.+)$/m) || [])[1]?.trim() || "Owner@12345";

async function json(res) {
  const t = await res.text();
  try {
    return JSON.parse(t);
  } catch {
    return { raw: t };
  }
}

async function main() {
  console.log("API", API);
  const login = await fetch(`${API}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin.distribution@pops.demo", password: PASS }),
  });
  const loginBody = await json(login);
  if (!login.ok) {
    console.error("login failed", login.status, loginBody);
    process.exit(1);
  }
  const token = loginBody.accessToken || loginBody.token;
  const h = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  const get = async (p) => {
    const r = await fetch(`${API}${p}`, { headers: h });
    const b = await json(r);
    if (!r.ok) throw new Error(`${p} → ${r.status} ${JSON.stringify(b)}`);
    return b;
  };
  const post = async (p, body) => {
    const r = await fetch(`${API}${p}`, { method: "POST", headers: h, body: JSON.stringify(body) });
    const b = await json(r);
    if (!r.ok) throw new Error(`${p} → ${r.status} ${JSON.stringify(b)}`);
    return b;
  };

  const suffix = Date.now().toString(36).slice(-4).toUpperCase();
  const province = await post("/v1/pharmacy/provinces", { code: `P-${suffix}`, name: `Prov ${suffix}` });
  const division = await post("/v1/pharmacy/divisions", {
    provinceId: province.id,
    code: `DV-${suffix}`,
    name: `Div ${suffix}`,
  });
  const district = await post("/v1/pharmacy/districts", {
    divisionId: division.id,
    code: `DT-${suffix}`,
    name: `Dist ${suffix}`,
  });
  const city = await post("/v1/pharmacy/cities", {
    code: `CT-${suffix}`,
    name: `City ${suffix}`,
    districtId: district.id,
  });
  const area = await post("/v1/pharmacy/areas", {
    cityId: city.id,
    code: `AR-${suffix}`,
    name: `Area ${suffix}`,
  });
  const geoT = await post("/v1/pharmacy/geo-territories", {
    areaId: area.id,
    code: `GT-${suffix}`,
    name: `Terr ${suffix}`,
  });
  const route = await post("/v1/pharmacy/routes", {
    areaId: area.id,
    geoTerritoryId: geoT.id,
    code: `RT-${suffix}`,
    name: `Beat ${suffix}`,
    sequenceNo: 1,
    pjpDayOfWeek: 1,
  });
  console.log("geo ok", { province: province.code, route: route.code });

  const ps = await get("/v1/pharmacy/distribution/ps-window?branchCode=DIST-HQ");
  console.log("ps-window", {
    ordersToday: ps.sales?.ordersToday,
    pendingDeliveries: ps.distribution?.pendingDeliveries,
    nearExpiry: ps.stock?.nearExpiryBatches,
  });

  for (const id of [
    "daily-sales",
    "outstanding-aging",
    "stock-near-expiry",
    "pending-deliveries",
    "visit-coverage",
    "target-vs-achievement",
    "city-sales",
  ]) {
    const rep = await get(`/v1/pharmacy/distribution/reports/${id}?branchCode=DIST-HQ`);
    console.log(`report ${id}: ${rep.rows?.length ?? 0} rows`);
  }

  console.log("phase1 smoke PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
