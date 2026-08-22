/**
 * Self-test for Real PRA line mapping.
 * Run: npx tsx scripts/pra-invoice-lines.selftest.mts
 */
import {
  allocateLineTaxes,
  buildBillPraSourceLines,
  parsePraSourceLines,
} from "../api/src/tax-authority/pra-invoice-lines.ts";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const parsed = parsePraSourceLines(
  JSON.stringify([
    { label: "Chicken Karahi", qty: 1, unitPrice: 280 },
    { label: "Soft drink", qty: 2, unitPrice: 120 },
  ]),
);
assert(parsed[0]!.description === "Chicken Karahi", `got ${parsed[0]?.description}`);
assert(parsed[0]!.amount === 280, `amount ${parsed[0]?.amount}`);

// Legacy bill tax included service (15% of 280+22=302 ≈ 45). PRA must tax food only.
const built = buildBillPraSourceLines({
  linesJson: JSON.stringify([{ label: "Chicken Karahi", qty: 1, unitPrice: 280 }]),
  subtotalPkr: 280,
  discountPkr: 0,
  servicePkr: 22,
  deliveryChargePkr: 50,
  taxPkr: 45,
});
assert(built.taxableAmountPkr === 280, `taxable ${built.taxableAmountPkr}`);
assert(built.lines[0]!.description === "Chicken Karahi", "item name");
const serviceLine = built.lines.find((l) => l.description === "Service charges");
const deliveryLine = built.lines.find((l) => l.description === "Delivery charges");
assert(Boolean(serviceLine), "service line");
assert(Boolean(deliveryLine), "delivery line");
assert(serviceLine!.tax === 0, `service tax ${serviceLine!.tax}`);
assert(deliveryLine!.tax === 0, `delivery tax ${deliveryLine!.tax}`);
assert(built.lines[0]!.tax === built.taxAmountPkr, "all tax on food");
assert(built.taxAmountPkr === 42, `scaled food tax ${built.taxAmountPkr}`); // round(45*280/302)=42
assert(built.taxableAmountPkr + built.taxAmountPkr + 22 + 50 === 394, "net total");

const allocated = allocateLineTaxes(
  [
    { description: "A", qty: 1, amount: 100, tax: 0 },
    { description: "B", qty: 1, amount: 100, tax: 0 },
  ],
  7,
);
assert(allocated.reduce((s, l) => s + l.tax, 0) === 7, "alloc");

console.log("OK", {
  ItemName: built.lines[0]!.description,
  FoodTax: built.lines[0]!.tax,
  ServiceTax: serviceLine!.tax,
  DeliveryTax: deliveryLine!.tax,
  Gross: built.taxableAmountPkr,
  ST: built.taxAmountPkr,
});
