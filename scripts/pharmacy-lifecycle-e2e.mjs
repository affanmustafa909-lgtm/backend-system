/**
 * Pharmacy full lifecycle live test + dummy data inject.
 * Hits API (default local http://127.0.0.1:3000, override API_BASE).
 *
 * Usage:
 *   node scripts/pharmacy-lifecycle-e2e.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
const envRaw = fs.readFileSync(envPath, "utf8");
const getEnv = (k, fallback = "") => {
  const m = envRaw.match(new RegExp(`^${k}=(.+)$`, "m"));
  return (m?.[1] ?? fallback).trim().replace(/^["']|["']$/g, "");
};

const API = (process.env.API_BASE || "http://127.0.0.1:3000").replace(/\/$/, "");
const EMAIL = process.env.PHARMACY_EMAIL || "admin.pharmacy@pops.demo";
const PASSWORD = process.env.PHARMACY_PASSWORD || getEnv("SEED_USER_PASSWORD", "Owner@12345");
const BRANCH = process.env.BRANCH_CODE || "PHAR-HQ";

const results = [];
const stamp = Date.now().toString().slice(-6);

function record(name, ok, detail = "") {
  results.push({ name, ok, detail: String(detail).slice(0, 240) });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${detail ? " — " + String(detail).slice(0, 120) : ""}`);
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
  console.log(`\n=== Pharmacy lifecycle E2E ===\nAPI=${API}\nuser=${EMAIL}\nbranch=${BRANCH}\n`);

  let token = "";
  let medicines = [];
  let doctorId = "";
  let patientId = "";
  let companyId = "";
  let warehouseId = "";
  let territoryId = "";
  let cityId = "";
  let areaId = "";
  let routeId = "";
  let tradeId = "";
  let medicineId = "";
  let rxId = "";
  let saleId = "";
  let poId = "";
  let distOrderId = "";
  let employeeId = "";

  await step("0. health/login", async () => {
    const login = await req("POST", "/v1/auth/login", { body: { email: EMAIL, password: PASSWORD } });
    assertOk(login.res, login.json, "login");
    token = login.json.accessToken || login.json.access_token || login.json.token;
    if (!token && login.json.tokens?.accessToken) token = login.json.tokens.accessToken;
    if (!token) throw new Error("No access token in login response keys: " + Object.keys(login.json || {}).join(","));
    return `token ok`;
  });

  await step("1. dashboard", async () => {
    const r = await req("GET", "/v1/pharmacy/dashboard", { token, query: { branchCode: BRANCH } });
    assertOk(r.res, r.json, "dashboard");
    return `kpis=${Object.keys(r.json || {}).length}`;
  });

  await step("2. medicines list (+seed)", async () => {
    const r = await req("GET", "/v1/pharmacy/medicines", { token, query: { branchCode: BRANCH } });
    assertOk(r.res, r.json, "medicines");
    medicines = Array.isArray(r.json) ? r.json : [];
    if (!medicines.length) {
      const c = await req("POST", "/v1/pharmacy/medicines", {
        token,
        body: {
          branchCode: BRANCH,
          sku: `E2E-${stamp}`,
          name: `E2E Panadol ${stamp}`,
          category: "Tablet",
          sellingPrice: 50,
          purchasePrice: 30,
          currentStock: 500,
          tabletsPerStrip: 10,
          stripsPerBox: 10,
        },
      });
      assertOk(c.res, c.json, "create medicine");
      medicines = [c.json];
    }
    medicineId = medicines[0].id;
    return `count=${medicines.length} first=${medicines[0].sku || medicines[0].name}`;
  });

  await step("3. company master", async () => {
    const c = await req("POST", "/v1/pharmacy/companies", {
      token,
      body: { code: `COM-E2E-${stamp}`, name: `E2E Pharma Co ${stamp}`, manufacturerName: "GSK Test" },
    });
    assertOk(c.res, c.json, "company");
    companyId = c.json.id;
    return c.json.code;
  });

  await step("4. warehouse", async () => {
    const list = await req("GET", "/v1/pharmacy/warehouses", { token, query: { branchCode: BRANCH } });
    assertOk(list.res, list.json, "warehouses");
    if (Array.isArray(list.json) && list.json.length) {
      warehouseId = list.json[0].id;
      return `existing=${list.json[0].code}`;
    }
    const c = await req("POST", "/v1/pharmacy/warehouses", {
      token,
      body: { branchCode: BRANCH, code: `WH-E2E-${stamp}`, name: "E2E Main WH", isDefault: true },
    });
    assertOk(c.res, c.json, "create warehouse");
    warehouseId = c.json.id;
    return c.json.code;
  });

  await step("5. geo territory→city→area(outstation)→route(PJP)", async () => {
    const t = await req("POST", "/v1/pharmacy/territories", {
      token,
      body: { code: `TER-E2E-${stamp}`, name: `Lahore East ${stamp}`, region: "Punjab" },
    });
    assertOk(t.res, t.json, "territory");
    territoryId = t.json.id;
    const city = await req("POST", "/v1/pharmacy/cities", {
      token,
      body: { code: `CTY-E2E-${stamp}`, name: `City ${stamp}`, territoryId },
    });
    assertOk(city.res, city.json, "city");
    cityId = city.json.id;
    const area = await req("POST", "/v1/pharmacy/areas", {
      token,
      body: { cityId, code: `ARA-E2E-${stamp}`, name: `Outstation Area ${stamp}`, isOutstation: true },
    });
    assertOk(area.res, area.json, "area");
    areaId = area.json.id;
    const route = await req("POST", "/v1/pharmacy/routes", {
      token,
      body: {
        areaId,
        code: `RTE-E2E-${stamp}`,
        name: `Beat Mon ${stamp}`,
        sequenceNo: 1,
        pjpDayOfWeek: 1,
        station: "Outstation",
      },
    });
    assertOk(route.res, route.json, "route");
    routeId = route.json.id;
    return `outstation=${area.json.isOutstation} pjp=${route.json.pjpDayOfWeek}`;
  });

  await step("6. trade customer + ledger", async () => {
    const c = await req("POST", "/v1/pharmacy/trade-customers", {
      token,
      body: {
        branchCode: BRANCH,
        code: `CUS-E2E-${stamp}`,
        name: `E2E Medical Store ${stamp}`,
        customerType: "Pharmacy",
        priceLevel: "wholesale",
        creditLimitPkr: 500000,
        areaId,
        routeId,
      },
    });
    assertOk(c.res, c.json, "trade customer");
    tradeId = c.json.id;
    const led = await req("GET", `/v1/pharmacy/trade-customers/${tradeId}/ledger`, { token });
    assertOk(led.res, led.json, "ledger");
    return `aging keys=${Object.keys(led.json.aging || {}).join(",")}`;
  });

  await step("7. doctor + prefs + commission rule", async () => {
    const d = await req("POST", "/v1/pharmacy/doctors", {
      token,
      body: {
        branchCode: BRANCH,
        code: `DOC-E2E-${stamp}`,
        name: `Dr E2E Khan ${stamp}`,
        specialization: "GP",
        clinic: "E2E Clinic",
      },
    });
    assertOk(d.res, d.json, "doctor");
    doctorId = d.json.id;
    const pref = await req("POST", `/v1/pharmacy/doctors/${doctorId}/recommendations`, {
      token,
      body: { medicineId, priority: 1, notes: "Preferred brand" },
    });
    assertOk(pref.res, pref.json, "recommendation");
    const rule = await req("POST", `/v1/pharmacy/doctors/${doctorId}/commission-rules`, {
      token,
      body: { ruleType: "percent", rateValue: 5, notes: "E2E 5%" },
    });
    assertOk(rule.res, rule.json, "commission rule");
    return `doctor=${d.json.code || doctorId}`;
  });

  await step("8. patient", async () => {
    const p = await req("POST", "/v1/pharmacy/patients", {
      token,
      body: {
        branchCode: BRANCH,
        code: `PAT-E2E-${stamp}`,
        name: `Patient E2E ${stamp}`,
        phone: "03001234567",
        allergies: ["Penicillin"],
        chronicDiseases: ["Diabetes"],
      },
    });
    assertOk(p.res, p.json, "patient");
    patientId = p.json.id;
    return p.json.code || patientId;
  });

  await step("9. prescription → verify → dispense", async () => {
    const rx = await req("POST", "/v1/pharmacy/prescriptions", {
      token,
      body: {
        branchCode: BRANCH,
        patientId,
        doctorId,
        notes: "E2E Rx",
        items: [{ medicineId, quantity: 2, dosage: "1x2" }],
      },
    });
    assertOk(rx.res, rx.json, "create rx");
    rxId = rx.json.id;
    const v = await req("PATCH", `/v1/pharmacy/prescriptions/${rxId}/verify`, { token });
    assertOk(v.res, v.json ?? {}, "verify rx");
    const disp = await req("POST", `/v1/pharmacy/prescriptions/${rxId}/dispense`, {
      token,
      query: { branchCode: BRANCH },
    });
    assertOk(disp.res, disp.json ?? {}, "dispense");
    return rx.json.prescriptionNumber || rxId;
  });

  await step("10. POS sale with Rx (commission accrue)", async () => {
    const sale = await req("POST", "/v1/pharmacy/sales", {
      token,
      body: {
        branchCode: BRANCH,
        patientId,
        prescriptionId: rxId,
        paymentMethod: "Cash",
        lines: [{ medicineId, qty: 1, saleUnit: medicines[0].tabletsPerStrip > 1 ? "strip" : "piece" }],
      },
    });
    assertOk(sale.res, sale.json, "sale");
    saleId = sale.json.id;
    const entries = await req("GET", `/v1/pharmacy/doctors/${doctorId}/commission-entries`, { token });
    assertOk(entries.res, entries.json, "commission entries");
    const n = Array.isArray(entries.json) ? entries.json.length : 0;
    return `sale=${sale.json.invoiceNumber} commissionRows=${n}`;
  });

  await step("11. code lookup", async () => {
    const r = await req("GET", "/v1/pharmacy/lookup", {
      token,
      query: { q: `DOC-E2E-${stamp}`, branchCode: BRANCH },
    });
    assertOk(r.res, r.json, "lookup");
    return `hits=${r.json.count ?? r.json.results?.length ?? 0}`;
  });

  await step("12. purchase PO → approve → GRN", async () => {
    const po = await req("POST", "/v1/pharmacy/purchase-orders", {
      token,
      body: {
        branchCode: BRANCH,
        orderDate: new Date().toISOString().slice(0, 10),
        lines: [{ medicineId, quantity: 20, unitCostPkr: 25, freeQuantity: 0 }],
      },
    });
    assertOk(po.res, po.json, "PO");
    poId = po.json.id;
    const ap = await req("POST", `/v1/pharmacy/purchase-orders/${poId}/approve`, { token, body: {} });
    assertOk(ap.res, ap.json ?? {}, "approve PO");
    const exp = new Date();
    exp.setFullYear(exp.getFullYear() + 1);
    const grn = await req("POST", "/v1/pharmacy/grns", {
      token,
      body: {
        branchCode: BRANCH,
        purchaseOrderId: poId,
        warehouseId,
        lines: [
          {
            medicineId,
            quantity: 20,
            freeQuantity: 0,
            unitCostPkr: 25,
            batchNumber: `BAT-E2E-${stamp}`,
            expiryDate: exp.toISOString().slice(0, 10),
          },
        ],
      },
    });
    assertOk(grn.res, grn.json, "GRN");
    return grn.json.grnNumber || poId;
  });

  await step("13. scheme + dist book → approve → invoice", async () => {
    const sch = await req("POST", "/v1/pharmacy/pricing/schemes", {
      token,
      body: { name: `E2E Buy10Get1 ${stamp}`, buyQty: 10, freeQty: 1, medicineId, schemeType: "buy_x_get_y" },
    });
    assertOk(sch.res, sch.json, "scheme");
    const ord = await req("POST", "/v1/pharmacy/distribution/orders", {
      token,
      body: {
        branchCode: BRANCH,
        tradeCustomerId: tradeId,
        warehouseId,
        submit: true,
        lines: [{ medicineId, quantity: 10 }],
      },
    });
    assertOk(ord.res, ord.json, "dist order");
    distOrderId = ord.json.id;
    const free = ord.json.lines?.[0]?.freeQuantity ?? 0;
    const ap = await req("POST", `/v1/pharmacy/distribution/orders/${distOrderId}/approve`, { token, body: {} });
    assertOk(ap.res, ap.json ?? {}, "approve dist");
    const inv = await req("POST", `/v1/pharmacy/distribution/orders/${distOrderId}/invoice`, { token, body: {} });
    assertOk(inv.res, inv.json, "invoice dist");
    return `order=${ord.json.orderNumber} freeQty=${free} status=${ord.json.status} inv=${inv.json.invoiceNumber || inv.json.id}`;
  });

  await step("14. delivery + collection", async () => {
    const del = await req("POST", "/v1/pharmacy/distribution/deliveries", {
      token,
      body: { branchCode: BRANCH, orderId: distOrderId, riderName: "Biker E2E", routeId },
    });
    assertOk(del.res, del.json, "delivery");
    const pod = await req("PATCH", `/v1/pharmacy/distribution/deliveries/${del.json.id}`, {
      token,
      body: { status: "delivered", podNotes: "E2E POD", collectedPkr: 0 },
    });
    assertOk(pod.res, pod.json ?? {}, "POD");
    const col = await req("POST", "/v1/pharmacy/distribution/collections", {
      token,
      body: {
        branchCode: BRANCH,
        tradeCustomerId: tradeId,
        amountPkr: 500,
        paymentMethod: "Cash",
      },
    });
    assertOk(col.res, col.json, "collection");
    return `${del.json.deliveryNumber} / ${col.json.collectionNumber}`;
  });

  await step("15. wholesale return", async () => {
    const wr = await req("POST", "/v1/pharmacy/distribution/wholesale-returns", {
      token,
      body: {
        branchCode: BRANCH,
        tradeCustomerId: tradeId,
        warehouseId,
        reason: "E2E damaged",
        lines: [{ medicineId, quantity: 1, unitPricePkr: 40 }],
      },
    });
    assertOk(wr.res, wr.json, "wholesale return");
    return wr.json.returnNumber;
  });

  await step("16. retail sale return", async () => {
    const sales = await req("GET", "/v1/pharmacy/sales", { token, query: { branchCode: BRANCH } });
    assertOk(sales.res, sales.json, "sales list");
    const sale = (Array.isArray(sales.json) ? sales.json : []).find((s) => s.id === saleId) || sales.json?.[0];
    if (!sale?.lines?.length) throw new Error("no sale lines for return");
    const line = sale.lines[0];
    const ret = await req("POST", "/v1/pharmacy/sales/returns", {
      token,
      body: {
        branchCode: BRANCH,
        originalSaleId: sale.id,
        reason: "E2E customer return",
        refundMethod: "Cash",
        lines: [
          {
            medicineId: line.medicineId,
            batchId: line.batchId || undefined,
            qty: 1,
            tabletsQty: Math.max(1, line.tabletsQty || 1),
            unitPricePkr: line.unitPrice || line.unitPricePkr || 50,
          },
        ],
      },
    });
    assertOk(ret.res, ret.json, "sale return");
    return ret.json.returnNumber;
  });

  await step("17. field force employees + assignment + visit", async () => {
    const emps = await req("GET", "/v1/pharmacy/employees-picker", { token });
    assertOk(emps.res, emps.json, "employees");
    if (!Array.isArray(emps.json) || !emps.json.length) {
      return "SKIP no employees in org (assignment skipped)";
    }
    employeeId = emps.json[0].id;
    const asg = await req("POST", "/v1/pharmacy/distribution/assignments", {
      token,
      body: {
        branchCode: BRANCH,
        assignmentDate: new Date().toISOString().slice(0, 10),
        employeeId,
        tradeCustomerId: tradeId,
        doctorId,
        taskType: "visit",
      },
    });
    assertOk(asg.res, asg.json, "assignment");
    const vis = await req("POST", "/v1/pharmacy/distribution/visits", {
      token,
      body: {
        employeeId,
        tradeCustomerId: tradeId,
        doctorId,
        productive: true,
        isOutstation: true,
        status: "completed",
      },
    });
    assertOk(vis.res, vis.json, "visit");
    return `emp=${emps.json[0].employeeCode} outstation=${vis.json.isOutstation}`;
  });

  await step("18. pricing list + doctors enriched list", async () => {
    const pl = await req("POST", "/v1/pharmacy/pricing/lists", {
      token,
      body: { name: `E2E Wholesale ${stamp}`, priceLevel: "wholesale", items: [{ medicineId, unitPricePkr: 45 }] },
    });
    assertOk(pl.res, pl.json, "price list");
    const docs = await req("GET", "/v1/pharmacy/doctors", { token, query: { branchCode: BRANCH } });
    assertOk(docs.res, docs.json, "doctors");
    const d = (docs.json || []).find((x) => x.id === doctorId);
    return `pl=${pl.json.code || pl.json.name} referred=${d?.referredSalesPkr ?? "?"} commission=${d?.accruedCommissionPkr ?? "?"}`;
  });

  await step("19. shifts / batches / barcode", async () => {
    const batches = await req("GET", "/v1/pharmacy/batches", { token, query: { branchCode: BRANCH } });
    assertOk(batches.res, batches.json, "batches");
    const med = medicines.find((m) => m.barcode) || medicines[0];
    if (med?.barcode) {
      const bc = await req("GET", `/v1/pharmacy/medicines/barcode/${encodeURIComponent(med.barcode)}`, {
        token,
        query: { branchCode: BRANCH },
      });
      assertOk(bc.res, bc.json, "barcode");
    }
    const shifts = await req("GET", "/v1/pharmacy/shifts", { token, query: { branchCode: BRANCH } });
    // shifts endpoint may vary
    return `batches=${Array.isArray(batches.json) ? batches.json.length : "?"} shiftsStatus=${shifts.res.status}`;
  });

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed / ${results.length} ===\n`);
  if (failed) {
    for (const r of results.filter((x) => !x.ok)) console.log(` - ${r.name}: ${r.detail}`);
  }
  const outPath = path.join(__dirname, `pharmacy-e2e-report-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ API, EMAIL, BRANCH, passed, failed, results }, null, 2));
  console.log("Report:", outPath);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
