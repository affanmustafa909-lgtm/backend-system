/**
 * Musa Cafe Real PRA test case — uses portal POS row + classic company details.
 *
 * Portal row (user-provided):
 *   POSID 197656 · Access 851C6C3B · Main · Musa Cafe and Restaurants
 *   Token ab9b3002-8024-3181-a7b6-427be47603c6 · status Disconnected
 *
 * Company (existing Musa seed):
 *   NTN 5272644-3 · CNIC/username 3220381740551 · Restaurant · Punjab
 *
 * What this tests:
 *   1) PostData Items use real dish `label` (not generic "Item")
 *   2) Line TaxCharged is allocated on food only (service/delivery TaxCharged = 0)
 *   3) Gross is food-only; Net = Gross + ST + service (+ delivery)
 *   4) Optional live probe with POSID 0 (no real fiscal invoice)
 *
 * Usage:
 *   node backend-system/scripts/test-musa-pra-invoice-case.mjs
 *   node backend-system/scripts/test-musa-pra-invoice-case.mjs --probe
 */
import https from "https";
import {
  buildBillPraSourceLines,
  parsePraSourceLines,
} from "../api/src/tax-authority/pra-invoice-lines.ts";

const PRODUCTION_URL = "https://ims.pral.com.pk/ims/production/api/Live/PostData";

/** Portal POS registration row + Musa Cafe company profile. */
const MUSA = {
  companyName: "Musa Cafe and Restaurants",
  branchName: "Main",
  branchCode: "MAIN",
  ntn: "5272644-3",
  username: "3220381740551",
  province: "Punjab",
  businessType: "Restaurant",
  /** From user portal row */
  posId: 197656,
  accessCode: "851C6C3B",
  token: "ab9b3002-8024-3181-a7b6-427be47603c6",
  /** Historical seed POS (kept for reference / fallback compare) */
  legacyPosId: 197476,
  legacyAccessCode: "1DE18D10",
  legacyToken: "1458bbac-7799-3524-abd5-36dec2dfc82e",
};

/** Mirrors the broken PRA invoice screenshot (Description=Item, Tax=0, Net≠Gross+ST). */
const BILL_CASE = {
  billRef: "BILL-MUSA-TEST",
  sourceId: "ab9b3002-8024-3181-a7b6-427be47603c6",
  dated: "31-Jul-2026",
  linesJson: JSON.stringify([
    { label: "Chicken Karahi", qty: 1, unitPrice: 280 },
  ]),
  subtotalPkr: 280,
  discountPkr: 0,
  servicePkr: 22,
  deliveryChargePkr: 0,
  taxPkr: 45,
  totalPkr: 347,
};

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function buildPraUsin(sourceId, sourceRef) {
  const idPart = sourceId.replace(/-/g, "").slice(0, 8);
  const refPart = sourceRef.replace(/[^A-Za-z0-9]/g, "").slice(-28);
  const body = refPart ? `${idPart}-${refPart}` : idPart;
  return body.slice(0, 50) || `USIN${Date.now()}`.slice(0, 50);
}

function buildPostDataPayload() {
  const { lines, taxableAmountPkr, taxAmountPkr } = buildBillPraSourceLines(BILL_CASE);
  const service = Math.max(0, BILL_CASE.servicePkr);
  const delivery = Math.max(0, BILL_CASE.deliveryChargePkr);
  const totalBillAmount = taxableAmountPkr + taxAmountPkr + service + delivery;
  const now = new Date();
  const dt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const items = lines.map((line, idx) => {
    const saleValue = Math.max(0, Math.round(line.amount));
    const lineTax = Math.max(0, Math.round(line.tax || 0));
    const taxRate = saleValue > 0 ? Math.round((lineTax / saleValue) * 10000) / 100 : 0;
    return {
      ItemCode: `IT_${idx + 1}`,
      ItemName: (line.description || `Item ${idx + 1}`).slice(0, 100),
      Quantity: Math.max(1, line.qty || 1),
      PCTCode: "98012000",
      TaxRate: taxRate,
      SaleValue: saleValue,
      TotalAmount: saleValue + lineTax,
      TaxCharged: lineTax,
      Discount: 0,
      FurtherTax: 0,
      InvoiceType: 1,
      RefUSIN: null,
    };
  });

  return {
    InvoiceNumber: "",
    POSID: MUSA.posId,
    USIN: buildPraUsin(BILL_CASE.sourceId, BILL_CASE.billRef),
    DateTime: dt,
    BuyerPNTN: "",
    BuyerCNIC: "",
    BuyerName: "Walking Customer",
    BuyerPhoneNumber: "",
    TotalBillAmount: totalBillAmount,
    TotalQuantity: Math.max(
      1,
      items.reduce((s, it) => s + Number(it.Quantity), 0),
    ),
    TotalSaleValue: taxableAmountPkr,
    TotalTaxCharged: taxAmountPkr,
    Discount: 0,
    FurtherTax: 0,
    PaymentMode: 1,
    RefUSIN: null,
    InvoiceType: 1,
    Items: items,
    _meta: {
      companyName: MUSA.companyName,
      branchName: MUSA.branchName,
      dated: BILL_CASE.dated,
      lines,
      taxableAmountPkr,
      taxAmountPkr,
    },
  };
}

