/**
 * Live Embroidery Factory API QA — login, list every module, create sample rows, re-list.
 *
 *   API_BASE=https://… node scripts/embroidery-live-qa.mjs
 *   API_BASE=http://127.0.0.1:3000 node scripts/embroidery-live-qa.mjs
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API = (process.env.API_BASE || "https://backend-system-production-28a3.up.railway.app").replace(
  /\/$/,
  "",
);
const EMAIL = (process.env.EMBROIDERY_ADMIN_EMAIL || "admin.embroidery@factory.demo").toLowerCase();
const PASSWORD = process.env.SEED_USER_PASSWORD || "Owner@12345";

const EXTRA_KINDS = [
  "purchase-orders",
  "purchase-receipts",
  "defect-returns",
  "handwork-issue",
  "handwork-return",
  "attendance",
  "leave",
  "thread-consumption",
  "stitch-rates",
  "job-out",
  "expenses",
  "maintenance-logs",
  "salary-slips",
  "eway-records",
  "brokers",
];

const results = [];
let token = "";
let branchId = null;
let partyId = null;
let operatorId = null;
let itemId = null;
let designId = null;
let machineId = null;
let jobId = null;

function record(name, ok, detail = "", meta = {}) {
  results.push({ name, ok, detail, ...meta });
  const tag = ok ? "PASS" : "FAIL";
  console.log(`${tag}  ${name}${detail ? ` — ${detail}` : ""}`);
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
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, ok: res.ok, json, text };
}

function msg(res) {
  const m = res.json?.message;
  return Array.isArray(m) ? m.join("; ") : m ?? res.text?.slice(0, 240) ?? String(res.status);
}

function isArr(x) {
  return Array.isArray(x);
}

async function expectOk(name, method, route, opts = {}) {
  const res = await req(method, route, opts);
  if (!res.ok) {
    record(name, false, `${res.status} ${msg(res)}`);
    return res;
  }
  record(name, true, String(res.status));
  return res;
}

async function main() {
  console.log(`API=${API}`);
  console.log(`USER=${EMAIL}`);

  const health = await req("GET", "/health", { auth: false });
  if (!health.ok) {
    record("health", false, msg(health));
    finish(1);
  }
  record("health", true, JSON.stringify(health.json?.status ?? health.status));

  const login = await req("POST", "/v1/auth/login", {
    auth: false,
    body: { email: EMAIL, password: PASSWORD },
  });
  if (!login.ok) {
    record("auth.login", false, `${login.status} ${msg(login)}`);
    finish(1);
  }
  token = login.json?.accessToken || login.json?.token;
  if (!token) {
    record("auth.login.token", false, "no access token");
    finish(1);
  }
  record("auth.login", true, EMAIL);

  // Resolve branch (operations API — not /v1/pops/branches)
  const branches = await req("GET", "/v1/operations/branches");
  if (branches.ok && isArr(branches.json) && branches.json.length) {
    const emb = branches.json.find((b) => String(b.code || "").includes("EMB")) || branches.json[0];
    branchId = emb.id;
    record("branches.list", true, `branchId=${branchId} code=${emb.code}`);
  } else if (branches.ok && isArr(branches.json?.items) && branches.json.items.length) {
    const emb =
      branches.json.items.find((b) => String(b.code || "").includes("EMB")) || branches.json.items[0];
    branchId = emb.id;
    record("branches.list", true, `branchId=${branchId} code=${emb.code}`);
  } else {
    const partiesProbe = await req("GET", "/v1/factory/parties");
    if (partiesProbe.ok && isArr(partiesProbe.json) && partiesProbe.json[0]?.branchId) {
      branchId = partiesProbe.json[0].branchId;
      record("branches.list", true, `from parties.branchId=${branchId}`);
    } else {
      record("branches.list", false, `${branches.status} ${msg(branches)}`);
    }
  }

  // --- Factory GETs ---
  const factoryGets = [
    ["factory.parties", "/v1/factory/parties"],
    ["factory.operators", "/v1/factory/operators"],
    ["factory.inward", "/v1/factory/inward-challans"],
    ["factory.outward", "/v1/factory/outward-challans"],
    ["factory.dailySheets", "/v1/factory/daily-sheets"],
    ["factory.jobBills", "/v1/factory/job-bills"],
    ["factory.ledger", "/v1/factory/ledger"],
    ["factory.advances", "/v1/factory/advances"],
    ["factory.mis", "/v1/factory/mis/summary"],
    ["factory.printers", "/v1/factory/printers"],
    ["factory.printJobs", "/v1/factory/print-jobs"],
    ["factory.packing", "/v1/factory/packing"],
  ];
  for (const [name, route] of factoryGets) {
    const res = await expectOk(name, "GET", route, { query: { branchId } });
    if (name === "factory.parties" && isArr(res.json) && res.json[0]) partyId = res.json[0].id;
    if (name === "factory.operators" && isArr(res.json) && res.json[0]) operatorId = res.json[0].id;
  }

  if (branchId) {
    const items = await expectOk("factory.items", "GET", "/v1/factory/items", { query: { branchId } });
    if (isArr(items.json) && items.json[0]) itemId = items.json[0].id;
  }

  // --- Embroidery GETs ---
  const embGets = [
    ["emb.designs", "/v1/embroidery/designs"],
    ["emb.machines", "/v1/embroidery/machines"],
    ["emb.orders", "/v1/embroidery/orders"],
    ["emb.jobs", "/v1/embroidery/jobs"],
    ["emb.productionBoard", "/v1/embroidery/production-board"],
    ["emb.productionLogs", "/v1/embroidery/production-logs"],
    ["emb.materials", "/v1/embroidery/materials"],
    ["emb.qc", "/v1/embroidery/qc"],
    ["emb.deliveries", "/v1/embroidery/deliveries"],
    ["emb.pieceRates", "/v1/embroidery/piece-rates"],
    ["emb.reports", "/v1/embroidery/reports/summary"],
  ];
  for (const [name, route] of embGets) {
    const res = await expectOk(name, "GET", route, { query: { branchId } });
    if (name === "emb.designs" && isArr(res.json) && res.json[0]) {
      designId = res.json[0].id;
      const hasPreviewKey = "hasPreview" in (res.json[0] || {});
      const preview = res.json[0].previewBase64;
      record(
        "emb.designs.listPayload",
        preview == null || preview === "" || hasPreviewKey,
        `hasPreview=${res.json[0].hasPreview ?? "n/a"} previewLen=${preview ? String(preview).length : 0}`,
      );
    }
    if (name === "emb.machines" && isArr(res.json) && res.json[0]) machineId = res.json[0].id;
    if (name === "emb.jobs" && isArr(res.json) && res.json[0]) {
      jobId = res.json[0].id;
      const j = res.json[0];
      record(
        "emb.jobs.mapJobFields",
        "priority" in j || "inwardChallanId" in j || "factoryOperatorId" in j,
        `keys=${Object.keys(j).filter((k) => /priority|inward|operator|needle|details/i.test(k)).join(",") || "none"}`,
      );
    }
  }

  // piece-rates with branchId (new fix — may fail on stale deploy)
  await expectOk("emb.pieceRates.branchFilter", "GET", "/v1/embroidery/piece-rates", {
    query: { branchId },
  });

  // invalid UUID should 400 on latest code (stale deploy may 500)
  const badUuid = await req("GET", "/v1/embroidery/jobs", { query: { branchId: "not-a-uuid" } });
  record(
    "emb.jobs.invalidBranchUuid",
    badUuid.status === 400,
    `${badUuid.status} ${badUuid.status === 400 ? "ok" : "(want 400 — needs latest API)"}`,
  );

  // --- Extra module GETs ---
  for (const kind of EXTRA_KINDS) {
    await expectOk(`extra.list.${kind}`, "GET", `/v1/factory/extra/${kind}`, { query: { branchId } });
  }

  // --- Creates (mutations) ---
  const today = new Date().toISOString().slice(0, 10);

  if (branchId) {
    const partyRes = await expectOk("factory.parties.create", "POST", "/v1/factory/parties", {
      body: {
        branchId,
        kind: "customer",
        name: `QA Party ${Date.now().toString(36)}`,
        city: "Lahore",
      },
    });
    if (partyRes.ok && partyRes.json?.id) partyId = partyRes.json.id;

    const opRes = await expectOk("factory.operators.create", "POST", "/v1/factory/operators", {
      body: {
        branchId,
        code: `OP-QA-${Date.now().toString(36).slice(-4)}`,
        name: "QA Operator",
        phone: "03001234567",
      },
    });
    if (opRes.ok && opRes.json?.id) operatorId = opRes.json.id;

    const itemRes = await expectOk("factory.items.create", "POST", "/v1/factory/items", {
      body: {
        branchId,
        sku: `THR-QA-${Date.now().toString(36).slice(-4)}`,
        name: "QA Thread Cone",
        category: "thread",
        unit: "cone",
        costPkr: 500,
      },
    });
    if (itemRes.ok && itemRes.json?.id) itemId = itemRes.json.id;

    await expectOk("emb.designs.create", "POST", "/v1/embroidery/designs", {
      body: {
        branchId,
        code: `DSN-QA-${Date.now().toString(36).slice(-4)}`,
        name: "QA Design",
        stitchCount: 12000,
        colorways: "Navy,White,Gold,Red",
      },
    }).then((r) => {
      if (r.ok && r.json?.id) designId = r.json.id;
    });

    await expectOk("emb.machines.create", "POST", "/v1/embroidery/machines", {
      body: {
        branchId,
        code: `M-QA-${Date.now().toString(36).slice(-4)}`,
        name: "QA Machine",
        heads: 12,
        status: "idle",
      },
    }).then((r) => {
      if (r.ok && r.json?.id) machineId = r.json.id;
    });

    if (designId) {
      const jobRes = await expectOk("emb.jobs.create", "POST", "/v1/embroidery/jobs", {
        body: {
          branchId,
          designId,
          machineId: machineId || null,
          stage: "draft",
          priority: "normal",
          factoryOperatorId: operatorId || null,
          lines: [{ sizeLabel: "M", colorLabel: "Navy", quantity: 10 }],
        },
      });
      if (jobRes.ok && jobRes.json?.id) {
        jobId = jobRes.json.id;
        const j = jobRes.json;
        record(
          "emb.jobs.create.mapFields",
          "priority" in j && ("factoryOperatorId" in j || j.factoryOperatorId === operatorId),
          `priority=${j.priority} factoryOperatorId=${j.factoryOperatorId ?? "null"}`,
        );
        // PATCH job with factory fields
        const patch = await expectOk("emb.jobs.patch", "PATCH", `/v1/embroidery/jobs/${jobId}`, {
          body: { priority: "rush", factoryOperatorId: operatorId || null, detailsJson: "{\"qa\":true}" },
        });
        if (patch.ok) {
          record(
            "emb.jobs.patch.fields",
            patch.json?.priority === "rush",
            `priority=${patch.json?.priority}`,
          );
        }
      }
    } else {
      record("emb.jobs.create", false, "skipped — no designId");
    }

    // Extra creates covering required fields
    await expectOk("extra.create.purchase-orders", "POST", "/v1/factory/extra/purchase-orders", {
      body: { branchId, payload: { poDate: today, amountPkr: 15000, status: "open", notes: "live-qa" } },
    });
    await expectOk("extra.create.expenses", "POST", "/v1/factory/extra/expenses", {
      body: {
        branchId,
        payload: { expenseDate: today, category: "misc", amountPkr: 2500, payMode: "cash", narration: "QA expense" },
      },
    });
    await expectOk("extra.create.stitch-rates", "POST", "/v1/factory/extra/stitch-rates", {
      body: { branchId, payload: { name: "QA Flat Rate", ratePer1kPkr: 85, workType: "flat", active: "yes" } },
    });
    await expectOk("extra.create.brokers", "POST", "/v1/factory/extra/brokers", {
      body: { branchId, payload: { name: "QA Broker", phone: "03001112233", commissionPct: 2.5, active: "yes" } },
    });

    if (operatorId) {
      await expectOk("extra.create.attendance", "POST", "/v1/factory/extra/attendance", {
        body: {
          branchId,
          payload: { operatorId, attendDate: today, shift: "day", status: "present", hours: 8 },
        },
      });
      await expectOk("extra.create.salary-slips", "POST", "/v1/factory/extra/salary-slips", {
        body: {
          branchId,
          payload: {
            operatorId,
            periodMonth: today.slice(0, 7),
            grossPkr: 45000,
            advancesPkr: 5000,
            netPkr: 40000,
            status: "draft",
          },
        },
      });
    } else {
      record("extra.create.attendance", false, "no operatorId");
      record("extra.create.salary-slips", false, "no operatorId");
    }

    if (itemId) {
      await expectOk("extra.create.thread-consumption", "POST", "/v1/factory/extra/thread-consumption", {
        body: {
          branchId,
          payload: { entryDate: today, itemId, qty: 1, unit: "cone", notes: "live-qa stock deduct" },
        },
      });
    } else {
      record("extra.create.thread-consumption", false, "no itemId");
    }

    // AI analyze (manage-only) — tiny valid base64 payload
    const tinyPng =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    await expectOk("factory.aiAnalyze", "POST", "/v1/factory/designs/ai-analyze", {
      body: {
        branchId,
        fileName: "qa.png",
        fileMimeType: "image/png",
        fileContentBase64: tinyPng,
        hint: "live qa",
      },
    });
  }

  // Re-list extras after create
  for (const kind of ["purchase-orders", "expenses", "stitch-rates", "brokers", "attendance"]) {
    const res = await req("GET", `/v1/factory/extra/${kind}`, { query: { branchId } });
    const n = isArr(res.json) ? res.json.length : -1;
    record(`extra.relist.${kind}`, res.ok && n >= 0, res.ok ? `rows=${n}` : msg(res));
  }

  // Isolation: embroidery token should NOT access accounting
  const acct = await req("GET", "/v1/accounting/accounts", { query: { branchId } });
  record(
    "isolation.accountingBlocked",
    acct.status === 403 || acct.status === 401 || !acct.ok,
    `${acct.status}`,
  );

  finish(results.some((r) => !r.ok) ? 1 : 0);
}

function finish(code) {
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  const summary = {
    api: API,
    email: EMAIL,
    branchId,
    pass,
    fail,
    total: results.length,
    ts: new Date().toISOString(),
    results,
  };
  const out = join(dirname(fileURLToPath(import.meta.url)), "embroidery-live-qa-results.json");
  writeFileSync(out, JSON.stringify(summary, null, 2));
  console.log(`\nSUMMARY  pass=${pass} fail=${fail} total=${results.length}`);
  console.log(`Wrote ${out}`);
  process.exit(code);
}

main().catch((err) => {
  console.error(err);
  record("fatal", false, String(err?.message || err));
  finish(1);
});
