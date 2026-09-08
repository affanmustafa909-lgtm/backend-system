/**
 * Medical Distribution full lifecycle E2E — creates real data across masters → order-to-cash → field → reports.
 *
 * Usage:
 *   node scripts/distribution-lifecycle-e2e.mjs
 *   API_BASE=http://127.0.0.1:3000 node scripts/distribution-lifecycle-e2e.mjs
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

const API = (process.env.API_BASE || process.env.API_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const EMAIL = process.env.DIST_EMAIL || "admin.distribution@pops.demo";
const PASSWORD = process.env.DIST_PASSWORD || getEnv("SEED_USER_PASSWORD", "Owner@12345");
const BRANCH = process.env.BRANCH_CODE || "DIST-HQ";

const results = [];
const stamp = Date.now().toString(36).slice(-5).toUpperCase();
const today = new Date().toISOString().slice(0, 10);
const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10);

function record(name, ok, detail = "") {
  results.push({ name, ok, detail: String(detail).slice(0, 280) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? " — " + String(detail).slice(0, 140) : ""}`);
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
  return { res, json, text };
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
      : `${res.status} ${res.statusText}`;
    throw new Error(`${label}: ${msg}`);
  }
}

async function main() {
  console.log(`\n=== Distribution lifecycle E2E ===\nAPI=${API}\nuser=${EMAIL}\nbranch=${BRANCH}\nstamp=${stamp}\n`);

  let token = "";
  let companyId = "";
  let warehouseId = "";
  let provinceId = "";
  let divisionId = "";
  let districtId = "";
  let cityId = "";
  let areaId = "";
  let geoTerritoryId = "";
  let routeId = "";
  let tradeId = "";
  let medicineId = "";
  let medicineId2 = "";
  let orderId = "";
  let orderNumber = "";
  let invoiceId = "";
  let deliveryId = "";
  let collectionId = "";
  let employeeId = "";
  let assignmentId = "";
  let priceListId = "";
  let schemeId = "";
  let poId = "";

  await step("01. login", async () => {
    const login = await req("POST", "/v1/auth/login", { body: { email: EMAIL, password: PASSWORD } });
    assertOk(login.res, login.json, "login");
    token =
      login.json.accessToken ||
      login.json.access_token ||
      login.json.token ||
      login.json.tokens?.accessToken;
    if (!token) throw new Error("No access token");
    return "ok";
  });

  await step("02. company master", async () => {
    const c = await req("POST", "/v1/pharmacy/companies", {
      token,
      body: { code: `COM-${stamp}`, name: `Dist Co ${stamp}`, manufacturerName: "Lifecycle Labs" },
    });
    assertOk(c.res, c.json, "company");
    companyId = c.json.id;
    return c.json.code;
  });

  await step("03. warehouse", async () => {
    const list = await req("GET", "/v1/pharmacy/warehouses", { token, query: { branchCode: BRANCH } });
    assertOk(list.res, list.json, "warehouses");
    if (Array.isArray(list.json) && list.json.length) {
      warehouseId = list.json[0].id;
      return `existing=${list.json[0].code}`;
    }
    const c = await req("POST", "/v1/pharmacy/warehouses", {
      token,
      body: { branchCode: BRANCH, code: `WH-${stamp}`, name: `Dist WH ${stamp}`, isDefault: true },
    });
    assertOk(c.res, c.json, "create warehouse");
    warehouseId = c.json.id;
    return c.json.code;
  });

  await step("04. medicines (stocked)", async () => {
    const m1 = await req("POST", "/v1/pharmacy/medicines", {
      token,
      body: {
        branchCode: BRANCH,
        sku: `MED-A-${stamp}`,
        name: `Augmentin Dist ${stamp}`,
        category: "Tablet",
        companyId,
        sellingPrice: 120,
        wholesalePrice: 95,
        purchasePrice: 70,
        currentStock: 2000,
        tabletsPerStrip: 10,
        stripsPerBox: 10,
      },
    });
    assertOk(m1.res, m1.json, "medicine A");
    medicineId = m1.json.id;
    const m2 = await req("POST", "/v1/pharmacy/medicines", {
      token,
      body: {
        branchCode: BRANCH,
        sku: `MED-B-${stamp}`,
        name: `Flagyl Dist ${stamp}`,
        category: "Tablet",
        companyId,
        sellingPrice: 80,
        wholesalePrice: 60,
        purchasePrice: 40,
        currentStock: 1500,
        tabletsPerStrip: 10,
        stripsPerBox: 10,
      },
    });
    assertOk(m2.res, m2.json, "medicine B");
    medicineId2 = m2.json.id;
    return `${m1.json.sku}+${m2.json.sku}`;
  });

  await step("05. geo Province→…→Route", async () => {
    const p = await req("POST", "/v1/pharmacy/provinces", {
      token,
      body: { code: `PV-${stamp}`, name: `Punjab ${stamp}` },
    });
    assertOk(p.res, p.json, "province");
    provinceId = p.json.id;

    const d = await req("POST", "/v1/pharmacy/divisions", {
      token,
      body: { provinceId, code: `DV-${stamp}`, name: `Lahore Div ${stamp}` },
    });
    assertOk(d.res, d.json, "division");
    divisionId = d.json.id;

    const dt = await req("POST", "/v1/pharmacy/districts", {
      token,
      body: { divisionId, code: `DI-${stamp}`, name: `Lahore Dist ${stamp}` },
    });
    assertOk(dt.res, dt.json, "district");
    districtId = dt.json.id;

    const city = await req("POST", "/v1/pharmacy/cities", {
      token,
      body: { code: `CT-${stamp}`, name: `Lahore City ${stamp}`, districtId },
    });
    assertOk(city.res, city.json, "city");
    cityId = city.json.id;

    const area = await req("POST", "/v1/pharmacy/areas", {
      token,
      body: { cityId, code: `AR-${stamp}`, name: `Gulberg ${stamp}`, isOutstation: false },
    });
    assertOk(area.res, area.json, "area");
    areaId = area.json.id;

    const gt = await req("POST", "/v1/pharmacy/geo-territories", {
      token,
      body: { areaId, code: `GT-${stamp}`, name: `Beat Terr ${stamp}` },
    });
    assertOk(gt.res, gt.json, "geo territory");
    geoTerritoryId = gt.json.id;

    const route = await req("POST", "/v1/pharmacy/routes", {
      token,
      body: {
        areaId,
        geoTerritoryId,
        code: `RT-${stamp}`,
        name: `Mon Beat ${stamp}`,
        sequenceNo: 1,
        pjpDayOfWeek: 1,
        station: "Instation",
      },
    });
    assertOk(route.res, route.json, "route");
    routeId = route.json.id;
    return `geo=${p.json.code}→${route.json.code}`;
  });

  await step("06. trade customer + ledger", async () => {
    const c = await req("POST", "/v1/pharmacy/trade-customers", {
      token,
      body: {
        branchCode: BRANCH,
        code: `TC-${stamp}`,
        name: `Al-Shifa Medical ${stamp}`,
        customerType: "Pharmacy",
        phone: "03001234567",
        priceLevel: "wholesale",
        creditLimitPkr: 1_000_000,
        areaId,
        routeId,
      },
    });
    assertOk(c.res, c.json, "trade customer");
    tradeId = c.json.id;
    const led = await req("GET", `/v1/pharmacy/trade-customers/${tradeId}/ledger`, { token });
    assertOk(led.res, led.json, "ledger");
    return c.json.code;
  });

  await step("07. pricing list + scheme", async () => {
    const pl = await req("POST", "/v1/pharmacy/pricing/lists", {
      token,
      body: {
        name: `Wholesale ${stamp}`,
        code: `PL-${stamp}`,
        priceLevel: "wholesale",
        areaId,
      },
    });
    assertOk(pl.res, pl.json, "price list");
    priceListId = pl.json.id;
    const sc = await req("POST", "/v1/pharmacy/pricing/schemes", {
      token,
      body: {
        name: `Buy10Get1 ${stamp}`,
        medicineId,
        buyQty: 10,
        freeQty: 1,
        status: "active",
      },
    });
    assertOk(sc.res, sc.json, "scheme");
    schemeId = sc.json.id;
    const resolved = await req("GET", "/v1/pharmacy/pricing/resolve", {
      token,
      query: { medicineId, tradeCustomerId: tradeId, priceLevel: "wholesale", qty: "10" },
    });
    assertOk(resolved.res, resolved.json, "resolve price");
    return `list=${pl.json.code || priceListId.slice(0, 8)} scheme=${schemeId.slice(0, 8)} price=${resolved.json.unitPricePkr}`;
  });

  await step("08. purchase order + approve", async () => {
    const po = await req("POST", "/v1/pharmacy/purchase-orders", {
      token,
      body: {
        branchCode: BRANCH,
        notes: `Lifecycle PO ${stamp}`,
        lines: [
          { medicineId, quantity: 100, unitCostPkr: 70 },
          { medicineId: medicineId2, quantity: 50, unitCostPkr: 40 },
        ],
      },
    });
    assertOk(po.res, po.json, "PO");
    poId = po.json.id;
    const ap = await req("POST", `/v1/pharmacy/purchase-orders/${poId}/approve`, { token, body: {} });
    assertOk(ap.res, ap.json, "approve PO");
    return po.json.orderNumber || poId.slice(0, 8);
  });

  await step("09. book dist order (multi-line)", async () => {
    const o = await req("POST", "/v1/pharmacy/distribution/orders", {
      token,
      body: {
        branchCode: BRANCH,
        warehouseId,
        tradeCustomerId: tradeId,
        submit: true,
        lines: [
          { medicineId, quantity: 20, unitPricePkr: 95 },
          { medicineId: medicineId2, quantity: 10, unitPricePkr: 60 },
        ],
      },
    });
    assertOk(o.res, o.json, "book order");
    orderId = o.json.id;
    orderNumber = o.json.orderNumber;
    if (o.json.status !== "booked") throw new Error(`expected booked got ${o.json.status}`);
    return `${orderNumber} total=${o.json.totalPkr}`;
  });

  await step("10. approve order", async () => {
    const a = await req("POST", `/v1/pharmacy/distribution/orders/${orderId}/approve`, { token, body: {} });
    assertOk(a.res, a.json, "approve");
    if (a.json.status !== "approved") throw new Error(`status=${a.json.status}`);
    return a.json.status;
  });

  await step("11. pipeline advance reserve→pick→pack→ready", async () => {
    for (const status of ["stock_reserved", "picking", "packed", "ready_for_dispatch"]) {
      const a = await req("POST", `/v1/pharmacy/distribution/orders/${orderId}/advance`, {
        token,
        body: { status },
      });
      assertOk(a.res, a.json, status);
      if (a.json.status !== status) throw new Error(`${status} got ${a.json.status}`);
    }
    return "ready_for_dispatch";
  });

  await step("12. invoice from order", async () => {
    const inv = await req("POST", `/v1/pharmacy/distribution/orders/${orderId}/invoice`, {
      token,
      body: {},
    });
    assertOk(inv.res, inv.json, "invoice");
    invoiceId = inv.json.id;
    const list = await req("GET", "/v1/pharmacy/distribution/invoices", {
      token,
      query: { branchCode: BRANCH },
    });
    assertOk(list.res, list.json, "list invoices");
    const found = (list.json || []).some((x) => x.id === invoiceId);
    if (!found) throw new Error("invoice not in list");
    return inv.json.invoiceNumber || invoiceId.slice(0, 8);
  });

  await step("13. delivery + POD delivered", async () => {
    const d = await req("POST", "/v1/pharmacy/distribution/deliveries", {
      token,
      body: {
        branchCode: BRANCH,
        orderId,
        invoiceId,
        tradeCustomerId: tradeId,
        riderName: `Rider ${stamp}`,
        routeId,
      },
    });
    assertOk(d.res, d.json, "create delivery");
    deliveryId = d.json.id;
    const u = await req("PATCH", `/v1/pharmacy/distribution/deliveries/${deliveryId}`, {
      token,
      body: { status: "delivered", podNotes: `POD ok ${stamp}`, collectedPkr: 500 },
    });
    assertOk(u.res, u.json, "POD");
    return d.json.deliveryNumber || deliveryId.slice(0, 8);
  });

  await step("14. collection / recovery", async () => {
    const c = await req("POST", "/v1/pharmacy/distribution/collections", {
      token,
      body: {
        branchCode: BRANCH,
        tradeCustomerId: tradeId,
        invoiceId,
        amountPkr: 1000,
        paymentMethod: "Cash",
        notes: `Lifecycle collection ${stamp}`,
      },
    });
    assertOk(c.res, c.json, "collection");
    collectionId = c.json.id;
    return c.json.collectionNumber || String(c.json.amountPkr);
  });

  await step("15. wholesale return", async () => {
    const r = await req("POST", "/v1/pharmacy/distribution/wholesale-returns", {
      token,
      body: {
        branchCode: BRANCH,
        tradeCustomerId: tradeId,
        invoiceId,
        warehouseId,
        reason: `Damaged sample ${stamp}`,
        lines: [{ medicineId, quantity: 1, unitPricePkr: 95 }],
      },
    });
    assertOk(r.res, r.json, "wholesale return");
    return r.json.returnNumber || r.json.id?.slice(0, 8);
  });

  await step("16. field force assignment + visit + target", async () => {
    const emps = await req("GET", "/v1/pharmacy/employees-picker", { token });
    assertOk(emps.res, emps.json, "employees");
    const list = Array.isArray(emps.json) ? emps.json : [];
    if (!list.length) {
      // Soft path: still create target without employee
      const t = await req("POST", "/v1/pharmacy/distribution/targets", {
        token,
        body: {
          periodType: "monthly",
          periodStart: today.slice(0, 8) + "01",
          periodEnd: monthEnd,
          cityId,
          companyId,
          medicineId,
          targetSalesPkr: 500000,
          targetCollectionPkr: 200000,
        },
      });
      assertOk(t.res, t.json, "target without employee");
      return "no employees — target only";
    }
    employeeId = list[0].id;
    const a = await req("POST", "/v1/pharmacy/distribution/assignments", {
      token,
      body: {
        branchCode: BRANCH,
        assignmentDate: today,
        employeeId,
        cityId,
        areaId,
        routeId,
        tradeCustomerId: tradeId,
        taskType: "visit",
        targetSalesPkr: 50000,
        targetCollectionPkr: 20000,
        notes: `Lifecycle assignment ${stamp}`,
      },
    });
    assertOk(a.res, a.json, "assignment");
    assignmentId = a.json.id;
    const v = await req("POST", "/v1/pharmacy/distribution/visits", {
      token,
      body: {
        assignmentId,
        employeeId,
        tradeCustomerId: tradeId,
        purpose: "order booking",
        status: "completed",
        productive: true,
        isOutstation: false,
        orderId,
        collectionId,
        notes: `Visited ${stamp}`,
      },
    });
    assertOk(v.res, v.json, "visit");
    const t = await req("POST", "/v1/pharmacy/distribution/targets", {
      token,
      body: {
        periodType: "monthly",
        periodStart: today.slice(0, 8) + "01",
        periodEnd: monthEnd,
        employeeId,
        cityId,
        companyId,
        medicineId,
        targetSalesPkr: 500000,
        targetCollectionPkr: 200000,
      },
    });
    assertOk(t.res, t.json, "target");
    return `emp=${list[0].name || employeeId.slice(0, 8)}`;
  });

  await step("17. PS Window KPIs", async () => {
    const ps = await req("GET", "/v1/pharmacy/distribution/ps-window", {
      token,
      query: { branchCode: BRANCH },
    });
    assertOk(ps.res, ps.json, "ps-window");
    const s = ps.json.sales || {};
    return `ordersToday=${s.ordersToday} pipeline=${s.inWarehousePipeline} outstanding=${ps.json.distribution?.outstandingPkr}`;
  });

  await step("18. live reports (all)", async () => {
    const ids = [
      "daily-sales",
      "city-sales",
      "area-sales",
      "status-pipeline",
      "outstanding-aging",
      "collections-summary",
      "stock-near-expiry",
      "pending-deliveries",
      "delivery-status",
      "visit-coverage",
      "target-vs-achievement",
    ];
    const counts = [];
    for (const id of ids) {
      const r = await req("GET", `/v1/pharmacy/distribution/reports/${id}`, {
        token,
        query: { branchCode: BRANCH, from: today, to: today },
      });
      assertOk(r.res, r.json, id);
      counts.push(`${id}:${(r.json.rows || []).length}`);
    }
    return counts.join(" ");
  });

  await step("19. list ops endpoints", async () => {
    const paths = [
      ["/v1/pharmacy/distribution/orders", { branchCode: BRANCH }],
      ["/v1/pharmacy/distribution/invoices", { branchCode: BRANCH }],
      ["/v1/pharmacy/distribution/deliveries", { branchCode: BRANCH }],
      ["/v1/pharmacy/distribution/collections", { branchCode: BRANCH }],
      ["/v1/pharmacy/distribution/assignments", {}],
      ["/v1/pharmacy/distribution/visits", {}],
      ["/v1/pharmacy/distribution/targets", {}],
      ["/v1/pharmacy/provinces", {}],
      ["/v1/pharmacy/geo-territories", {}],
    ];
    for (const [p, query] of paths) {
      const r = await req("GET", p, { token, query });
      assertOk(r.res, r.json, p);
    }
    return `${paths.length} lists ok`;
  });

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== Summary: ${passed} PASS / ${failed} FAIL / ${results.length} total ===\n`);
  if (failed) {
    for (const r of results.filter((x) => !x.ok)) console.log(`  FAIL ${r.name}: ${r.detail}`);
    process.exit(1);
  }
  console.log("Distribution lifecycle E2E PASS");
  console.log(
    JSON.stringify(
      {
        stamp,
        branch: BRANCH,
        orderNumber,
        tradeId,
        medicineId,
        invoiceId,
        deliveryId,
        collectionId,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
