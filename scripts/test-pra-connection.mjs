/**
 * Probe PRA PostData (sandbox + production) with Musa Cafe credentials.
 * Usage: node backend-system/scripts/test-pra-connection.mjs
 */
const SANDBOX_URL = "https://ims.pral.com.pk/ims/sandbox/api/Live/PostData";
const PRODUCTION_URL = "https://ims.pral.com.pk/ims/production/api/Live/PostData";
const SANDBOX_TOKEN = "24d8fab3-f2e9-398f-ae17-b387125ec4a2";

const MUSA = {
  posId: 197656,
  accessCode: "851C6C3B",
  token: "ab9b3002-8024-3181-a7b6-427be47603c6",
  cnic: "3220381740551",
  pntn: "5272644-3",
  businessName: "Musa Cafe and Restaurants",
};

function samplePayload(posId) {
  const now = new Date();
  const stamp = now.toISOString().replace("T", " ").slice(0, 19);
  return {
    InvoiceNumber: "",
    POSID: posId,
    USIN: `TEST-${Date.now()}`,
    DateTime: stamp,
    BuyerPNTN: "",
    BuyerCNIC: "",
    BuyerName: "Walking Customer",
    BuyerPhoneNumber: "",
    TotalBillAmount: 100,
    TotalQuantity: 1,
    TotalSaleValue: 100,
    TotalTaxCharged: 0,
    Discount: 0,
    FurtherTax: 0,
    PaymentMode: 1,
    RefUSIN: null,
    InvoiceType: 1,
    Items: [
      {
        ItemCode: "IT_1",
        ItemName: "Connection Test Item",
        Quantity: 1,
        PCTCode: "98012000",
        TaxRate: 0,
        SaleValue: 100,
        TotalAmount: 100,
        TaxCharged: 0,
        Discount: 0,
        FurtherTax: 0,
        InvoiceType: 1,
        RefUSIN: null,
      },
    ],
  };
}

async function post(label, url, token, posId) {
  console.log(`\n=== ${label} ===`);
  console.log("URL:", url);
  console.log("POSID:", posId);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(samplePayload(posId)),
    });
    const text = await res.text();
    console.log("HTTP:", res.status, res.statusText);
    console.log("Body:", text.slice(0, 800));
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    console.error("Network error:", err instanceof Error ? err.message : err);
    return { ok: false, status: 0, text: String(err) };
  }
}

async function main() {
  console.log("Musa Cafe PRA probe");
  console.log(JSON.stringify(MUSA, null, 2));

  await post("SANDBOX (official sample token + POS 0)", SANDBOX_URL, SANDBOX_TOKEN, 0);
  await post(
    "SANDBOX (Musa production token — may fail)",
    SANDBOX_URL,
    MUSA.token,
    MUSA.posId,
  );
  await post(
    "PRODUCTION (Musa POS token — needs IP whitelist)",
    PRODUCTION_URL,
    MUSA.token,
    MUSA.posId,
  );
}

main();
