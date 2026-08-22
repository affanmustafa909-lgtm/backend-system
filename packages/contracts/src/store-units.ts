/** Internal stock and sale qty for weighed goods are stored in grams. */
export const GRAMS_PER_KG = 1000;

export function kgToGrams(kg: number): number {
  return Math.round(kg * GRAMS_PER_KG);
}

export function gramsToKg(grams: number): number {
  return grams / GRAMS_PER_KG;
}

export function formatWeightQty(grams: number): string {
  const kg = gramsToKg(grams);
  if (kg >= 1) return `${kg.toFixed(2)} kg`;
  return `${grams} g`;
}

export function formatPricePerKg(pricePerKg: number): string {
  return `${pricePerKg.toLocaleString()} / kg`;
}

export function computeWeighedLinePrice(pricePerKg: number, qtyGrams: number): number {
  return Math.round((pricePerKg * qtyGrams) / GRAMS_PER_KG);
}

export function parseScaleWeightKg(raw: string): number | null {
  const cleaned = raw.trim().replace(/kg$/i, "").trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
