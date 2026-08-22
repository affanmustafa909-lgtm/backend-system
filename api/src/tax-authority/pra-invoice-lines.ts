/** Pure helpers for Real PRA / FBR line mapping from POS bills. */

export type PraSourceLine = {
  description: string;
  qty: number;
  /** Amount excluding sales tax (PKR). */
  amount: number;
  /** Allocated sales tax for this line (PKR). */
  tax: number;
};

/**
 * Parse bill / sale line JSON. POS restaurant bills use `label` (not name/description).
 */
export function parsePraSourceLines(raw: string | null | undefined): PraSourceLine[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((line, idx) => {
      const row = (line ?? {}) as Record<string, unknown>;
      const qtyRaw = Number(row.qty ?? row.quantity ?? 1);
      const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
      const unit = Number(row.unitPrice ?? 0);
      const explicitAmount = Number(
        row.amount ?? row.lineTotal ?? row.lineTotalPkr ?? row.total ?? 0,
      );
      const amount =
        Number.isFinite(unit) && unit > 0
          ? Math.round(unit * qty)
          : Number.isFinite(explicitAmount)
            ? Math.round(explicitAmount)
            : 0;
      const taxRaw = Number(row.tax ?? row.taxPkr ?? row.TaxCharged ?? 0);
      const description = String(
        row.label ?? row.name ?? row.description ?? row.ItemName ?? `Item ${idx + 1}`,
      )
        .trim()
        .slice(0, 100);
      return {
        description: description || `Item ${idx + 1}`,
        qty,
        amount: Math.max(0, amount),
        tax: Number.isFinite(taxRaw) ? Math.max(0, Math.round(taxRaw)) : 0,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Scale food line amounts so they sum to `targetTotal` (e.g. after bill-level discount).
 */
export function scaleLineAmountsToTotal(
  lines: PraSourceLine[],
  targetTotal: number,
): PraSourceLine[] {
  if (lines.length === 0) return lines;
  const target = Math.max(0, Math.round(targetTotal));
  const sum = lines.reduce((s, l) => s + Math.max(0, l.amount), 0);
  if (sum <= 0 || target === sum) return lines.map((l) => ({ ...l }));
  let allocated = 0;
  return lines.map((line, idx) => {
    if (idx === lines.length - 1) {
      return { ...line, amount: Math.max(0, target - allocated) };
    }
    const share = Math.round((Math.max(0, line.amount) / sum) * target);
    allocated += share;
    return { ...line, amount: share };
  });
}

/**
 * Apportion bill-level sales tax across lines by amount share.
 * Lines listed in `zeroTaxIndexes` keep TaxCharged = 0 (e.g. untaxed delivery).
 */
export function allocateLineTaxes(
  lines: PraSourceLine[],
  totalTax: number,
  zeroTaxIndexes: Set<number> = new Set(),
): PraSourceLine[] {
  if (lines.length === 0) return lines;
  const taxTotal = Math.max(0, Math.round(totalTax));
  const taxableIndexes = lines
    .map((line, idx) => ({ line, idx }))
    .filter(({ idx, line }) => !zeroTaxIndexes.has(idx) && line.amount > 0);
  const sumTaxable = taxableIndexes.reduce((s, { line }) => s + line.amount, 0);

  if (taxTotal <= 0 || sumTaxable <= 0 || taxableIndexes.length === 0) {
    return lines.map((line, idx) =>
      zeroTaxIndexes.has(idx) ? { ...line, tax: 0 } : { ...line, tax: line.tax || 0 },
    );
  }

  // Keep existing allocation if it already matches (±1 PKR).
  const existing = taxableIndexes.reduce((s, { line }) => s + (line.tax || 0), 0);
  if (existing > 0 && Math.abs(existing - taxTotal) <= 1) {
    return lines.map((line, idx) =>
      zeroTaxIndexes.has(idx) ? { ...line, tax: 0 } : { ...line },
    );
  }

  let allocated = 0;
  const taxByIndex = new Map<number, number>();
  taxableIndexes.forEach(({ line, idx }, i) => {
    if (i === taxableIndexes.length - 1) {
      taxByIndex.set(idx, Math.max(0, taxTotal - allocated));
      return;
    }
    const share = Math.round((line.amount / sumTaxable) * taxTotal);
    allocated += share;
    taxByIndex.set(idx, share);
  });

  return lines.map((line, idx) => ({
    ...line,
    tax: zeroTaxIndexes.has(idx) ? 0 : (taxByIndex.get(idx) ?? 0),
  }));
}

/**
 * Build restaurant bill lines for PRA: real item names, discount applied,
 * optional service / delivery rows (never taxed), tax only on food/items.
 */
export function buildBillPraSourceLines(input: {
  linesJson: string | null | undefined;
  subtotalPkr: number;
  discountPkr: number;
  servicePkr: number;
  deliveryChargePkr: number;
  taxPkr: number;
}): { lines: PraSourceLine[]; taxableAmountPkr: number; taxAmountPkr: number } {
  const afterDisc = Math.max(0, Math.round(input.subtotalPkr) - Math.round(input.discountPkr));
  const service = Math.max(0, Math.round(input.servicePkr));
  const delivery = Math.max(0, Math.round(input.deliveryChargePkr));
  const billTax = Math.max(0, Math.round(input.taxPkr));

  let food = parsePraSourceLines(input.linesJson);
  if (food.length === 0 && afterDisc > 0) {
    food = [{ description: "Sale", qty: 1, amount: afterDisc, tax: 0 }];
  } else if (food.length > 0 && afterDisc !== food.reduce((s, l) => s + l.amount, 0)) {
    food = scaleLineAmountsToTotal(food, afterDisc);
  }

  const lines: PraSourceLine[] = [...food];
  const zeroTax = new Set<number>();

  // Service + delivery are untaxed fee lines (PRA + business rule).
  if (service > 0) {
    zeroTax.add(lines.length);
    lines.push({ description: "Service charges", qty: 1, amount: service, tax: 0 });
  }
  if (delivery > 0) {
    zeroTax.add(lines.length);
    lines.push({ description: "Delivery charges", qty: 1, amount: delivery, tax: 0 });
  }

  // Tax base is food/items only — never service or delivery.
  const taxableAmountPkr = afterDisc;
  // Older POS bills may still store tax that included service; strip that portion.
  const legacyTaxBase = afterDisc + service;
  const taxForItems =
    service > 0 && legacyTaxBase > 0 && afterDisc > 0
      ? Math.round((billTax * afterDisc) / legacyTaxBase)
      : billTax;

  const priced = allocateLineTaxes(lines, taxForItems, zeroTax);
  const taxAmountPkr = priced.reduce((s, l) => s + Math.max(0, l.tax), 0);
  return {
    lines: priced,
    taxableAmountPkr,
    taxAmountPkr,
  };
}

/** Allocate store-sale tax across product lines (names already resolved). */
export function withAllocatedStoreLineTaxes(
  lines: PraSourceLine[],
  taxPkr: number,
): PraSourceLine[] {
  return allocateLineTaxes(lines, taxPkr);
}
