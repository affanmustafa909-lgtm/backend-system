/**
 * Sequential live API probe. Stops on first unexpected failure.
 *   node scripts/live-api-probe.mjs
 */
const API = (process.env.API_BASE || "https://backend-system-production-28a3.up.railway.app").replace(/\/$/, "");
const EMAIL = process.env.DIST_EMAIL || "admin.distribution@pops.demo";
const PASSWORD = process.env.DIST_PASSWORD || "Owner@12345";
const BRANCH = process.env.BRANCH_CODE || "DIST-HQ";

let token = "";
const results = [];

function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.error(`FAIL  ${name} — ${detail}`);
  console.error(JSON.stringify({ api: API, results }, null, 2));
  process.exit(1);
}
function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function req(method, route, { body, query, auth = true } = {}) {
  const url = new URL(`${API}${route}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  }
  const headers = { "content-type": "application/json" };
  if (auth && token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, ok: res.ok, json, text };
}

function msg(res) {
  const m = res.json?.message;
  return Array.isArray(m) ? m.join("; ") : m ?? res.text?.slice(0, 240) ?? String(res.status);
}

async function main() {
  const health = await req("GET", "/health", { auth: false });
  if (!health.ok) fail("health", msg(health));
  pass("health", String(health.status));

  const login = await req("POST", "/v1/auth/login", { auth: false, body: { email: EMAIL, password: PASSWORD } });
  if (!login.ok) fail("auth.login", `${login.status} ${msg(login)}`);
  token = login.json?.accessToken || login.json?.token;
  if (!token) fail("auth.login.token", "no access token");
  pass("auth.login", EMAIL);

  const steps = [
    ["GET", "/v1/sync/status", {}, "sync.status"],
    ["GET", "/v1/sync/pull", {}, "sync.pull"],
    ["POST", "/v1/sync/register-device", { body: { deviceId: "probe-device-abcdefgh", deviceName: "probe", platform: "script" } }, "sync.registerDevice"],
    ["GET", "/v1/pharmacy/io/modules", {}, "io.modules"],
    ["GET", "/v1/pharmacy/io/templates/medicines", {}, "io.template.medicines"],
    ["GET", "/v1/pharmacy/io/jobs", { query: { page: 1 } }, "io.jobs"],
    ["GET", "/v1/pharmacy/io/audit", { query: { page: 1 } }, "io.audit"],
    ["GET", "/v1/pharmacy/lookup", { query: { q: "a", branchCode: BRANCH } }, "pharmacy.lookup"],
    ["GET", "/v1/pharmacy/medicines", { query: { branchCode: BRANCH, page: 1, pageSize: 10 } }, "pharmacy.medicines"],
    ["GET", "/v1/pharmacy/distribution/dashboard/summary", { query: { branchCode: BRANCH } }, "dist.dashboard.summary"],
    ["GET", "/v1/pharmacy/distribution/dashboard/sales-trend", { query: { branchCode: BRANCH } }, "dist.dashboard.salesTrend"],
    ["GET", "/v1/pharmacy/distribution/dashboard/action-center", { query: { branchCode: BRANCH } }, "dist.dashboard.actionCenter"],
    ["GET", "/v1/pharmacy/distribution/dashboard/stock-health", { query: { branchCode: BRANCH } }, "dist.dashboard.stockHealth"],
    ["GET", "/v1/pharmacy/distribution/ps-window", { query: { branchCode: BRANCH } }, "dist.psWindow"],
    ["GET", "/v1/pharmacy/distribution/orders", { query: { branchCode: BRANCH } }, "dist.orders"],
    ["GET", "/v1/pharmacy/distribution/invoices", { query: { branchCode: BRANCH } }, "dist.invoices"],
    ["GET", "/v1/pharmacy/trade-customers", { query: { branchCode: BRANCH } }, "dist.customers"],
    ["GET", "/v1/pharmacy/warehouses", { query: { branchCode: BRANCH } }, "dist.warehouses"],
    ["GET", "/v1/pharmacy/inventory/dashboard", { query: { branchCode: BRANCH } }, "inventory.dashboard"],
    ["GET", "/v1/pharmacy/inventory/stock", { query: { branchCode: BRANCH, page: 1, pageSize: 10 } }, "inventory.stock"],
    ["GET", "/v1/pharmacy/inventory/batches", { query: { branchCode: BRANCH, page: 1, pageSize: 10 } }, "inventory.batches"],
    ["GET", "/v1/pharmacy/inventory/ledger", { query: { branchCode: BRANCH, page: 1, pageSize: 10 } }, "inventory.ledger"],
    ["GET", "/v1/pharmacy/purchase-orders", { query: { branchCode: BRANCH } }, "purchase.orders"],
    ["GET", "/v1/pharmacy/grns", { query: { branchCode: BRANCH } }, "purchase.grns"],
    ["GET", "/v1/pharmacy/distribution/deliveries", { query: { branchCode: BRANCH } }, "delivery.list"],
    ["GET", "/v1/pharmacy/distribution/collections", { query: { branchCode: BRANCH } }, "collections.list"],
    ["GET", "/v1/pharmacy/finance/dashboard", { query: { branchCode: BRANCH } }, "finance.dashboard"],
    ["GET", "/v1/accounting/accounts", { query: { branchCode: BRANCH } }, "accounting.accounts"],
    ["GET", "/v1/pharmacy/field-force/dashboard", { query: { branchCode: BRANCH } }, "fieldForce.dashboard"],
    ["GET", "/v1/pharmacy/field-force/visits", { query: { branchCode: BRANCH } }, "fieldForce.visits"],
    ["GET", "/v1/pharmacy/masters/medicines", { query: { branchCode: BRANCH, page: 1, pageSize: 10 } }, "masters.medicines"],
    ["POST", "/v1/pharmacy/io/validate", { body: { branchCode: BRANCH, module: "medicines", headers: ["Product Code", "Product Name"], rows: [["", "No code"]], mapping: { sku: "Product Code", name: "Product Name" } } }, "io.validate"],
    ["POST", "/v1/pharmacy/io/export", { body: { branchCode: BRANCH, module: "medicines" } }, "io.export"],
    ["POST", "/v1/sync/initialize", { body: { deviceId: "probe-device-abcdefgh" } }, "sync.initialize"],
    ["GET", "/v1/pharmacy/companies", {}, "dist.companies"],
    ["GET", "/v1/pharmacy/territories", {}, "dist.territories"],
    ["GET", "/v1/pharmacy/provinces", {}, "dist.provinces"],
    ["GET", "/v1/pharmacy/divisions", {}, "dist.divisions"],
    ["GET", "/v1/pharmacy/districts", {}, "dist.districts"],
    ["GET", "/v1/pharmacy/cities", {}, "dist.cities"],
    ["GET", "/v1/pharmacy/areas", {}, "dist.areas"],
    ["GET", "/v1/pharmacy/geo-territories", {}, "dist.geoTerritories"],
    ["GET", "/v1/pharmacy/routes", {}, "dist.routes"],
    ["GET", "/v1/pharmacy/sales-force", {}, "dist.salesForce"],
    ["GET", "/v1/pharmacy/employees-picker", {}, "dist.employeesPicker"],
    ["GET", "/v1/pharmacy/sales/returns", { query: { branchCode: BRANCH } }, "sales.returns"],
    ["GET", "/v1/pharmacy/purchase-returns", { query: { branchCode: BRANCH } }, "purchase.returnsLegacy"],
    ["GET", "/v1/pharmacy/distribution/ps-window/widgets", { query: { branchCode: BRANCH } }, "dist.psWindowWidgets"],
    ["GET", "/v1/pharmacy/distribution/dashboard/top-products", { query: { branchCode: BRANCH } }, "dist.dashboard.topProducts"],
    ["GET", "/v1/pharmacy/distribution/dashboard/top-customers", { query: { branchCode: BRANCH } }, "dist.dashboard.topCustomers"],
    ["GET", "/v1/pharmacy/distribution/dashboard/company-performance", { query: { branchCode: BRANCH } }, "dist.dashboard.companyPerformance"],
    ["GET", "/v1/pharmacy/distribution/dashboard/salesmen", { query: { branchCode: BRANCH } }, "dist.dashboard.salesmen"],
    ["GET", "/v1/pharmacy/distribution/dashboard/recovery", { query: { branchCode: BRANCH } }, "dist.dashboard.recovery"],
    ["GET", "/v1/pharmacy/distribution/dashboard/deliveries", { query: { branchCode: BRANCH } }, "dist.dashboard.deliveries"],
    ["GET", "/v1/pharmacy/distribution/dashboard/field-force", { query: { branchCode: BRANCH } }, "dist.dashboard.fieldForce"],
    ["GET", "/v1/pharmacy/distribution/reports/daily-sales", { query: { branchCode: BRANCH } }, "dist.reports.dailySales"],
    ["GET", "/v1/pharmacy/distribution/assignments", { query: { branchCode: BRANCH } }, "dist.assignments"],
    ["GET", "/v1/pharmacy/distribution/wholesale-returns", { query: { branchCode: BRANCH } }, "dist.wholesaleReturns"],
    ["GET", "/v1/pharmacy/distribution/visits", {}, "dist.visitsLegacy"],
    ["GET", "/v1/pharmacy/distribution/targets", {}, "dist.targets"],
    ["GET", "/v1/pharmacy/pricing/lists", {}, "dist.priceLists"],
    ["GET", "/v1/pharmacy/purchase/dashboard", { query: { branchCode: BRANCH } }, "purchase.dashboard"],
    ["GET", "/v1/pharmacy/purchase/orders", { query: { branchCode: BRANCH } }, "purchase.ordersV2"],
    ["GET", "/v1/pharmacy/purchase/grns", { query: { branchCode: BRANCH } }, "purchase.grnsV2"],
    ["GET", "/v1/pharmacy/purchase/returns", { query: { branchCode: BRANCH } }, "purchase.returnsV2"],
    ["GET", "/v1/pharmacy/purchase/invoices", { query: { branchCode: BRANCH } }, "purchase.invoices"],
    ["GET", "/v1/pharmacy/purchase/requisitions", { query: { branchCode: BRANCH } }, "purchase.requisitions"],
    ["GET", "/v1/pharmacy/collections", { query: { branchCode: BRANCH } }, "collections.v2"],
    ["GET", "/v1/pharmacy/delivery/orders", { query: { branchCode: BRANCH } }, "delivery.v2"],
    ["GET", "/v1/pharmacy/delivery/dashboard", { query: { branchCode: BRANCH } }, "delivery.dashboard"],
    ["GET", "/v1/pharmacy/collections/dashboard", { query: { branchCode: BRANCH } }, "collections.dashboard"],
    ["GET", "/v1/pharmacy/collections/aging", { query: { branchCode: BRANCH } }, "collections.aging"],
    ["GET", "/v1/pharmacy/finance/reconciliation", { query: { branchCode: BRANCH } }, "finance.reconciliation"],
    ["GET", "/v1/accounting/ledger", { query: { branchCode: BRANCH } }, "accounting.ledger"],
  ];

  for (const [method, route, opts, name] of steps) {
    const res = await req(method, route, opts);
    if (!res.ok) fail(name, `${res.status} ${msg(res)}`);
    pass(name, String(res.status));
  }

  console.log(`\nAll ${results.length} checks passed against ${API}`);
}

main().catch((err) => {
  fail("script", err instanceof Error ? err.message : String(err));
});
