import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PharmacySalesQuoteInput } from "@platform/contracts";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  pharmacyMedicines,
  pharmacyPriceListItems,
  pharmacyPriceLists,
  pharmacySchemes,
  pharmacyTradeCustomers,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";

export type ResolvedScheme = {
  freeQuantity: number;
  schemeId: string | null;
  schemeLabel: string | null;
  priority: number | null;
};

/**
 * Dist Sale Window pricing + schemes.
 *
 * Owns resolvePrice / resolveSchemeFreeQty so PharmacyErpService can inject this
 * service without a circular dependency (Sales services never inject Erp).
 */
@Injectable()
export class SalesPricingService {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  /**
   * Priority: customer price list → area → customer type → wholesale/dealer on medicine → retail sellingPrice
   */
  async resolvePrice(
    organizationId: string,
    medicineId: string,
    opts: { tradeCustomerId?: string; priceLevel?: string; qty?: number } = {},
  ) {
    const qty = Math.max(1, Math.round(opts.qty ?? 1));
    const [medicine] = await this.db
      .select()
      .from(pharmacyMedicines)
      .where(
        and(eq(pharmacyMedicines.id, medicineId), eq(pharmacyMedicines.organizationId, organizationId)),
      )
      .limit(1);
    if (!medicine) throw new NotFoundException("Medicine not found");

    let customer: typeof pharmacyTradeCustomers.$inferSelect | undefined;
    if (opts.tradeCustomerId) {
      const [c] = await this.db
        .select()
        .from(pharmacyTradeCustomers)
        .where(
          and(
            eq(pharmacyTradeCustomers.id, opts.tradeCustomerId),
            eq(pharmacyTradeCustomers.organizationId, organizationId),
          ),
        )
        .limit(1);
      customer = c;
    }

    const priceLevel = opts.priceLevel ?? customer?.priceLevel ?? "retail";

    const tryList = async (extra: Parameters<typeof and>[0], source: string) => {
      const lists = await this.db
        .select()
        .from(pharmacyPriceLists)
        .where(
          and(
            eq(pharmacyPriceLists.organizationId, organizationId),
            eq(pharmacyPriceLists.status, "active"),
            extra,
          ),
        );
      for (const list of lists) {
        const [item] = await this.db
          .select()
          .from(pharmacyPriceListItems)
          .where(
            and(
              eq(pharmacyPriceListItems.priceListId, list.id),
              eq(pharmacyPriceListItems.medicineId, medicineId),
              sql`${pharmacyPriceListItems.minQty} <= ${qty}`,
            ),
          )
          .orderBy(desc(pharmacyPriceListItems.minQty))
          .limit(1);
        if (item) {
          return {
            medicineId,
            unitPricePkr: item.unitPricePkr,
            source,
            priceListId: list.id,
          };
        }
      }
      return null;
    };

    if (customer) {
      const byCustomer = await tryList(eq(pharmacyPriceLists.tradeCustomerId, customer.id), "customer_price_list");
      if (byCustomer) return byCustomer;

      if (customer.areaId) {
        const byArea = await tryList(eq(pharmacyPriceLists.areaId, customer.areaId), "area_price_list");
        if (byArea) return byArea;
      }

      if (customer.customerType) {
        const byType = await tryList(
          eq(pharmacyPriceLists.customerType, customer.customerType),
          "customer_type_price_list",
        );
        if (byType) return byType;
      }
    }

    const byLevel = await tryList(eq(pharmacyPriceLists.priceLevel, priceLevel), "price_level_list");
    if (byLevel) return byLevel;

    if (priceLevel === "wholesale" && medicine.wholesalePricePkr > 0) {
      return {
        medicineId,
        unitPricePkr: medicine.wholesalePricePkr,
        source: "medicine_wholesale",
        priceListId: null as string | null,
      };
    }
    if (priceLevel === "dealer" && medicine.dealerPricePkr > 0) {
      return {
        medicineId,
        unitPricePkr: medicine.dealerPricePkr,
        source: "medicine_dealer",
        priceListId: null as string | null,
      };
    }
    if (medicine.wholesalePricePkr > 0 && (priceLevel === "wholesale" || customer?.customerType === "Wholesaler")) {
      return {
        medicineId,
        unitPricePkr: medicine.wholesalePricePkr,
        source: "medicine_wholesale",
        priceListId: null as string | null,
      };
    }
    if (medicine.dealerPricePkr > 0 && (priceLevel === "dealer" || customer?.customerType === "Dealer")) {
      return {
        medicineId,
        unitPricePkr: medicine.dealerPricePkr,
        source: "medicine_dealer",
        priceListId: null as string | null,
      };
    }

    return {
      medicineId,
      unitPricePkr: medicine.sellingPricePkr,
      source: "retail_selling_price",
      priceListId: null as string | null,
    };
  }