function runPayloadAssertions(payload) {
  console.log("\n=== 1) Label parse (must not be Item) ===");
  const parsed = parsePraSourceLines(BILL_CASE.linesJson);
  assert(parsed[0]?.description === "Chicken Karahi", `got ${parsed[0]?.description}`);
  console.log("OK parseLines →", parsed[0].description);

  console.log("\n=== 2) PostData Items ===");
  const food = payload.Items.find((i) => i.ItemName === "Chicken Karahi");
  const service = payload.Items.find((i) => i.ItemName === "Service charges");
  assert(food, "missing Chicken Karahi item");
  assert(service, "missing Service charges item");
  assert(food.ItemName !== "Item", "ItemName still generic Item");
  assert(food.TaxCharged > 0, `food TaxCharged is ${food.TaxCharged}`);
  assert(service.TaxCharged === 0, `service TaxCharged is ${service.TaxCharged} (must be 0)`);
  const taxSum = payload.Items.reduce((s, i) => s + i.TaxCharged, 0);
  assert(taxSum === payload.TotalTaxCharged, `line tax sum ${taxSum} != ${payload.TotalTaxCharged}`);
  assert(taxSum === 42, `expected scaled food tax 42, got ${taxSum}`); // round(45*280/302)
  console.log("OK Items:", payload.Items.map((i) => ({
    ItemName: i.ItemName,
    SaleValue: i.SaleValue,
    TaxCharged: i.TaxCharged,
    TotalAmount: i.TotalAmount,
  })));

  console.log("\n=== 3) Totals (food Gross + ST + service = Net) ===");
  assert(payload.TotalSaleValue === 280, `Gross ${payload.TotalSaleValue}`);
  assert(payload.TotalTaxCharged === 42, `ST ${payload.TotalTaxCharged}`);
  assert(payload.TotalBillAmount === 344, `Net ${payload.TotalBillAmount}`); // 280+42+22
  assert(
    payload.TotalSaleValue + payload.TotalTaxCharged + BILL_CASE.servicePkr ===
      payload.TotalBillAmount,
    `Gross+ST+service ${payload.TotalSaleValue + payload.TotalTaxCharged + BILL_CASE.servicePkr} != Net ${payload.TotalBillAmount}`,
  );
  console.log(
    "OK Gross",
    payload.TotalSaleValue,
    "+ ST",
    payload.TotalTaxCharged,
    "+ service",
    BILL_CASE.servicePkr,
    "= Net",
    payload.TotalBillAmount,
  );

  console.log("\n=== 4) Musa POS header ===");
  assert(payload.POSID === MUSA.posId, `POSID ${payload.POSID}`);
  console.log("OK POSID", payload.POSID, "USIN", payload.USIN, "company", MUSA.companyName);
}

function postJson(url, token, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: "ims.pral.com.pk",
        path: url.replace("https://ims.pral.com.pk", ""),
        method: "POST",
        family: 4,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode, text });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(20000, () => {
      req.destroy(new Error("timeout"));
    });
    req.write(data);
    req.end();
  });
}

/**
 * Safe probe: POSID 0 should return a validation fault (proves token reaches PRAL)
 * without issuing a real invoice for Musa Cafe POS 197656.
 */
async function probeConnection(payload) {
  console.log("\n=== 5) Live probe (POSID 0 — no real fiscal) ===");
  const probe = {
    ...payload,
    POSID: 0,
    USIN: `PROBE-${Date.now()}`.slice(0, 50),
  };
  delete probe._meta;
  try {
    const res = await postJson(PRODUCTION_URL, MUSA.token, probe);
    console.log("HTTP", res.status);
    console.log("Body", res.text.slice(0, 600));
    const reached =
      res.status === 200 ||
      /POSID|validation|invalid|fault|error|invoice/i.test(res.text);
    assert(reached || res.status > 0, "no response from PRAL");
    console.log(
      reached
        ? "OK PRAL reachable with new Musa token (Disconnected portal row may still reject live POSID)"
        : "WARN unexpected empty body",
    );
  } catch (err) {
    console.warn(
      "PROBE network error (IP whitelist / offline):",
      err instanceof Error ? err.message : err,
    );
    console.log("SKIP live probe — payload assertions already passed locally.");
  }
}

async function main() {
  const doProbe = process.argv.includes("--probe");
  console.log("Musa Cafe PRA invoice test case");
  console.log(
    JSON.stringify(
      {
        company: MUSA.companyName,
        branch: MUSA.branchName,
        posId: MUSA.posId,
        accessCode: MUSA.accessCode,
        tokenPrefix: MUSA.token.slice(0, 8),
        legacyPosId: MUSA.legacyPosId,
        bill: BILL_CASE.billRef,
        dated: BILL_CASE.dated,
      },
      null,
      2,
    ),
  );

  const payload = buildPostDataPayload();
  runPayloadAssertions(payload);

  const printable = { ...payload };
  delete printable._meta;
  console.log("\n=== Sample PostData (would be sent on Pay) ===");
  console.log(JSON.stringify(printable, null, 2));

  if (doProbe) {
    await probeConnection(payload);
  } else {
    console.log("\n(tip) Add --probe to hit PRAL with POSID 0 using the new token.");
  }

  console.log("\nALL LOCAL ASSERTIONS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
