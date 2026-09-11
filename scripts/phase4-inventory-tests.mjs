/**
 * Phase 4 inventory / stock / batch / expiry / FEFO test + performance suite.
 *
 * Exercises the real API against a real database. Nothing is mocked.
 *
 * Usage:
 *   node scripts/phase4-inventory-tests.mjs
 *   API_BASE=https://backend-system-production-28a3.up.railway.app node scripts/phase4-inventory-tests.mjs
 *
 * Env:
 *   API_BASE       default http://127.0.0.1:3000
 *   DIST_EMAIL     default admin.distribution@pops.demo
 *   DIST_PASSWORD  default SEED_USER_PASSWORD from .env, else Owner@12345
 *   BRANCH_CODE    default DIST-HQ
 *
 * Test data is created under a dedicated warehouse (P4-TEST) with SKUs
 * prefixed `P4TEST-<runId>`, so it is identifiable and never collides with
 * real records. The suite NEVER deletes existing data.
 *
 * Writes docs/PHASE_4_TEST_RESULTS.json next to the repo docs, plus a
 * human-readable summary on stdout. Exit code is non-zero if any test fails.
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

const RUN_ID = Date.now().toString().slice(-8);
const SKU_PREFIX = `P4TEST-${RUN_ID}`;

const results = [];
const timings = [];
let token = "";

// ─── harness ────────────────────────────────────────────────────────────────

function record(name, passed, detail, expected, actual) {
  results.push({ name, passed, detail, expected, actual });
  const tag = passed ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function check(name, condition, detail, expected, actual) {
  record(name, Boolean(condition), detail, expected, actual);
  return Boolean(condition);
}

async function api(method, route, { body, query, auth = true, label } = {}) {
  const url = new URL(`${API}${route}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const headers = { "content-type": "application/json" };
  if (auth && token) headers.authorization = `Bearer ${token}`;
  const t0 = performance.now();
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const ms = performance.now() - t0;
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (label) timings.push({ label, route, ms: Math.round(ms), status: res.status });
  return { status: res.status, ok: res.ok, json, text, ms };
}

const get = (route, query, opts) => api("GET", route, { query, ...opts });
const post = (route, body, opts) => api("POST", route, { body, ...opts });
const patch = (route, body, opts) => api("PATCH", route, { body, ...opts });

function msg(res) {
  return res.json?.message ?? res.text?.slice(0, 200) ?? String(res.status);
}

const todayPlus = (days) =>
  new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

// ─── setup ──────────────────────────────────────────────────────────────────

async function login() {
  const res = await post("/v1/auth/login", { email: EMAIL, password: PASSWORD }, { auth: false });
  if (!res.ok) throw new Error(`Login failed (${res.status}): ${msg(res)}`);
  const t = res.json?.accessToken || res.json?.token || res.json?.access_token;
  if (!t) throw new Error("Login succeeded but no access token was returned");
  token = t;
}

async function ensureTestWarehouses() {
  const list = await get("/v1/pharmacy/warehouses", { branchCode: BRANCH });
  if (!list.ok) throw new Error(`Cannot list warehouses: ${msg(list)}`);
  const rows = Array.isArray(list.json) ? list.json : (list.json?.items ?? []);
  const find = (code) => rows.find((w) => w.code === code);

  const wanted = [
    { code: "P4-TEST", name: "Phase 4 Test Warehouse" },
    { code: "P4-TEST-B", name: "Phase 4 Test Warehouse B" },
  ];
  const out = {};
  for (const w of wanted) {
    const existing = find(w.code);
    if (existing) {
      out[w.code] = existing.id;
      continue;
    }
    const created = await post("/v1/pharmacy/warehouses", {
      branchCode: BRANCH,
      code: w.code,
      name: w.name,
    });
    if (!created.ok) throw new Error(`Cannot create warehouse ${w.code}: ${msg(created)}`);
    out[w.code] = created.json?.id ?? created.json?.warehouse?.id;
    if (!out[w.code]) throw new Error(`Warehouse ${w.code} created but no id returned`);
  }
  return out;
}

async function createMedicine(suffix, extra = {}) {
  const res = await post("/v1/pharmacy/medicines", {
    branchCode: BRANCH,
    sku: `${SKU_PREFIX}-${suffix}`,
    name: `Phase4 Test ${suffix} (${RUN_ID})`,
    genericName: "Test Generic",
    category: "Tablet",
    purchasePrice: 100,
    costPrice: 100,
    sellingPrice: 150,
    reorderLevel: 10,
    unit: "Piece",
    ...extra,
  });
  if (!res.ok) throw new Error(`Cannot create medicine ${suffix}: ${msg(res)}`);
  const id = res.json?.id ?? res.json?.medicine?.id;
  if (!id) throw new Error(`Medicine ${suffix} created but no id returned`);
  return id;
}

async function grn(warehouseId, lines, idempotencyKey) {
  // The GRN number is generated server-side; only `idempotencyKey` is extra
  // (the controller reads it off the raw body, outside the zod contract).
  return post("/v1/pharmacy/grns", {
    branchCode: BRANCH,
    warehouseId,
    receivedDate: todayPlus(0),
    notes: `Phase 4 test run ${RUN_ID}`,
    lines,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
}

async function stockOf(medicineId, warehouseId) {
  const res = await get(`/v1/pharmacy/inventory/stock/${medicineId}`, {
    branchCode: BRANCH,
    warehouseId,
  });
  if (!res.ok) throw new Error(`Cannot read stock for ${medicineId}: ${msg(res)}`);
  return res.json?.stock ?? res.json;
}

async function availability(medicineId, quantity, warehouseId, batchId) {
  return get("/v1/pharmacy/inventory/availability", {
    branchCode: BRANCH,
    warehouseId,
    medicineId,
    quantity,
    batchId,
  }, { label: "availability" });
}

// ─── security tests ─────────────────────────────────────────────────────────

async function testSecurity(warehouses) {
  const saved = token;

  // 1. No token must be rejected, not served.
  token = "";
  const anon = await get("/v1/pharmacy/inventory/stock", { branchCode: BRANCH });
  check(
    "Security: unauthenticated request is rejected",
    anon.status === 401 || anon.status === 403,
    `status ${anon.status}`,
    "401 or 403",
    anon.status,
  );
  token = saved;

  // 2. A forged token must not be accepted.
  token = `${saved.slice(0, -6)}AAAAAA`;
  const forged = await get("/v1/pharmacy/inventory/stock", { branchCode: BRANCH });
  check(
    "Security: tampered JWT is rejected",
    forged.status === 401 || forged.status === 403,
    `status ${forged.status}`,
    "401 or 403",
    forged.status,
  );
  token = saved;

  // 3. A warehouse id that is not in this branch must not leak data.
  const bogus = await get("/v1/pharmacy/inventory/stock", {
    branchCode: BRANCH,
    warehouseId: "00000000-0000-0000-0000-000000000000",
  });
  check(
    "Security: unauthorised warehouseId is refused (no data leak)",
    bogus.status === 404 || bogus.status === 400,
    `status ${bogus.status}`,
    "404 or 400",
    bogus.status,
  );

  // 4. An unknown branch code must not fall back to another branch.
  const badBranch = await get("/v1/pharmacy/inventory/stock", { branchCode: "NOT-A-BRANCH" });
  check(
    "Security: unknown branchCode is refused",
    badBranch.status === 404 || badBranch.status === 400,
    `status ${badBranch.status}`,
    "404 or 400",
    badBranch.status,
  );

  // 5. Injection in a search parameter must be parameterised away, never executed.
  const inject = await get("/v1/pharmacy/inventory/stock", {
    branchCode: BRANCH,
    q: "'; DROP TABLE pharmacy_medicines; --",
  });
  check(
    "Security: SQL injection in q is neutralised",
    inject.status === 200,
    `status ${inject.status}`,
    "200 with zero or more rows",
    inject.status,
  );
  const stillThere = await get("/v1/pharmacy/inventory/stock", { branchCode: BRANCH });
  check(
    "Security: medicines table intact after injection attempt",
    stillThere.status === 200,
    `status ${stillThere.status}`,
    "200",
    stillThere.status,
  );

  // 6. Invalid pagination / date input must not 500.
  const badPage = await get("/v1/pharmacy/inventory/stock", {
    branchCode: BRANCH,
    page: "-5",
    pageSize: "99999",
  });
  check(
    "Validation: absurd pagination is clamped, not fatal",
    badPage.status === 200 && (badPage.json?.pageSize ?? 0) <= 200,
    `status ${badPage.status}, pageSize ${badPage.json?.pageSize}`,
    "200 and pageSize clamped",
    badPage.json?.pageSize,
  );

  const badDate = await get("/v1/pharmacy/inventory/ledger", {
    branchCode: BRANCH,
    from: "not-a-date",
    to: "13-13-2026",
  });
  check(
    "Validation: invalid date range does not 500",
    badDate.status < 500,
    `status ${badDate.status}`,
    "< 500",
    badDate.status,
  );

  // 7. A non-existent id must be a clean 404, not a crash.
  const badId = await get("/v1/pharmacy/inventory/stock/00000000-0000-0000-0000-000000000000", {
    branchCode: BRANCH,
  });
  check(
    "Validation: unknown medicine id returns 404",
    badId.status === 404,
    `status ${badId.status}`,
    "404",
    badId.status,
  );
  void warehouses;
}

// ─── stock math + FEFO ──────────────────────────────────────────────────────

async function testStockMathAndFefo(warehouses) {
  const wh = warehouses["P4-TEST"];
  const medId = await createMedicine("FEFO");

  // Receive three batches deliberately out of expiry order, so "oldest
  // purchase batch" and "earliest expiry" give different answers.
  const r1 = await grn(wh, [
    {
      medicineId: medId,
      batchNumber: `B-LATE-${RUN_ID}`,
      expiryDate: todayPlus(400),
      quantity: 50,
      unitCostPkr: 100,
    },
  ]);
  check("GRN: first receive posts", r1.ok, `status ${r1.status} ${r1.ok ? "" : msg(r1)}`, "2xx", r1.status);

  const r2 = await grn(wh, [
    {
      medicineId: medId,
      batchNumber: `B-EARLY-${RUN_ID}`,
      expiryDate: todayPlus(60),
      quantity: 30,
      unitCostPkr: 110,
    },
  ]);
  check("GRN: second receive posts", r2.ok, `status ${r2.status} ${r2.ok ? "" : msg(r2)}`, "2xx", r2.status);

  const r3 = await grn(wh, [
    {
      medicineId: medId,
      batchNumber: `B-MID-${RUN_ID}`,
      expiryDate: todayPlus(200),
      quantity: 20,
      unitCostPkr: 105,
    },
  ]);
  check("GRN: third receive posts", r3.ok, `status ${r3.status}`, "2xx", r3.status);

  // Stock math: 50 + 30 + 20 = 100 available and physical.
  const s = await stockOf(medId, wh);
  check(
    "Stock math: available equals sum of received batches",
    Number(s?.availableQty) === 100,
    `availableQty=${s?.availableQty}`,
    100,
    s?.availableQty,
  );
  check(
    "Stock math: physical equals available when nothing is reserved or damaged",
    Number(s?.physicalQty) === 100,
    `physicalQty=${s?.physicalQty}`,
    100,
    s?.physicalQty,
  );
  check(
    "Stock math: reserved/damaged/quarantine/blocked all start at zero",
    Number(s?.reservedQty) === 0 &&
      Number(s?.damagedQty) === 0 &&
      Number(s?.quarantineQty) === 0 &&
      Number(s?.blockedQty) === 0,
    `reserved=${s?.reservedQty} damaged=${s?.damagedQty} quarantine=${s?.quarantineQty} blocked=${s?.blockedQty}`,
    "all 0",
    JSON.stringify({
      r: s?.reservedQty,
      d: s?.damagedQty,
      q: s?.quarantineQty,
      b: s?.blockedQty,
    }),
  );

  // FEFO: the 60-day batch must be picked first even though it was received second.
  const av = await availability(medId, 40, wh);
  check("FEFO: availability endpoint responds", av.ok, `status ${av.status}`, "200", av.status);
  const line = av.json?.lines?.[0];
  const allocs = line?.allocations ?? [];
  check(
    "FEFO: allocation is fulfillable",
    line?.fulfillable === true,
    `fulfillable=${line?.fulfillable} shortfall=${line?.shortfall}`,
    true,
    line?.fulfillable,
  );
  check(
    "FEFO: first allocation is the earliest-expiry batch, not the earliest purchase",
    allocs[0]?.batchNumber === `B-EARLY-${RUN_ID}`,
    `first=${allocs[0]?.batchNumber}`,
    `B-EARLY-${RUN_ID}`,
    allocs[0]?.batchNumber,
  );
  check(
    "FEFO: allocation splits across batches in expiry order",
    allocs.length === 2 &&
      allocs[0]?.quantity === 30 &&
      allocs[1]?.batchNumber === `B-MID-${RUN_ID}` &&
      allocs[1]?.quantity === 10,
    allocs.map((a) => `${a.batchNumber}:${a.quantity}`).join(", "),
    "B-EARLY:30, B-MID:10",
    allocs.map((a) => `${a.batchNumber}:${a.quantity}`).join(", "),
  );

  return { medId, wh };
}

// ─── expiry handling ────────────────────────────────────────────────────────

async function testExpiry(warehouses) {
  const wh = warehouses["P4-TEST"];
  const medId = await createMedicine("EXPIRED");

  // An already-expired batch plus a valid one.
  await grn(wh, [
    {
      medicineId: medId,
      batchNumber: `B-EXP-${RUN_ID}`,
      expiryDate: todayPlus(-30),
      quantity: 40,
      unitCostPkr: 100,
    },
  ]);
  await grn(wh, [
    {
      medicineId: medId,
      batchNumber: `B-OK-${RUN_ID}`,
      expiryDate: todayPlus(300),
      quantity: 10,
      unitCostPkr: 100,
    },
  ]);

  const s = await stockOf(medId, wh);
  check(
    "Expiry: expired units are reported separately",
    Number(s?.expiredQty) === 40,
    `expiredQty=${s?.expiredQty}`,
    40,
    s?.expiredQty,
  );
  check(
    "Expiry: expired stock is excluded from available",
    Number(s?.availableQty) === 10,
    `availableQty=${s?.availableQty} (physical ${s?.physicalQty})`,
    10,
    s?.availableQty,
  );
  check(
    "Expiry: expired stock is still counted as physically present",
    Number(s?.physicalQty) === 50,
    `physicalQty=${s?.physicalQty}`,
    50,
    s?.physicalQty,
  );

  // FEFO must refuse to dispense the expired batch. This was the pre-Phase-4 bug.
  const av = await availability(medId, 20, wh);
  const line = av.json?.lines?.[0];
  check(
    "FEFO: expired batch is never allocated",
    (line?.allocations ?? []).every((a) => a.batchNumber !== `B-EXP-${RUN_ID}`),
    (line?.allocations ?? []).map((a) => a.batchNumber).join(", ") || "none",
    "no B-EXP batch",
    (line?.allocations ?? []).map((a) => a.batchNumber).join(", "),
  );
  check(
    "FEFO: request beyond unexpired stock is reported short with a reason",
    line?.fulfillable === false && line?.shortfall === 10 && Boolean(line?.reason),
    `shortfall=${line?.shortfall} reason=${line?.reason}`,
    "shortfall 10 with reason",
    `${line?.shortfall} / ${line?.reason}`,
  );

  // Expiry buckets must be driven by configuration, and expired must be its own bucket.
  const buckets = await get(
    "/v1/pharmacy/inventory/expiry/buckets",
    { branchCode: BRANCH, warehouseId: wh },
    { label: "expiry-buckets" },
  );
  check("Expiry: bucket endpoint responds", buckets.ok, `status ${buckets.status}`, "200", buckets.status);
  check(
    "Expiry: expired bucket is separate and non-empty",
    Number(buckets.json?.expired?.quantity) >= 40,
    `expired.quantity=${buckets.json?.expired?.quantity}`,
    ">= 40",
    buckets.json?.expired?.quantity,
  );

  return { medId, wh };
}

// ─── negative stock policy ──────────────────────────────────────────────────

async function testNegativeStock(warehouses) {
  const wh = warehouses["P4-TEST"];
  const medId = await createMedicine("NEG");
  await grn(wh, [
    {
      medicineId: medId,
      batchNumber: `B-NEG-${RUN_ID}`,
      expiryDate: todayPlus(300),
      quantity: 5,
      unitCostPkr: 100,
    },
  ]);

  const settings = await get("/v1/pharmacy/inventory/settings", { branchCode: BRANCH });
  check(
    "Negative stock: policy defaults to block",
    settings.json?.negativeStockPolicy === "block",
    `policy=${settings.json?.negativeStockPolicy}`,
    "block",
    settings.json?.negativeStockPolicy,
  );

  // Over-request must be reported as short rather than silently allowed.
  const av = await availability(medId, 500, wh);
  const line = av.json?.lines?.[0];
  check(
    "Negative stock: over-request is reported as not fulfillable",
    line?.fulfillable === false && line?.shortfall === 495,
    `shortfall=${line?.shortfall}`,
    495,
    line?.shortfall,
  );

  // A decrease adjustment beyond stock must be refused under the block policy.
  const adj = await post("/v1/pharmacy/inventory/adjustments", {
    branchCode: BRANCH,
    warehouseId: wh,
    adjustmentType: "decrease",
    reason: `Phase 4 negative-stock test ${RUN_ID}`,
    lines: [{ medicineId: medId, quantity: 500 }],
  });
  let blocked = false;
  let detail = "";
  if (!adj.ok) {
    blocked = true;
    detail = `create refused: ${msg(adj)}`;
  } else {
    const id = adj.json?.id;
    const submitted = await post(`/v1/pharmacy/inventory/adjustments/${id}/submit`, {
      branchCode: BRANCH,
    });
    if (!submitted.ok) {
      blocked = true;
      detail = `submit refused: ${msg(submitted)}`;
    } else {
      const approved = await post(`/v1/pharmacy/inventory/adjustments/${id}/approve`, {
        branchCode: BRANCH,
      });
      blocked = !approved.ok;
      detail = blocked ? `approve refused: ${msg(approved)}` : "adjustment posted (policy not enforced)";
    }
  }
  check(
    "Negative stock: decrease beyond available is refused under block policy",
    blocked,
    detail,
    "refused at some stage",
    detail,
  );

  const after = await stockOf(medId, wh);
  check(
    "Negative stock: available never went below zero",
    Number(after?.availableQty) >= 0,
    `availableQty=${after?.availableQty}`,
    ">= 0",
    after?.availableQty,
  );
}

// ─── adjustments (damage keeps physical constant) ───────────────────────────

async function testAdjustments(warehouses) {
  const wh = warehouses["P4-TEST"];
  const medId = await createMedicine("ADJ");
  await grn(wh, [
    {
      medicineId: medId,
      batchNumber: `B-ADJ-${RUN_ID}`,
      expiryDate: todayPlus(300),
      quantity: 100,
      unitCostPkr: 100,
    },
  ]);

  const batches = await get("/v1/pharmacy/inventory/batches", {
    branchCode: BRANCH,
    warehouseId: wh,
    medicineId: medId,
  });
  const batchId = batches.json?.items?.[0]?.id;
  if (!check("Adjustment: test batch is listed", Boolean(batchId), `batchId=${batchId}`, "a batch id", batchId)) {
    return;
  }

  const before = await stockOf(medId, wh);

  // Reason is mandatory — stock is never modified without one.
  const noReason = await post("/v1/pharmacy/inventory/adjustments", {
    branchCode: BRANCH,
    warehouseId: wh,
    adjustmentType: "damage",
    reason: "",
    lines: [{ medicineId: medId, batchId, quantity: 10 }],
  });
  check(
    "Adjustment: a missing reason is refused",
    !noReason.ok,
    `status ${noReason.status} ${msg(noReason)}`,
    "4xx",
    noReason.status,
  );

  const created = await post("/v1/pharmacy/inventory/adjustments", {
    branchCode: BRANCH,
    warehouseId: wh,
    adjustmentType: "damage",
    reason: `Phase 4 damage test ${RUN_ID}`,
    lines: [{ medicineId: medId, batchId, quantity: 10 }],
  });
  if (!check("Adjustment: damage document created", created.ok, msg(created), "2xx", created.status)) return;
  const adjId = created.json?.id;

  const submitted = await post(`/v1/pharmacy/inventory/adjustments/${adjId}/submit`, {
    branchCode: BRANCH,
  });
  check("Adjustment: submit accepted", submitted.ok, msg(submitted), "2xx", submitted.status);

  let status = submitted.json?.status;
  if (status !== "posted") {
    const approved = await post(`/v1/pharmacy/inventory/adjustments/${adjId}/approve`, {
      branchCode: BRANCH,
    });
    check("Adjustment: approval posts the document", approved.ok, msg(approved), "2xx", approved.status);
    status = approved.json?.status;
  }
  check(
    "Adjustment: final status is posted",
    status === "posted",
    `status=${status}`,
    "posted",
    status,
  );

  const after = await stockOf(medId, wh);
  check(
    "Adjustment: damage reduces available by the adjusted quantity",
    Number(after?.availableQty) === Number(before?.availableQty) - 10,
    `${before?.availableQty} -> ${after?.availableQty}`,
    Number(before?.availableQty) - 10,
    after?.availableQty,
  );
  check(
    "Adjustment: damage increases the damaged bucket",
    Number(after?.damagedQty) === Number(before?.damagedQty) + 10,
    `${before?.damagedQty} -> ${after?.damagedQty}`,
    Number(before?.damagedQty) + 10,
    after?.damagedQty,
  );
  check(
    "Adjustment: damage leaves physical stock unchanged (reclassified, not destroyed)",
    Number(after?.physicalQty) === Number(before?.physicalQty),
    `${before?.physicalQty} -> ${after?.physicalQty}`,
    before?.physicalQty,
    after?.physicalQty,
  );

  // Re-posting must be refused, not silently repeated.
  const replay = await post(`/v1/pharmacy/inventory/adjustments/${adjId}/approve`, {
    branchCode: BRANCH,
  });
  check(
    "Adjustment: re-approving a posted document is refused",
    !replay.ok,
    `status ${replay.status} ${msg(replay)}`,
    "4xx/409",
    replay.status,
  );
  const afterReplay = await stockOf(medId, wh);
  check(
    "Adjustment: replay did not change stock",
    Number(afterReplay?.availableQty) === Number(after?.availableQty),
    `availableQty=${afterReplay?.availableQty}`,
    after?.availableQty,
    afterReplay?.availableQty,
  );
}

// ─── transfers ──────────────────────────────────────────────────────────────

async function testTransfers(warehouses) {
  const from = warehouses["P4-TEST"];
  const to = warehouses["P4-TEST-B"];
  const medId = await createMedicine("TRF");
  await grn(from, [
    {
      medicineId: medId,
      batchNumber: `B-TRF-${RUN_ID}`,
      expiryDate: todayPlus(300),
      quantity: 60,
      unitCostPkr: 100,
    },
  ]);

  const beforeFrom = await stockOf(medId, from);
  const beforeTo = await stockOf(medId, to);

  // Same-warehouse transfer must be rejected.
  const same = await post("/v1/pharmacy/inventory/transfers", {
    branchCode: BRANCH,
    fromWarehouseId: from,
    toWarehouseId: from,
    lines: [{ medicineId: medId, quantity: 5 }],
  });
  check(
    "Transfer: source equal to destination is refused",
    !same.ok,
    `status ${same.status} ${msg(same)}`,
    "4xx",
    same.status,
  );

  const created = await post("/v1/pharmacy/inventory/transfers", {
    branchCode: BRANCH,
    fromWarehouseId: from,
    toWarehouseId: to,
    reason: `Phase 4 transfer test ${RUN_ID}`,
    lines: [{ medicineId: medId, quantity: 25 }],
  });
  if (!check("Transfer: created as draft", created.ok, msg(created), "2xx", created.status)) return;
  const id = created.json?.id;
  check(
    "Transfer: initial status is draft",
    created.json?.status === "draft",
    `status=${created.json?.status}`,
    "draft",
    created.json?.status,
  );

  // Skipping a workflow step must be refused.
  const earlyDispatch = await post(`/v1/pharmacy/inventory/transfers/${id}/dispatch`, {
    branchCode: BRANCH,
  });
  check(
    "Transfer: dispatch before approval is refused",
    !earlyDispatch.ok,
    `status ${earlyDispatch.status} ${msg(earlyDispatch)}`,
    "4xx",
    earlyDispatch.status,
  );

  for (const step of ["submit", "approve"]) {
    const res = await post(`/v1/pharmacy/inventory/transfers/${id}/${step}`, { branchCode: BRANCH });
    check(`Transfer: ${step} accepted`, res.ok, msg(res), "2xx", res.status);
  }

  const dispatched = await post(`/v1/pharmacy/inventory/transfers/${id}/dispatch`, {
    branchCode: BRANCH,
  });
  check("Transfer: dispatch accepted", dispatched.ok, msg(dispatched), "2xx", dispatched.status);

  const midFrom = await stockOf(medId, from);
  check(
    "Transfer: dispatch removes stock from the source warehouse",
    Number(midFrom?.availableQty) === Number(beforeFrom?.availableQty) - 25,
    `${beforeFrom?.availableQty} -> ${midFrom?.availableQty}`,
    Number(beforeFrom?.availableQty) - 25,
    midFrom?.availableQty,
  );

  // Dispatching twice must not deduct twice.
  const replayDispatch = await post(`/v1/pharmacy/inventory/transfers/${id}/dispatch`, {
    branchCode: BRANCH,
  });
  check(
    "Transfer: re-dispatch is refused",
    !replayDispatch.ok,
    `status ${replayDispatch.status}`,
    "4xx/409",
    replayDispatch.status,
  );
  const afterReplay = await stockOf(medId, from);
  check(
    "Transfer: re-dispatch did not double-deduct",
    Number(afterReplay?.availableQty) === Number(midFrom?.availableQty),
    `availableQty=${afterReplay?.availableQty}`,
    midFrom?.availableQty,
    afterReplay?.availableQty,
  );

  const received = await post(`/v1/pharmacy/inventory/transfers/${id}/receive`, {
    branchCode: BRANCH,
  });
  check("Transfer: receive accepted", received.ok, msg(received), "2xx", received.status);

  const endTo = await stockOf(medId, to);
  check(
    "Transfer: receive adds stock at the destination warehouse",
    Number(endTo?.availableQty) === Number(beforeTo?.availableQty) + 25,
    `${beforeTo?.availableQty} -> ${endTo?.availableQty}`,
    Number(beforeTo?.availableQty) + 25,
    endTo?.availableQty,
  );

  // Nothing may be created or destroyed by moving stock between warehouses.
  const totalBefore = Number(beforeFrom?.availableQty) + Number(beforeTo?.availableQty);
  const endFrom = await stockOf(medId, from);
  const totalAfter = Number(endFrom?.availableQty) + Number(endTo?.availableQty);
  check(
    "Transfer: branch-wide quantity is conserved",
    totalBefore === totalAfter,
    `${totalBefore} -> ${totalAfter}`,
    totalBefore,
    totalAfter,
  );

  return { medId, from, to };
}

// ─── stock count ────────────────────────────────────────────────────────────

async function testStockCount(warehouses) {
  const wh = warehouses["P4-TEST"];
  const medId = await createMedicine("CNT");
  await grn(wh, [
    {
      medicineId: medId,
      batchNumber: `B-CNT-${RUN_ID}`,
      expiryDate: todayPlus(300),
      quantity: 80,
      unitCostPkr: 100,
    },
  ]);

  const created = await post("/v1/pharmacy/inventory/counts", {
    branchCode: BRANCH,
    warehouseId: wh,
    countType: "cycle",
    scope: { medicineIds: [medId] },
    notes: `Phase 4 count test ${RUN_ID}`,
  });
  if (!check("Stock count: sheet created", created.ok, msg(created), "2xx", created.status)) return;
  const countId = created.json?.id;

  const detail = await get(`/v1/pharmacy/inventory/counts/${countId}`, { branchCode: BRANCH });
  const lines = detail.json?.lines?.items ?? detail.json?.lines ?? [];
  const lineId = lines[0]?.id;
  check(
    "Stock count: sheet snapshots the system quantity",
    Number(lines[0]?.systemQuantity) === 80,
    `systemQuantity=${lines[0]?.systemQuantity}`,
    80,
    lines[0]?.systemQuantity,
  );

  if (!lineId) {
    record("Stock count: recording skipped", false, "no count line id returned", "a line id", lineId);
    return;
  }

  // Count 75 against a system quantity of 80 — a shortage of 5.
  const recorded = await post(`/v1/pharmacy/inventory/counts/${countId}/record`, {
    branchCode: BRANCH,
    lines: [{ lineId, countedQuantity: 75 }],
  });
  check("Stock count: counted quantity recorded", recorded.ok, msg(recorded), "2xx", recorded.status);

  const posted = await post(`/v1/pharmacy/inventory/counts/${countId}/post`, {
    branchCode: BRANCH,
    reason: `Phase 4 count post ${RUN_ID}`,
  });
  check("Stock count: posted", posted.ok, msg(posted), "2xx", posted.status);
  check(
    "Stock count: posting produced an adjustment document",
    Boolean(posted.json?.adjustmentId),
    `adjustmentId=${posted.json?.adjustmentId}`,
    "an adjustment id",
    posted.json?.adjustmentId,
  );

  const after = await stockOf(medId, wh);
  check(
    "Stock count: system stock now matches the counted quantity",
    Number(after?.availableQty) === 75,
    `availableQty=${after?.availableQty}`,
    75,
    after?.availableQty,
  );

  const replay = await post(`/v1/pharmacy/inventory/counts/${countId}/post`, { branchCode: BRANCH });
  check(
    "Stock count: re-posting is refused",
    !replay.ok,
    `status ${replay.status}`,
    "4xx/409",
    replay.status,
  );
}

// ─── idempotency ────────────────────────────────────────────────────────────

async function testIdempotency(warehouses) {
  const wh = warehouses["P4-TEST"];
  const medId = await createMedicine("IDEM");
  const key = `p4-idem-${RUN_ID}`;
  const line = [
    {
      medicineId: medId,
      batchNumber: `B-IDEM-${RUN_ID}`,
      expiryDate: todayPlus(300),
      quantity: 35,
      unitCostPkr: 100,
    },
  ];

  const first = await grn(wh, line, key);
  check("Idempotency: keyed GRN posts", first.ok, msg(first), "2xx", first.status);
  const afterFirst = await stockOf(medId, wh);

  const second = await grn(wh, line, key);
  check(
    "Idempotency: retrying the same keyed GRN is accepted",
    second.ok,
    `status ${second.status} ${msg(second)}`,
    "2xx",
    second.status,
  );
  check(
    "Idempotency: retry returns the original GRN",
    second.json?.id && second.json?.id === first.json?.id,
    `${first.json?.id} vs ${second.json?.id}`,
    "same id",
    second.json?.id,
  );

  const afterSecond = await stockOf(medId, wh);
  check(
    "Idempotency: retry did not double-receive stock",
    Number(afterSecond?.availableQty) === Number(afterFirst?.availableQty),
    `${afterFirst?.availableQty} -> ${afterSecond?.availableQty}`,
    afterFirst?.availableQty,
    afterSecond?.availableQty,
  );
}

// ─── concurrency ────────────────────────────────────────────────────────────

async function testConcurrency(warehouses) {
  const wh = warehouses["P4-TEST"];
  const medId = await createMedicine("CONC");
  await grn(wh, [
    {
      medicineId: medId,
      batchNumber: `B-CONC-${RUN_ID}`,
      expiryDate: todayPlus(300),
      quantity: 100,
      unitCostPkr: 100,
    },
  ]);

  // Ten simultaneous decrease adjustments of 10 against exactly 100 units.
  // At most ten may succeed, and stock must never go below zero.
  const attempts = await Promise.all(
    Array.from({ length: 10 }, async (_, i) => {
      const created = await post("/v1/pharmacy/inventory/adjustments", {
        branchCode: BRANCH,
        warehouseId: wh,
        adjustmentType: "decrease",
        reason: `Phase 4 concurrency test ${RUN_ID} #${i}`,
        lines: [{ medicineId: medId, quantity: 10 }],
      });
      if (!created.ok) return { ok: false, stage: "create", detail: msg(created) };
      const id = created.json?.id;
      const submitted = await post(`/v1/pharmacy/inventory/adjustments/${id}/submit`, {
        branchCode: BRANCH,
      });
      if (!submitted.ok) return { ok: false, stage: "submit", detail: msg(submitted) };
      if (submitted.json?.status === "posted") return { ok: true, stage: "submit" };
      const approved = await post(`/v1/pharmacy/inventory/adjustments/${id}/approve`, {
        branchCode: BRANCH,
      });
      return approved.ok
        ? { ok: true, stage: "approve" }
        : { ok: false, stage: "approve", detail: msg(approved) };
    }),
  );

  const succeeded = attempts.filter((a) => a.ok).length;
  const after = await stockOf(medId, wh);
  check(
    "Concurrency: parallel deductions never drive stock negative",
    Number(after?.availableQty) >= 0,
    `${succeeded}/10 posted, availableQty=${after?.availableQty}`,
    ">= 0",
    after?.availableQty,
  );
  check(
    "Concurrency: stock math reconciles with the number of successful deductions",
    Number(after?.availableQty) === 100 - succeeded * 10,
    `expected ${100 - succeeded * 10}, got ${after?.availableQty} (${succeeded} succeeded)`,
    100 - succeeded * 10,
    after?.availableQty,
  );
}

// ─── returns ────────────────────────────────────────────────────────────────

async function testReturns(warehouses) {
  const wh = warehouses["P4-TEST"];
  const medId = await createMedicine("RET");
  await grn(wh, [
    {
      medicineId: medId,
      batchNumber: `B-RET-${RUN_ID}`,
      expiryDate: todayPlus(300),
      quantity: 40,
      unitCostPkr: 100,
    },
  ]);

  const batches = await get("/v1/pharmacy/inventory/batches", {
    branchCode: BRANCH,
    warehouseId: wh,
    medicineId: medId,
  });
  const batchId = batches.json?.items?.[0]?.id;
  const before = await stockOf(medId, wh);

  const ret = await post("/v1/pharmacy/purchase-returns", {
    branchCode: BRANCH,
    warehouseId: wh,
    reason: `Phase 4 purchase return test ${RUN_ID}`,
    lines: [{ medicineId: medId, batchId, quantity: 15, unitCostPkr: 100 }],
  });
  check("Returns: purchase return posts", ret.ok, msg(ret), "2xx", ret.status);

  if (ret.ok) {
    const after = await stockOf(medId, wh);
    check(
      "Returns: purchase return reduces stock",
      Number(after?.availableQty) === Number(before?.availableQty) - 15,
      `${before?.availableQty} -> ${after?.availableQty}`,
      Number(before?.availableQty) - 15,
      after?.availableQty,
    );

    // The pre-Phase-4 bug logged purchase returns as a sale.
    const ledger = await get("/v1/pharmacy/inventory/ledger", {
      branchCode: BRANCH,
      medicineId: medId,
      movementType: "PURCHASE_RETURN",
    });
    check(
      "Returns: purchase return is recorded as PURCHASE_RETURN, not SALE",
      (ledger.json?.items ?? []).some((m) => m.movementType === "PURCHASE_RETURN"),
      `found ${(ledger.json?.items ?? []).length} PURCHASE_RETURN rows`,
      ">= 1",
      (ledger.json?.items ?? []).length,
    );
  }
}

// ─── ledger + end-to-end reconciliation ─────────────────────────────────────

async function testLedgerAndReconciliation(fefoCtx) {
  const { medId, wh } = fefoCtx;

  const ledger = await get(
    "/v1/pharmacy/inventory/ledger",
    { branchCode: BRANCH, medicineId: medId, pageSize: 200 },
    { label: "ledger" },
  );
  check("Ledger: register responds", ledger.ok, `status ${ledger.status}`, "200", ledger.status);
  const items = ledger.json?.items ?? [];
  check(
    "Ledger: every receipt wrote a movement row",
    items.filter((m) => m.movementType === "GRN").length >= 3,
    `${items.filter((m) => m.movementType === "GRN").length} GRN rows`,
    ">= 3",
    items.filter((m) => m.movementType === "GRN").length,
  );
  check(
    "Ledger: movement rows carry a running balance and a captured cost",
    items.every((m) => typeof m.quantityAfter === "number") &&
      items.some((m) => Number(m.unitCostPkr) > 0),
    `sample unitCostPkr=${items[0]?.unitCostPkr}, quantityAfter=${items[0]?.quantityAfter}`,
    "numeric balances and a non-zero cost",
    `${items[0]?.unitCostPkr} / ${items[0]?.quantityAfter}`,
  );

  const totals = await get(
    "/v1/pharmacy/inventory/ledger/totals",
    { branchCode: BRANCH, medicineId: medId },
    { label: "ledger-totals" },
  );
  check("Ledger: totals endpoint responds", totals.ok, `status ${totals.status}`, "200", totals.status);

  // END-TO-END RECONCILIATION: ledger in minus ledger out must equal the
  // physical stock on hand for a medicine created entirely within this run.
  const stock = await stockOf(medId, wh);
  const net = Number(totals.json?.netQuantity);
  check(
    "E2E reconciliation: ledger net movement equals physical stock on hand",
    net === Number(stock?.physicalQty),
    `ledger net=${net}, physical=${stock?.physicalQty} (in ${totals.json?.quantityIn}, out ${totals.json?.quantityOut})`,
    stock?.physicalQty,
    net,
  );

  const recon = await get(
    "/v1/pharmacy/inventory/reconcile",
    { branchCode: BRANCH, pageSize: 100 },
    { label: "reconcile" },
  );
  check("Reconciliation: tool responds", recon.ok, `status ${recon.status}`, "200", recon.status);
  const drifting = (recon.json?.items?.items ?? recon.json?.items ?? []).filter(
    (r) => r.medicineId === medId,
  );
  check(
    "Reconciliation: a medicine created this run shows no cache drift",
    drifting.length === 0 || drifting.every((r) => Number(r.cacheDrift) === 0),
    drifting.length ? `cacheDrift=${drifting[0]?.cacheDrift}` : "not listed as drifting",
    "no drift",
    drifting[0]?.cacheDrift ?? 0,
  );

  const dq = await get(
    "/v1/pharmacy/inventory/data-quality",
    { branchCode: BRANCH },
    { label: "data-quality" },
  );
  check(
    "Data quality: tool responds with real checks",
    dq.ok && Array.isArray(dq.json) && dq.json.length > 0,
    `${Array.isArray(dq.json) ? dq.json.length : 0} checks`,
    "> 0 checks",
    Array.isArray(dq.json) ? dq.json.length : 0,
  );
}

// ─── performance ────────────────────────────────────────────────────────────

async function testPerformance(warehouses, fefoCtx) {
  const wh = warehouses["P4-TEST"];
  const budget = {
    "stock-list": 500,
    "product-lookup": 300,
    availability: 300,
    "batch-list": 300,
    dashboard: 1000,
    ledger: 500,
    "expiry-buckets": 500,
    "valuation-summary": 1000,
    reorder: 1000,
  };

  const probes = [
    ["stock-list", () => get("/v1/pharmacy/inventory/stock", { branchCode: BRANCH, pageSize: 25 })],
    [
      "product-lookup",
      () => get(`/v1/pharmacy/inventory/stock/${fefoCtx.medId}`, { branchCode: BRANCH, warehouseId: wh }),
    ],
    ["availability", () => availability(fefoCtx.medId, 5, wh)],
    ["batch-list", () => get("/v1/pharmacy/inventory/batches", { branchCode: BRANCH, pageSize: 25 })],
    ["dashboard", () => get("/v1/pharmacy/inventory/dashboard", { branchCode: BRANCH })],
    ["ledger", () => get("/v1/pharmacy/inventory/ledger", { branchCode: BRANCH, pageSize: 50 })],
    ["expiry-buckets", () => get("/v1/pharmacy/inventory/expiry/buckets", { branchCode: BRANCH })],
    ["valuation-summary", () => get("/v1/pharmacy/inventory/valuation/summary", { branchCode: BRANCH })],
    ["reorder", () => get("/v1/pharmacy/inventory/reorder", { branchCode: BRANCH, pageSize: 25 })],
  ];

  const perf = [];
  for (const [label, fn] of probes) {
    const runs = [];
    let status = 0;
    for (let i = 0; i < 3; i += 1) {
      const res = await fn();
      runs.push(res.ms);
      status = res.status;
    }
    runs.sort((a, b) => a - b);
    const median = Math.round(runs[1]);
    const best = Math.round(runs[0]);
    const worst = Math.round(runs[2]);
    perf.push({ label, status, best, median, worst, budgetMs: budget[label] ?? null });
    check(
      `Performance: ${label} median ${median}ms within ${budget[label]}ms budget`,
      status === 200 && median <= (budget[label] ?? Infinity),
      `status ${status}, best ${best}ms / median ${median}ms / worst ${worst}ms`,
      `<= ${budget[label]}ms`,
      `${median}ms`,
    );
  }
  return perf;
}

// ─── main ───────────────────────────────────────────────────────────────────

(async () => {
  console.log(`Phase 4 inventory tests → ${API}`);
  console.log(`Branch ${BRANCH}, run id ${RUN_ID}\n`);

  let perf = [];
  try {
    await login();
    console.log("Authenticated.\n");
    const warehouses = await ensureTestWarehouses();
    console.log(`Test warehouses ready: ${Object.keys(warehouses).join(", ")}\n`);

    await testSecurity(warehouses);
    const fefoCtx = await testStockMathAndFefo(warehouses);
    await testExpiry(warehouses);
    await testNegativeStock(warehouses);
    await testAdjustments(warehouses);
    await testTransfers(warehouses);
    await testStockCount(warehouses);
    await testIdempotency(warehouses);
    await testConcurrency(warehouses);
    await testReturns(warehouses);
    await testLedgerAndReconciliation(fefoCtx);
    perf = await testPerformance(warehouses, fefoCtx);
  } catch (err) {
    record("Suite execution", false, err instanceof Error ? err.message : String(err));
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`RESULT: ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log("=".repeat(60));
  if (failed) {
    console.log("\nFailures:");
    for (const r of results.filter((x) => !x.passed)) {
      console.log(`  - ${r.name}`);
      if (r.detail) console.log(`      ${r.detail}`);
      if (r.expected !== undefined) console.log(`      expected: ${r.expected}, actual: ${r.actual}`);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    api: API,
    branch: BRANCH,
    runId: RUN_ID,
    summary: { total: results.length, passed, failed },
    results,
    performance: perf,
    requestTimings: timings,
  };

  const candidates = [
    path.join(__dirname, "..", "..", "Universal-application-system-", "docs", "PHASE_4_TEST_RESULTS.json"),
    path.join(__dirname, "phase4-test-results.json"),
  ];
  for (const out of candidates) {
    try {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(report, null, 2));
      console.log(`\nReport written: ${out}`);
      break;
    } catch {
      // try the next location
    }
  }

  process.exit(failed ? 1 : 0);
})();
