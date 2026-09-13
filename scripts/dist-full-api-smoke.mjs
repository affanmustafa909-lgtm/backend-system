/**
 * Full Distribution API catalog smoke against live (or API_BASE).
 * Read-heavy coverage of every Dist domain + light write smoke for critical paths.
 *
 * Usage:
 *   node scripts/dist-full-api-smoke.mjs
 *   API_BASE=https://backend-system-production-28a3.up.railway.app node scripts/dist-full-api-smoke.mjs
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

const API = (
  process.env.API_BASE ||
  process.env.API_URL ||
  "https://backend-system-production-28a3.up.railway.app"
).replace(/\/$/, "");
const EMAIL = process.env.DIST_EMAIL || "admin.distribution@pops.demo";
const PASSWORD = process.env.DIST_PASSWORD || getEnv("SEED_USER_PASSWORD", "Owner@12345");
const BRANCH = process.env.BRANCH_CODE || "DIST-HQ";

const results = [];
let token = "";
let ids = {};

function outPath() {
  const docs = path.join(__dirname, "..", "..", "Universal-application-system-", "docs");
  if (fs.existsSync(docs)) return path.join(docs, "DIST_FULL_API_SMOKE.json");
  return path.join(__dirname, "DIST_FULL_API_SMOKE.json");
}

async function req(method, pathName, { query, body, expectOk = true } = {}) {
  const url = new URL(`${API}${pathName}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const started = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
      data: null,
    };
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text?.slice(0, 240) ?? null;
  }
  const errMsg =
    typeof data === "object" && data && (data.message || data.error)
      ? Array.isArray(data.message)
        ? data.message.join("; ")
        : String(data.message || data.error)
      : text?.slice(0, 180) || res.statusText;
  return {
    ok: expectOk ? res.ok : true,
    status: res.status,
    ms: Date.now() - started,
    error: res.ok ? null : errMsg,
    data,
    rawOk: res.ok,
  };
}

function record(group, name, r, note = "") {
  const passed = Boolean(r.ok || r.rawOk);
  results.push({
    group,
    name,
    passed,
    status: r.status,
    ms: r.ms,
    error: r.error,
    note,
  });
  const tag = passed ? "PASS" : "FAIL";
  const detail = passed
    ? `${r.status} ${r.ms}ms${note ? ` — ${note}` : ""}`
    : `${r.status} ${r.ms}ms — ${r.error}${note ? ` (${note})` : ""}`;
  console.log(`[${tag}] ${group.padEnd(14)} ${name.padEnd(56)} ${detail}`);
  return passed;
}

async function get(group, name, pathName, query = {}, note = "") {
  const r = await req("GET", pathName, { query: { branchCode: BRANCH, ...query } });
  return record(group, name, r, note);
}

async function post(group, name, pathName, body, query = {}) {
  const r = await req("POST", pathName, { query: { branchCode: BRANCH, ...query }, body });
  return { passed: record(group, name, r), r };
}

function firstId(data, keys = ["id", "items", "data"]) {
  if (!data) return null;
  if (data.id) return data.id;
  const items = data.items ?? data.data ?? data.rows ?? data.results;
  if (Array.isArray(items) && items[0]?.id) return items[0].id;
  if (Array.isArray(data) && data[0]?.id) return data[0].id;
  for (const k of keys) {
    if (data[k]?.id) return data[k].id;
  }
  return null;
}

async function main() {
  console.log(`\n=== Dist full API smoke ===`);
  console.log(`API     ${API}`);
  console.log(`USER    ${EMAIL}`);
  console.log(`BRANCH  ${BRANCH}\n`);

  // ── Auth ──────────────────────────────────────────────────────────────
  const login = await req("POST", "/v1/auth/login", {
    body: { email: EMAIL, password: PASSWORD },
  });
  if (!record("auth", "POST /v1/auth/login", login) || !login.data?.accessToken) {
    console.error("Login failed — aborting");
    process.exit(1);
  }
  token = login.data.accessToken;

  // ── Lookups / masters / geo ───────────────────────────────────────────
  await get("lookup", "GET /v1/pharmacy/lookup", "/v1/pharmacy/lookup", { q: "a" });
  await get("lookup", "GET /v1/pharmacy/code-catalog", "/v1/pharmacy/code-catalog");
  await get("masters", "GET /v1/pharmacy/masters/overview", "/v1/pharmacy/masters/overview");
  await get("masters", "GET /v1/pharmacy/masters/data-quality", "/v1/pharmacy/masters/data-quality");
  await get("masters", "GET /v1/pharmacy/masters/generics", "/v1/pharmacy/masters/generics");
  await get("masters", "GET /v1/pharmacy/masters/brands", "/v1/pharmacy/masters/brands");
  await get("masters", "GET /v1/pharmacy/masters/categories", "/v1/pharmacy/masters/categories");
  await get("masters", "GET /v1/pharmacy/masters/units", "/v1/pharmacy/masters/units");
  await get("masters", "GET /v1/pharmacy/masters/medicines", "/v1/pharmacy/masters/medicines", {
    page: 1,
    pageSize: 5,
  });

  await get("companies", "GET /v1/pharmacy/companies", "/v1/pharmacy/companies", {
    page: 1,
    pageSize: 5,
  });
  const wh = await req("GET", "/v1/pharmacy/warehouses", { query: { branchCode: BRANCH } });
  record("warehouses", "GET /v1/pharmacy/warehouses", wh);
  ids.warehouseId = firstId(wh.data);

  await get("geo", "GET /v1/pharmacy/provinces", "/v1/pharmacy/provinces");
  await get("geo", "GET /v1/pharmacy/cities", "/v1/pharmacy/cities");
  await get("geo", "GET /v1/pharmacy/areas", "/v1/pharmacy/areas");
  await get("geo", "GET /v1/pharmacy/routes", "/v1/pharmacy/routes");
  await get("geo", "GET /v1/pharmacy/territories", "/v1/pharmacy/territories");

  const cust = await req("GET", "/v1/pharmacy/trade-customers", {
    query: { branchCode: BRANCH, page: 1, pageSize: 5 },
  });
  record("customers", "GET /v1/pharmacy/trade-customers", cust);
  ids.customerId = firstId(cust.data);

  const meds = await req("GET", "/v1/pharmacy/medicines", {
    query: { branchCode: BRANCH, page: 1, pageSize: 5 },
  });
  record("medicines", "GET /v1/pharmacy/medicines", meds);
  ids.medicineId = firstId(meds.data);
  if (ids.medicineId) {
    await get(
      "medicines",
      "GET /v1/pharmacy/medicines/:id/batches",
      `/v1/pharmacy/medicines/${ids.medicineId}/batches`,
    );
  }
  await get("batches", "GET /v1/pharmacy/batches", "/v1/pharmacy/batches", { page: 1, pageSize: 5 });

  // ── Inventory ─────────────────────────────────────────────────────────
  await get("inventory", "GET inventory/dashboard", "/v1/pharmacy/inventory/dashboard");
  await get("inventory", "GET inventory/stock", "/v1/pharmacy/inventory/stock", {
    page: 1,
    pageSize: 5,
  });
  await get("inventory", "GET inventory/batches", "/v1/pharmacy/inventory/batches", {
    page: 1,
    pageSize: 5,
  });
  await get("inventory", "GET inventory/expiry/buckets", "/v1/pharmacy/inventory/expiry/buckets");
  await get("inventory", "GET inventory/ledger", "/v1/pharmacy/inventory/ledger", {
    page: 1,
    pageSize: 5,
  });
  await get("inventory", "GET inventory/valuation/summary", "/v1/pharmacy/inventory/valuation/summary");
  await get("inventory", "GET inventory/reorder", "/v1/pharmacy/inventory/reorder");
  await get("inventory", "GET inventory/transfers", "/v1/pharmacy/inventory/transfers", {
    page: 1,
    pageSize: 5,
  });
  await get("inventory", "GET inventory/adjustments", "/v1/pharmacy/inventory/adjustments", {
    page: 1,
    pageSize: 5,
  });
  await get("inventory", "GET inventory/counts", "/v1/pharmacy/inventory/counts", {
    page: 1,
    pageSize: 5,
  });
  await get("inventory", "GET inventory/settings", "/v1/pharmacy/inventory/settings");

  // ── Purchase ──────────────────────────────────────────────────────────
  await get("purchase", "GET purchase/dashboard", "/v1/pharmacy/purchase/dashboard");
  await get("purchase", "GET purchase/requisitions", "/v1/pharmacy/purchase/requisitions", {
    page: 1,
    pageSize: 5,
  });
  const pos = await req("GET", "/v1/pharmacy/purchase/orders", {
    query: { branchCode: BRANCH, page: 1, pageSize: 10 },
  });
  record("purchase", "GET purchase/orders", pos);
  ids.poId = firstId(pos.data);
  if (ids.poId) {
    await get("purchase", "GET purchase/orders/:id", `/v1/pharmacy/purchase/orders/${ids.poId}`);
  }
  await get("purchase", "GET purchase/grns", "/v1/pharmacy/purchase/grns", {
    page: 1,
    pageSize: 5,
  });
  await get("purchase", "GET purchase/invoices", "/v1/pharmacy/purchase/invoices", {
    page: 1,
    pageSize: 5,
  });
  await get("purchase", "GET purchase/returns", "/v1/pharmacy/purchase/returns", {
    page: 1,
    pageSize: 5,
  });
  await get("purchase", "GET purchase/suppliers/search", "/v1/pharmacy/purchase/suppliers/search", {
    q: "a",
  });
  // legacy fallbacks
  await get("purchase", "GET purchase-orders (legacy)", "/v1/pharmacy/purchase-orders", {
    page: 1,
    pageSize: 5,
  });
  await get("purchase", "GET grns (legacy)", "/v1/pharmacy/grns", { page: 1, pageSize: 5 });

  // ── Sales / PS / orders ───────────────────────────────────────────────
  await get("sales", "GET sales/products/search", "/v1/pharmacy/sales/products/search", {
    q: "aug",
  });
  await get("sales", "GET sales/customers/search", "/v1/pharmacy/sales/customers/search", {
    q: "a",
  });
  await get("sales", "GET sales/held", "/v1/pharmacy/sales/held");
  await get("orders", "GET distribution/orders", "/v1/pharmacy/distribution/orders", {
    page: 1,
    pageSize: 5,
  });
  await get("orders", "GET distribution/invoices", "/v1/pharmacy/distribution/invoices", {
    page: 1,
    pageSize: 5,
  });
  await get("orders", "GET distribution/ps-window", "/v1/pharmacy/distribution/ps-window");
  await get("orders", "GET distribution/ps-window/widgets", "/v1/pharmacy/distribution/ps-window/widgets");
  await get("dash", "GET distribution/dashboard/summary", "/v1/pharmacy/distribution/dashboard/summary");
  await get("dash", "GET …/sales-trend", "/v1/pharmacy/distribution/dashboard/sales-trend");
  await get("dash", "GET …/top-products", "/v1/pharmacy/distribution/dashboard/top-products");
  await get("dash", "GET …/top-customers", "/v1/pharmacy/distribution/dashboard/top-customers");
  await get("dash", "GET …/action-center", "/v1/pharmacy/distribution/dashboard/action-center");
  await get("dash", "GET …/stock-health", "/v1/pharmacy/distribution/dashboard/stock-health");
  await get("dash", "GET …/field-force", "/v1/pharmacy/distribution/dashboard/field-force");

  // ── Pricing ───────────────────────────────────────────────────────────
  await get("pricing", "GET pricing/lists", "/v1/pharmacy/pricing/lists");
  await get("pricing", "GET pricing/schemes", "/v1/pharmacy/pricing/schemes");
  if (ids.medicineId) {
    await get("pricing", "GET pricing/resolve", "/v1/pharmacy/pricing/resolve", {
      medicineId: ids.medicineId,
    });
  }

  // ── Delivery ──────────────────────────────────────────────────────────
  await get("delivery", "GET delivery/dashboard", "/v1/pharmacy/delivery/dashboard");
  await get("delivery", "GET delivery/drivers", "/v1/pharmacy/delivery/drivers");
  await get("delivery", "GET delivery/vehicles", "/v1/pharmacy/delivery/vehicles");
  await get("delivery", "GET delivery/orders", "/v1/pharmacy/delivery/orders", {
    page: 1,
    pageSize: 5,
  });
  await get("delivery", "GET distribution/deliveries (legacy)", "/v1/pharmacy/distribution/deliveries", {
    page: 1,
    pageSize: 5,
  });

  // ── Collections ───────────────────────────────────────────────────────
  await get("collections", "GET collections/dashboard", "/v1/pharmacy/collections/dashboard");
  await get("collections", "GET collections/aging", "/v1/pharmacy/collections/aging");
  await get("collections", "GET collections/recovery", "/v1/pharmacy/collections/recovery");
  await get("collections", "GET collections/promises", "/v1/pharmacy/collections/promises");
  await get("collections", "GET /v1/pharmacy/collections", "/v1/pharmacy/collections", {
    page: 1,
    pageSize: 5,
  });
  await get(
    "collections",
    "GET distribution/collections (legacy)",
    "/v1/pharmacy/distribution/collections",
    { page: 1, pageSize: 5 },
  );
  if (ids.customerId) {
    await get(
      "collections",
      "GET trade-customers/:id/ledger",
      `/v1/pharmacy/trade-customers/${ids.customerId}/ledger`,
    );
  }

  // ── Field force ───────────────────────────────────────────────────────
  await get("field", "GET field-force/dashboard", "/v1/pharmacy/field-force/dashboard");
  await get("field", "GET field-force/performance", "/v1/pharmacy/field-force/performance");
  await get("field", "GET field-force/coverage", "/v1/pharmacy/field-force/coverage");
  await get("field", "GET field-force/salesmen", "/v1/pharmacy/field-force/salesmen");
  const routes = await req("GET", "/v1/pharmacy/routes", { query: { branchCode: BRANCH } });
  ids.routeId = firstId(routes.data);
  if (ids.routeId) {
    await get("field", "GET field-force/routes/:id", `/v1/pharmacy/field-force/routes/${ids.routeId}`);
  }
  const pjps = await req("GET", "/v1/pharmacy/field-force/pjp", {
    query: { branchCode: BRANCH, page: 1, pageSize: 5 },
  });
  record("field", "GET field-force/pjp", pjps);
  ids.pjpId = firstId(pjps.data);
  if (ids.pjpId) {
    await get("field", "GET field-force/pjp/:id", `/v1/pharmacy/field-force/pjp/${ids.pjpId}`);
  }
  await get("field", "GET field-force/visits", "/v1/pharmacy/field-force/visits", {
    page: 1,
    pageSize: 10,
  });
  await get("field", "GET field-force/targets", "/v1/pharmacy/field-force/targets", {
    page: 1,
    pageSize: 10,
  });
  await get("field", "GET employees-picker", "/v1/pharmacy/employees-picker");
  await get("field", "GET sales-force", "/v1/pharmacy/sales-force");

  // ── Finance / IO / reports ────────────────────────────────────────────
  await get("finance", "GET finance/dashboard", "/v1/pharmacy/finance/dashboard");
  await get("finance", "GET finance/reconciliation", "/v1/pharmacy/finance/reconciliation");
  if (ids.customerId) {
    await get(
      "finance",
      "GET finance/customer-ledger/:id",
      `/v1/pharmacy/finance/customer-ledger/${ids.customerId}`,
    );
  }
  await get("finance", "GET accounting/ledger", "/v1/accounting/ledger", { page: 1, pageSize: 5 });
  await get("finance", "GET accounting/periods", "/v1/accounting/periods");

  await get("io", "GET io/modules", "/v1/pharmacy/io/modules");
  await get("io", "GET io/jobs", "/v1/pharmacy/io/jobs");
  await get("io", "GET io/audit", "/v1/pharmacy/io/audit", { page: 1, pageSize: 5 });

  await get("reports", "GET reports/purchase-statement", "/v1/pharmacy/reports/purchase-statement");
  await get("reports", "GET reports/reorder-suggestions", "/v1/pharmacy/reports/reorder-suggestions");
  for (const reportId of [
    "daily-sales",
    "outstanding-aging",
    "stock-near-expiry",
    "pending-deliveries",
    "visit-coverage",
    "po-register",
  ]) {
    await get(
      "reports",
      `GET distribution/reports/${reportId}`,
      `/v1/pharmacy/distribution/reports/${reportId}`,
      { from: "2026-01-01", to: "2026-09-13" },
    );
  }

  // ── Write smoke (safe / reversible-ish) ───────────────────────────────
  console.log("\n--- write smoke ---");

  // Target create (with changeReason for overlap)
  const today = "2026-09-13";
  const tomorrow = "2026-09-14";
  // field-force/salesmen can be empty; employees-picker / sales-force have real IDs
  const picker = await req("GET", "/v1/pharmacy/employees-picker", { query: { branchCode: BRANCH } });
  const sf = await req("GET", "/v1/pharmacy/sales-force", { query: { branchCode: BRANCH } });
  const employeeId =
    firstId(picker.data) ||
    (Array.isArray(picker.data) ? picker.data[0]?.id : null) ||
    (Array.isArray(sf.data) ? sf.data[0]?.employeeId : null) ||
    sf.data?.items?.[0]?.employeeId;
  if (employeeId) {
    const t = await post("write", "POST field-force/targets", "/v1/pharmacy/field-force/targets", {
      branchCode: BRANCH,
      employeeId,
      periodStart: today,
      periodEnd: tomorrow,
      salesTargetPkr: 1000,
      collectionTargetPkr: 500,
      visitTarget: 2,
      changeReason: `smoke-${Date.now()}`,
    });
    if (t.r?.data?.id) ids.targetId = t.r.data.id;
  } else {
    record("write", "POST field-force/targets", { ok: false, status: 0, ms: 0, error: "no salesman" });
  }

  // Visits generate — schema field is `date` (not visitDate)
  await post("write", "POST field-force/visits/generate", "/v1/pharmacy/field-force/visits/generate", {
    branchCode: BRANCH,
    date: "2026-09-14",
  });

  // PO create if we have supplier + warehouse + medicine
  const suppliers = await req("GET", "/v1/pharmacy/purchase/suppliers/search", {
    query: { branchCode: BRANCH, q: "a" },
  });
  const supplierId =
    firstId(suppliers.data) ||
    suppliers.data?.items?.[0]?.id ||
    suppliers.data?.[0]?.id;
  if (supplierId && ids.warehouseId && ids.medicineId) {
    const poCreate = await post("write", "POST purchase/orders", "/v1/pharmacy/purchase/orders", {
      branchCode: BRANCH,
      supplierId,
      warehouseId: ids.warehouseId,
      orderDate: today,
      paymentTerms: "Net 30",
      lines: [
        {
          medicineId: ids.medicineId,
          quantity: 1,
          freeQuantity: 0,
          unitCostPkr: 10,
        },
      ],
    });
    if (poCreate.r?.data?.id) {
      ids.newPoId = poCreate.r.data.id;
      await get(
        "write",
        "GET new purchase/orders/:id",
        `/v1/pharmacy/purchase/orders/${ids.newPoId}`,
      );
    }
  } else {
    record("write", "POST purchase/orders", {
      ok: false,
      status: 0,
      ms: 0,
      error: `missing deps supplier=${!!supplierId} wh=${!!ids.warehouseId} med=${!!ids.medicineId}`,
    });
  }

  // Sales quote — schema field is tradeCustomerId
  if (ids.medicineId && ids.customerId) {
    await post("write", "POST sales/pricing/quote", "/v1/pharmacy/sales/pricing/quote", {
      branchCode: BRANCH,
      tradeCustomerId: ids.customerId,
      lines: [{ medicineId: ids.medicineId, quantity: 1 }],
    });
  }

  // ── Summary ───────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed);
  const byGroup = {};
  for (const r of results) {
    byGroup[r.group] ??= { pass: 0, fail: 0 };
    byGroup[r.group][r.passed ? "pass" : "fail"] += 1;
  }

  const summary = {
    api: API,
    email: EMAIL,
    branch: BRANCH,
    at: new Date().toISOString(),
    total: results.length,
    passed,
    failed: failed.length,
    byGroup,
    failures: failed,
    ids,
    results,
  };

  const out = outPath();
  fs.writeFileSync(out, JSON.stringify(summary, null, 2));
  console.log(`\n=== SUMMARY ${passed}/${results.length} passed, ${failed.length} failed ===`);
  console.log("By group:");
  for (const [g, c] of Object.entries(byGroup)) {
    console.log(`  ${g.padEnd(14)} ${c.pass} pass / ${c.fail} fail`);
  }
  if (failed.length) {
    console.log("\nFailures:");
    for (const f of failed) {
      console.log(`  - [${f.group}] ${f.name}: ${f.status} ${f.error}`);
    }
  }
  console.log(`\nWrote ${out}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
