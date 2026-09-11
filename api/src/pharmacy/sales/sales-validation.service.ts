import { Inject, Injectable } from "@nestjs/common";
import type { PharmacySalesValidateInput } from "@platform/contracts";
import { and, eq } from "drizzle-orm";
import { pharmacyMedicines, pharmacyTradeCustomers, type PlatformPgDb } from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { StockAvailabilityService } from "../inventory/stock-availability.service";
import { SalesCreditService } from "./sales-credit.service";
import { SalesPricingService } from "./sales-pricing.service";

export type SaleValidationIssue = {
  line?: number;
  code: string;
  message: string;
};

@Injectable()
export class SalesValidationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly pricing: SalesPricingService,
    private readonly credit: SalesCreditService,
    private readonly availability: StockAvailabilityService,
  ) {}

  /**
   * Aggregate Sale Window pre-book checks. Business rule failures return
   * structured errors — never raw DB exceptions for those cases.
   */
  async validate(organizationId: string, _userId: string | undefined, draft: PharmacySalesValidateInput) {
    const errors: SaleValidationIssue[] = [];
    const warnings: SaleValidationIssue[] = [];

    if (!draft.tradeCustomerId) {
      errors.push({ code: "CUSTOMER_REQUIRED", message: "Trade customer is required" });
    }
    if (!draft.branchCode?.trim()) {
      errors.push({ code: "BRANCH_REQUIRED", message: "branchCode is required" });
    }
    if (!draft.lines?.length) {
      errors.push({ code: "EMPTY_CART", message: "Cart has no lines" });
    }

    if (errors.length) {
      return { valid: false, errors, warnings, quote: null, availability: null, credit: null };
    }

    const [customer] = await this.db
      .select({ id: pharmacyTradeCustomers.id, status: pharmacyTradeCustomers.status })
      .from(pharmacyTradeCustomers)
      .where(
        and(
          eq(pharmacyTradeCustomers.id, draft.tradeCustomerId),
          eq(pharmacyTradeCustomers.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!customer) {
      errors.push({ code: "CUSTOMER_REQUIRED", message: "Trade customer not found" });
      return { valid: false, errors, warnings, quote: null, availability: null, credit: null };
    }
    if (customer.status !== "active") {
      errors.push({ code: "CUSTOMER_INACTIVE", message: "Trade customer is not active" });
    }

    for (const [idx, line] of draft.lines.entries()) {
      const [med] = await this.db
        .select({ id: pharmacyMedicines.id, status: pharmacyMedicines.status, name: pharmacyMedicines.name })
        .from(pharmacyMedicines)
        .where(
          and(eq(pharmacyMedicines.id, line.medicineId), eq(pharmacyMedicines.organizationId, organizationId)),
        )
        .limit(1);
      if (!med) {
        errors.push({
          line: idx,
          code: "PRODUCT_NOT_FOUND",
          message: `Line ${idx + 1}: medicine not found`,
        });
      } else if (med.status !== "active") {
        errors.push({
          line: idx,
          code: "PRODUCT_INACTIVE",
          message: `Line ${idx + 1}: ${med.name} is inactive`,
        });
      }
    }

    let quote: Awaited<ReturnType<SalesPricingService["quoteCart"]>> | null = null;
    try {
      quote = await this.pricing.quoteCart(organizationId, draft);
      for (const [idx, line] of quote.lines.entries()) {
        if (line.unitPricePkr == null || Number.isNaN(line.unitPricePkr)) {
          errors.push({
            line: idx,
            code: "PRICE_UNAVAILABLE",
            message: `Line ${idx + 1}: price could not be resolved`,
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Pricing failed";
      errors.push({ code: "PRICE_UNAVAILABLE", message: msg });
    }

    let creditResult: Awaited<ReturnType<SalesCreditService["evaluate"]>> | null = null;
    if (quote) {
      try {
        creditResult = await this.credit.evaluate(organizationId, draft.tradeCustomerId, quote.totals.netPkr, {
          creditOverride: draft.creditOverride,
          overrideReason: draft.creditOverrideReason,
        });
        if (!creditResult.allowed) {
          errors.push({ code: "CREDIT_LIMIT", message: creditResult.message });
        } else if (creditResult.policy === "warn") {
          warnings.push({ code: "CREDIT_LIMIT", message: creditResult.message });
        } else if (creditResult.requiresOverride) {
          warnings.push({ code: "CREDIT_OVERRIDE", message: creditResult.message });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Credit check failed";
        errors.push({ code: "CREDIT_LIMIT", message: msg });
      }
    }

    let availabilityResult: Awaited<ReturnType<StockAvailabilityService["checkAvailability"]>> | null = null;
    if (quote && draft.branchCode?.trim()) {
      try {
        availabilityResult = await this.availability.checkAvailability({
          organizationId,
          branchCode: draft.branchCode,
          warehouseId: draft.warehouseId,
          lines: quote.lines.map((l) => ({
            medicineId: l.medicineId,
            quantity: l.paidQty + l.freeQuantity,
          })),
        });
        for (const [idx, row] of availabilityResult.lines.entries()) {
          if (!row.fulfillable) {
            errors.push({
              line: idx,
              code: "INSUFFICIENT_STOCK",
              message:
                row.reason ??
                `Line ${idx + 1}: short by ${row.shortfall} (available ${row.availableQty}, need ${row.requestedQty})`,
            });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Stock check failed";
        if (/warehouse/i.test(msg)) {
          errors.push({ code: "WAREHOUSE_REQUIRED", message: msg });
        } else {
          errors.push({ code: "INSUFFICIENT_STOCK", message: msg });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      quote,
      availability: availabilityResult,
      credit: creditResult,
    };
  }
}
