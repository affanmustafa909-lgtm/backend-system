/**
 * Phase 3 masters smoke — creates linked reference masters + medicine, verifies search/pagination.
 *
 *   node scripts/phase3-masters-smoke.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
const envRaw = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const getEnv = (k, fallback = "") => {
  const m = envRaw.match(new RegExp(`^${k}=(.+)$`, "m"));
  return (m?.[1] ?? fallback).trim().replace(/^["']|["']$/g, "");
};

const API = (process.env.API_BASE || "http://127.0.0.1:3000").replace(/\/$/, "");
const EMAIL = process.env.DIST_EMAIL || "admin.distribution@pops.demo";
const PASSWORD = process.env.DIST_PASSWORD || getEnv("SEED_USER_PASSWORD", "Owner@12345");
const BRANCH = process.env.BRANCH_CODE || "DIST-HQ";
const stamp = Date.now().toString(36).slice(-5).toUpperCase();

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail: String(detail).slice(0, 240) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? " — " + String(detail).slice(0, 120) : ""}`);
}

async function req(method, urlPath, { token, body, query } = {}) {
  const u = new URL(API + urlPath);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(u, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { res, json };
}

async function step(name, fn) {
  try {
    const detail = await fn();
    record(name, true, detail ?? "");
    return true;
  } catch (e) {
    record(name, false, e.message || e);
    return false;
  }
}

function assertOk(res, json, label) {
  if (!res.ok) {
    const msg = json?.message
      ? Array.isArray(json.message)
        ? json.message.join(", ")
        : json.message
      : `${res.status}`;
    throw new Error(`${label}: ${msg}`);
  }
}

async function main() {
  console.log(`API=${API} branch=${BRANCH}`);

  let token;
  await step("login", async () => {
    const { res, json } = await req("POST", "/v1/auth/login", {
      body: { email: EMAIL, password: PASSWORD },
    });
    assertOk(res, json, "login");
    token = json.accessToken || json.token;
    if (!token) throw new Error("no token");
    return EMAIL;
  });

  await step("unauthorized masters blocked", async () => {
    const { res } = await req("GET", "/v1/pharmacy/masters/overview");
    if (res.status === 401 || res.status === 403) return String(res.status);
    // If route missing (old deploy): 404
    if (res.status === 404) throw new Error("masters routes not deployed (404)");
    throw new Error(`expected 401/403 got ${res.status}`);
  });

  await step("masters overview", async () => {
    const { res, json } = await req("GET", "/v1/pharmacy/masters/overview", {
      token,
      query: { branchCode: BRANCH },
    });
    assertOk(res, json, "overview");
    return JSON.stringify(json).slice(0, 120);
  });

  await step("data quality", async () => {
    const { res, json } = await req("GET", "/v1/pharmacy/masters/data-quality", {
      token,
      query: { branchCode: BRANCH },
    });
    assertOk(res, json, "dq");
    return `keys=${Object.keys(json || {}).join(",")}`;
  });

  let companyId, genericId, brandId, categoryId, dosageFormId, unitId, taxId, medicineId;

  await step("create company", async () => {
    const { res, json } = await req("POST", "/v1/pharmacy/companies", {
      token,
      body: { code: `COM-${stamp}`, name: `Phase3 Co ${stamp}`, phone: "0300" },
    });
    assertOk(res, json, "company");
    companyId = json.id;
    return companyId;
  });

  await step("create generic", async () => {
    const { res, json } = await req("POST", "/v1/pharmacy/masters/generics", {
      token,
      body: { code: `GEN-${stamp}`, name: `Paracetamol ${stamp}` },
    });
    assertOk(res, json, "generic");
    genericId = json.id;
    return genericId;
  });

  await step("reject duplicate generic code", async () => {
    const { res } = await req("POST", "/v1/pharmacy/masters/generics", {
      token,
      body: { code: `GEN-${stamp}`, name: "Dup" },
    });
    if (res.ok) throw new Error("duplicate allowed");
    return String(res.status);
  });

  await step("create brand", async () => {
    const { res, json } = await req("POST", "/v1/pharmacy/masters/brands", {
      token,
      body: { code: `BR-${stamp}`, name: `Brand ${stamp}`, companyId },
    });
    assertOk(res, json, "brand");
    brandId = json.id;
    return brandId;
  });

  await step("create category", async () => {
    const { res, json } = await req("POST", "/v1/pharmacy/masters/categories", {
      token,
      body: { code: `CAT-${stamp}`, name: `Pain ${stamp}` },
    });
    assertOk(res, json, "category");
    categoryId = json.id;
    return categoryId;
  });

  await step("create dosage form", async () => {
    const { res, json } = await req("POST", "/v1/pharmacy/masters/dosage-forms", {
      token,
      body: { code: `DF-${stamp}`, name: "Tablet" },
    });
    assertOk(res, json, "dosage");
    dosageFormId = json.id;
    return dosageFormId;
  });

  await step("create unit", async () => {
    const { res, json } = await req("POST", "/v1/pharmacy/masters/units", {
      token,
      body: { code: `UN-${stamp}`, name: "Pack" },
    });
    assertOk(res, json, "unit");
    unitId = json.id;
    return unitId;
  });

  await step("create tax profile", async () => {
    const { res, json } = await req("POST", "/v1/pharmacy/masters/tax-profiles", {
      token,
      body: { code: `TAX-${stamp}`, name: "GST 0", ratePct: 0 },
    });
    assertOk(res, json, "tax");
    taxId = json.id;
    return taxId;
  });

  await step("create medicine via pharmacy POST then patch FKs", async () => {
    const sku = `MED-${stamp}`;
    const { res, json } = await req("POST", "/v1/pharmacy/medicines", {
      token,
      body: {
        branchCode: BRANCH,
        sku,
        name: `Test Med ${stamp}`,
        category: "Tablet",
        wholesalePrice: 100,
        sellingPrice: 120,
        companyId,
      },
    });
    assertOk(res, json, "medicine create");
    medicineId = json.id;
    const patch = await req("PATCH", `/v1/pharmacy/masters/medicines/${medicineId}`, {
      token,
      body: {
        genericId,
        brandId,
        categoryId,
        dosageFormId,
        unitId,
        taxProfileId: taxId,
        batchTrackingEnabled: true,
        fefoEnabled: true,
      },
    });
    assertOk(patch.res, patch.json, "medicine patch");
    return medicineId;
  });

  await step("paged medicine search", async () => {
    const { res, json } = await req("GET", "/v1/pharmacy/masters/medicines", {
      token,
      query: { branchCode: BRANCH, q: stamp, page: 1, pageSize: 10 },
    });
    assertOk(res, json, "search");
    const items = json.items || json.data || [];
    if (!items.length && json.total === 0) throw new Error("search empty");
    return `total=${json.total ?? items.length}`;
  });

  await step("medicine detail joins", async () => {
    const { res, json } = await req("GET", `/v1/pharmacy/masters/medicines/${medicineId}`, {
      token,
    });
    assertOk(res, json, "detail");
    return json.name || json.id;
  });

  await step("deactivate medicine", async () => {
    const { res, json } = await req("POST", `/v1/pharmacy/masters/medicines/${medicineId}/status`, {
      token,
      body: { status: "inactive" },
    });
    assertOk(res, json, "status");
    return json.status || "inactive";
  });

  const failed = results.filter((r) => !r.ok).length;
  const out = path.join(__dirname, `phase3-masters-smoke-${stamp}.json`);
  fs.writeFileSync(out, JSON.stringify({ api: API, results, failed }, null, 2));
  console.log(`Wrote ${out} failed=${failed}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