  /**
   * Buy X Get Y free qty from active schemes.
   *
   * Conflict policy: prefer `pharmacy_schemes.priority` ASC (lower number =
   * higher priority). When priorities are equal, take the scheme that yields
   * the maximum free quantity as the tie-break.
   */
  async resolveSchemeDetail(
    organizationId: string,
    medicineId: string,
    buyQty: number,
  ): Promise<ResolvedScheme> {
    const qty = Math.max(0, Math.round(buyQty));
    if (qty <= 0) {
      return { freeQuantity: 0, schemeId: null, schemeLabel: null, priority: null };
    }
    const [med] = await this.db
      .select()
      .from(pharmacyMedicines)
      .where(and(eq(pharmacyMedicines.id, medicineId), eq(pharmacyMedicines.organizationId, organizationId)))
      .limit(1);
    const today = new Date().toISOString().slice(0, 10);
    const schemes = await this.db
      .select()
      .from(pharmacySchemes)
      .where(and(eq(pharmacySchemes.organizationId, organizationId), eq(pharmacySchemes.status, "active")));

    type Candidate = { free: number; schemeId: string; label: string; priority: number };
    const matches: Candidate[] = [];
    for (const s of schemes) {
      if (s.startDate && s.startDate > today) continue;
      if (s.endDate && s.endDate < today) continue;
      if (s.medicineId && s.medicineId !== medicineId) continue;
      if (s.companyId && med?.companyId && s.companyId !== med.companyId) continue;
      if (s.companyId && !med?.companyId) continue;
      if (!s.buyQty || s.buyQty <= 0 || !s.freeQty) continue;
      const multiples = Math.floor(qty / s.buyQty);
      if (multiples <= 0) continue;
      matches.push({
        free: multiples * s.freeQty,
        schemeId: s.id,
        label: s.name,
        priority: s.priority ?? 0,
      });
    }
    if (!matches.length) {
      return { freeQuantity: 0, schemeId: null, schemeLabel: null, priority: null };
    }
    matches.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.free - a.free;
    });
    const best = matches[0]!;
    return {
      freeQuantity: best.free,
      schemeId: best.schemeId,
      schemeLabel: best.label,
      priority: best.priority,
    };
  }

  async resolveSchemeFreeQty(organizationId: string, medicineId: string, buyQty: number): Promise<number> {
    const detail = await this.resolveSchemeDetail(organizationId, medicineId, buyQty);
    return detail.freeQuantity;
  }

  async quoteCart(organizationId: string, input: PharmacySalesQuoteInput) {
    const [customer] = await this.db
      .select()
      .from(pharmacyTradeCustomers)
      .where(
        and(
          eq(pharmacyTradeCustomers.id, input.tradeCustomerId),
          eq(pharmacyTradeCustomers.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!customer) throw new NotFoundException("Trade customer not found");

    let subtotal = 0;
    let lineDiscountTotal = 0;
    const schemeSummary: { schemeId: string; schemeLabel: string; freeQuantity: number; medicineId: string }[] =
      [];

    const lines = [] as {
      medicineId: string;
      paidQty: number;
      unitPricePkr: number;
      priceSource: string;
      priceListId: string | null;
      freeQuantity: number;
      schemeLabel: string | null;
      discountPkr: number;
      lineTotalPkr: number;
    }[];

    for (const line of input.lines) {
      const qty = Math.round(line.quantity);
      const resolved =
        line.unitPricePkr != null
          ? {
              unitPricePkr: Math.round(line.unitPricePkr),
              source: "override",
              priceListId: null as string | null,
            }
          : await this.resolvePrice(organizationId, line.medicineId, {
              tradeCustomerId: customer.id,
              priceLevel: customer.priceLevel,
              qty,
            });

      const scheme = await this.resolveSchemeDetail(organizationId, line.medicineId, qty);
      const freeQuantity = Math.round(line.freeQuantity ?? scheme.freeQuantity);
      const discount = Math.round(line.discountPkr ?? 0);
      const lineTotal = qty * resolved.unitPricePkr - discount;
      subtotal += lineTotal;
      lineDiscountTotal += discount;

      if (scheme.schemeId && freeQuantity > 0) {
        schemeSummary.push({
          schemeId: scheme.schemeId,
          schemeLabel: scheme.schemeLabel ?? "Scheme",
          freeQuantity,
          medicineId: line.medicineId,
        });
      }

      lines.push({
        medicineId: line.medicineId,
        paidQty: qty,
        unitPricePkr: resolved.unitPricePkr,
        priceSource: resolved.source,
        priceListId: resolved.priceListId ?? null,
        freeQuantity,
        schemeLabel: scheme.schemeLabel,
        discountPkr: discount,
        lineTotalPkr: lineTotal,
      });
    }

    const discountPkr = Math.round(input.discountPkr ?? 0);
    const taxPkr = Math.round(input.taxPkr ?? 0);
    const netPkr = subtotal - discountPkr + taxPkr;

    return {
      tradeCustomerId: customer.id,
      branchCode: input.branchCode,
      warehouseId: input.warehouseId ?? null,
      lines,
      totals: {
        subtotalPkr: subtotal,
        lineDiscountPkr: lineDiscountTotal,
        discountPkr,
        taxPkr,
        netPkr,
      },
      schemeSummary,
    };
  }
}
