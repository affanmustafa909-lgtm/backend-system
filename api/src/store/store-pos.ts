import type { StorePromotionType } from "@platform/contracts";
import { computeWeighedLinePrice, kgToGrams } from "@platform/contracts";

export type SaleLineInput = {
  productId: string;
  qty: number;
  qtyGrams?: number;
};

export type ResolvedSaleLine = {
  productId: string;
  qtyUnits: number;
  isWeighed: boolean;
};

export type PricedSaleLine = ResolvedSaleLine & {
  unitPrice: number;
  lineSubtotal: number;
  lineTax: number;
  lineTotal: number;
  productName: string;
  sku: string;
  qtyLabel: string;
};

export type PromotionConfig = {
  percent?: number;
  buyQty?: number;
  getQty?: number;
  bundlePrice?: number;
  anyQty?: number;
  fixedPrice?: number;
  triggerProductId?: string;
  targetProductId?: string;
  categoryId?: string;
};

export function resolveSaleLineQty(isWeighed: boolean, line: SaleLineInput): ResolvedSaleLine {
  if (isWeighed) {
    const grams = line.qtyGrams ?? kgToGrams(line.qty);
    return { productId: line.productId, qtyUnits: Math.max(1, Math.round(grams)), isWeighed: true };
  }
  return { productId: line.productId, qtyUnits: Math.max(1, Math.round(line.qty)), isWeighed: false };
}

export function priceSaleLine(
  product: { name: string; sku: string; sellingPricePkr: number; taxPct: number; isWeighed: boolean },
  line: ResolvedSaleLine,
): PricedSaleLine {
  const lineSubtotal = product.isWeighed
    ? computeWeighedLinePrice(product.sellingPricePkr, line.qtyUnits)
    : product.sellingPricePkr * line.qtyUnits;
  const lineTax = Math.round((lineSubtotal * product.taxPct) / 100);
  const qtyLabel = product.isWeighed ? `${(line.qtyUnits / 1000).toFixed(3)} kg` : String(line.qtyUnits);
  return {
    ...line,
    unitPrice: product.sellingPricePkr,
    lineSubtotal,
    lineTax,
    lineTotal: lineSubtotal + lineTax,
    productName: product.name,
    sku: product.sku,
    qtyLabel,
  };
}

export function applyStorePromotions(
  pricedLines: PricedSaleLine[],
  promotions: Array<{
    type: StorePromotionType;
    productIds: string[];
    config: PromotionConfig;
    isActive: boolean;
  }>,
): number {
  let discount = 0;
  const now = Date.now();

  for (const promo of promotions) {
    if (!promo.isActive) continue;

    const productSet = new Set(promo.productIds);
    const matching = pricedLines.filter((l) => productSet.size === 0 || productSet.has(l.productId));
    if (matching.length === 0) continue;

    switch (promo.type) {
      case "percent_off": {
        const pct = promo.config.percent ?? 0;
        if (pct <= 0) break;
        discount += matching.reduce((s, l) => s + Math.round((l.lineSubtotal * pct) / 100), 0);
        break;
      }
      case "buy_x_get_y": {
        const buyQty = promo.config.buyQty ?? 2;
        const getQty = promo.config.getQty ?? 1;
        for (const line of matching) {
          if (line.isWeighed) continue;
          const freeUnits = Math.floor(line.qtyUnits / (buyQty + getQty)) * getQty;
          if (freeUnits > 0) discount += freeUnits * line.unitPrice;
        }
        break;
      }
      case "fixed_bundle": {
        const bundlePrice = promo.config.bundlePrice ?? 0;
        const ids = promo.productIds;
        if (ids.length < 2 || bundlePrice <= 0) break;
        const haveAll = ids.every((id) => pricedLines.some((l) => l.productId === id));
        if (!haveAll) break;
        const bundleSubtotal = ids.reduce((s, id) => {
          const line = pricedLines.find((l) => l.productId === id);
          return s + (line?.lineSubtotal ?? 0);
        }, 0);
        if (bundleSubtotal > bundlePrice) discount += bundleSubtotal - bundlePrice;
        break;
      }
      case "mix_match": {
        const anyQty = promo.config.anyQty ?? 3;
        const fixedPrice = promo.config.fixedPrice ?? 0;
        if (anyQty <= 0 || fixedPrice <= 0) break;
        const units = matching.filter((l) => !l.isWeighed).reduce((s, l) => s + l.qtyUnits, 0);
        const sets = Math.floor(units / anyQty);
        if (sets <= 0) break;
        const topUnits = matching
          .filter((l) => !l.isWeighed)
          .flatMap((l) => Array.from({ length: l.qtyUnits }, () => l.unitPrice))
          .sort((a, b) => b - a)
          .slice(0, sets * anyQty);
        const regular = topUnits.reduce((s, p) => s + p, 0);
        const promoTotal = sets * fixedPrice;
        if (regular > promoTotal) discount += regular - promoTotal;
        break;
      }
      case "cross_sell": {
        const triggerId = promo.config.triggerProductId as string | undefined;
        const targetId = promo.config.targetProductId as string | undefined;
        const pct = (promo.config.percent as number) ?? 0;
        if (!triggerId || !targetId || pct <= 0) break;
        const hasTrigger = pricedLines.some((l) => l.productId === triggerId);
        if (!hasTrigger) break;
        const target = pricedLines.find((l) => l.productId === targetId);
        if (target) discount += Math.round((target.lineSubtotal * pct) / 100);
        break;
      }
      case "category_off": {
        const pct = promo.config.percent ?? 0;
        const categoryId = promo.config.categoryId as string | undefined;
        if (pct <= 0 || !categoryId) break;
        void categoryId;
        discount += matching.reduce((s, l) => s + Math.round((l.lineSubtotal * pct) / 100), 0);
        break;
      }
      default:
        break;
    }
  }

  void now;
  return discount;
}

export function loyaltyPointsForTotal(totalPkr: number): number {
  return Math.floor(totalPkr / 100);
}

export function loyaltyRedeemValuePkr(points: number): number {
  return points;
}
