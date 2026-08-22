import type { PharmacySaleUnit } from "./pharmacy";

export type MedicinePackInfo = {
  sellingPrice: number;
  tabletsPerStrip: number;
  stripsPerBox: number;
  currentStock: number;
};

export function supportsStripSale(med: MedicinePackInfo): boolean {
  return med.tabletsPerStrip > 1;
}

export function saleQtyToTablets(med: MedicinePackInfo, saleUnit: PharmacySaleUnit, qty: number): number {
  const tps = Math.max(med.tabletsPerStrip, 1);
  const spb = Math.max(med.stripsPerBox, 1);
  switch (saleUnit) {
    case "tablet":
      return qty;
    case "strip":
      return qty * tps;
    case "box":
      return qty * tps * spb;
    default:
      return qty;
  }
}

export function computeLinePrice(med: MedicinePackInfo, saleUnit: PharmacySaleUnit, qty: number): number {
  const tps = Math.max(med.tabletsPerStrip, 1);
  const spb = Math.max(med.stripsPerBox, 1);
  const stripPrice = med.sellingPrice;
  switch (saleUnit) {
    case "tablet":
      return Math.round((stripPrice / tps) * qty);
    case "strip":
      return stripPrice * qty;
    case "box":
      return stripPrice * spb * qty;
    default:
      return stripPrice * qty;
  }
}

export function formatMedicineLocation(med: {
  aisleLocation?: string | null;
  rackLocation?: string | null;
  shelfLocation?: string | null;
}): string | null {
  const parts = [med.aisleLocation, med.rackLocation, med.shelfLocation].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function formatStockLabel(med: MedicinePackInfo): string {
  if (!supportsStripSale(med)) return `${med.currentStock} ${med.currentStock === 1 ? "unit" : "units"}`;
  const strips = Math.floor(med.currentStock / med.tabletsPerStrip);
  return `${med.currentStock} tablets (${strips} strips)`;
}

export function saleUnitLabel(unit: PharmacySaleUnit, qty: number): string {
  const labels: Record<PharmacySaleUnit, string> = {
    tablet: qty === 1 ? "tablet" : "tablets",
    strip: qty === 1 ? "strip" : "strips",
    box: qty === 1 ? "box" : "boxes",
    piece: qty === 1 ? "piece" : "pieces",
  };
  return `${qty} ${labels[unit]}`;
}
