import type { pharmacyMedicines } from "@platform/database-pg";

type MedicineRow = typeof pharmacyMedicines.$inferSelect;

export function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function stringifyJsonArray(values: string[] | undefined): string | null {
  if (!values?.length) return null;
  return JSON.stringify(values);
}

export function mapMedicineRow(
  m: MedicineRow,
  nearestExpiry: string | null,
): {
  id: string;
  sku: string;
  name: string;
  genericName: string | null;
  dosageStrength: string | null;
  presentation: string | null;
  brandName: string | null;
  category: string;
  manufacturer: string | null;
  barcode: string | null;
  purchasePrice: number;
  sellingPrice: number;
  taxPct: number;
  reorderLevel: number;
  suggestedReorderQty: number;
  currentStock: number;
  unit: string;
  aisleLocation: string | null;
  rackLocation: string | null;
  shelfLocation: string | null;
  tabletsPerStrip: number;
  stripsPerBox: number;
  isControlled: boolean;
  warnings: string[];
  instructions: string[];
  nearestExpiry: string | null;
} {
  return {
    id: m.id,
    sku: m.sku,
    name: m.name,
    genericName: m.genericName,
    dosageStrength: m.dosageStrength,
    presentation: m.presentation,
    brandName: m.brandName,
    category: m.category,
    manufacturer: m.manufacturer,
    barcode: m.barcode,
    purchasePrice: m.purchasePricePkr,
    sellingPrice: m.sellingPricePkr,
    taxPct: m.taxPct,
    reorderLevel: m.reorderLevel,
    suggestedReorderQty: m.suggestedReorderQty,
    currentStock: m.currentStock,
    unit: m.unit,
    aisleLocation: m.aisleLocation,
    rackLocation: m.rackLocation,
    shelfLocation: m.shelfLocation,
    tabletsPerStrip: m.tabletsPerStrip,
    stripsPerBox: m.stripsPerBox,
    isControlled: m.isControlled,
    warnings: parseJsonArray(m.warningsJson),
    instructions: parseJsonArray(m.instructionsJson),
    nearestExpiry,
  };
}

export function parsePaymentsJson(value: string | null | undefined): { method: string; amount: number }[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is { method: string; amount: number } => {
        return typeof p === "object" && p !== null && "method" in p && "amount" in p;
      })
      .map((p) => ({ method: String(p.method), amount: Math.round(Number(p.amount)) }));
  } catch {
    return [];
  }
}
