import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { pharmacyTradeCustomers, type PlatformPgDb } from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";

/** Default ALLOW/WARN/BLOCK matrices — full settings table can replace later. */
const CREDIT_DEFAULTS: {
  overLimitPolicy: "block" | "warn" | "allow";
  overduePolicy: "block" | "warn" | "allow";
} = {
  overLimitPolicy: "block",
  overduePolicy: "block",
};

export type CreditEvaluation = {
  policy: "block" | "warn" | "allow";
  allowed: boolean;
  requiresOverride: boolean;
  outstandingPkr: number;
  creditLimitPkr: number;
  availableCreditPkr: number;
  overdueAmountPkr: number;
  projectedOutstanding: number;
  message: string;
  overduePolicy: "block" | "warn" | "allow";
};

@Injectable()
export class SalesCreditService {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  /**
   * Evaluate whether a proposed sale total can proceed under the customer's credit limit.
   * Default: block when limit > 0 and outstanding + sale > limit.
   * Override requires a non-empty reason — never silently allow.
   */
  async evaluate(
    organizationId: string,
    tradeCustomerId: string,
    saleTotalPkr: number,
    opts?: { creditOverride?: boolean; overrideReason?: string },
  ): Promise<CreditEvaluation> {
    const [customer] = await this.db
      .select()
      .from(pharmacyTradeCustomers)
      .where(
        and(
          eq(pharmacyTradeCustomers.id, tradeCustomerId),
          eq(pharmacyTradeCustomers.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!customer) throw new NotFoundException("Trade customer not found");

    const outstandingPkr = customer.outstandingPkr;
    const creditLimitPkr = customer.creditLimitPkr;
    const sale = Math.max(0, Math.round(saleTotalPkr));
    const projectedOutstanding = outstandingPkr + sale;
    const availableCreditPkr = creditLimitPkr > 0 ? Math.max(0, creditLimitPkr - outstandingPkr) : Number.MAX_SAFE_INTEGER;
    // Aging ledger not wired yet — best-effort placeholder.
    const overdueAmountPkr = 0;
    const overduePolicy = CREDIT_DEFAULTS.overduePolicy;

    const overLimit = creditLimitPkr > 0 && projectedOutstanding > creditLimitPkr;
    const policy = CREDIT_DEFAULTS.overLimitPolicy;

    if (!overLimit) {
      return {
        policy: "allow",
        allowed: true,
        requiresOverride: false,
        outstandingPkr,
        creditLimitPkr,
        availableCreditPkr: creditLimitPkr > 0 ? availableCreditPkr : creditLimitPkr,
        overdueAmountPkr,
        projectedOutstanding,
        message: "Within credit limit",
        overduePolicy,
      };
    }

    const wantsOverride = Boolean(opts?.creditOverride);
    if (wantsOverride) {
      const reason = opts?.overrideReason?.trim() ?? "";
      if (!reason) {
        throw new BadRequestException(
          "creditOverrideReason is required when creditOverride is true — credit override cannot be silent",
        );
      }
      return {
        policy: "block",
        allowed: true,
        requiresOverride: true,
        outstandingPkr,
        creditLimitPkr,
        availableCreditPkr,
        overdueAmountPkr,
        projectedOutstanding,
        message: `Credit limit override applied: ${reason}`,
        overduePolicy,
      };
    }

    if (policy === "warn") {
      return {
        policy: "warn",
        allowed: true,
        requiresOverride: false,
        outstandingPkr,
        creditLimitPkr,
        availableCreditPkr,
        overdueAmountPkr,
        projectedOutstanding,
        message: `Credit limit warning (outstanding ${outstandingPkr} + sale ${sale} > limit ${creditLimitPkr})`,
        overduePolicy,
      };
    }

    return {
      policy: "block",
      allowed: false,
      requiresOverride: true,
      outstandingPkr,
      creditLimitPkr,
      availableCreditPkr,
      overdueAmountPkr,
      projectedOutstanding,
      message: `Credit limit exceeded (outstanding ${outstandingPkr} + order ${sale} > limit ${creditLimitPkr})`,
      overduePolicy,
    };
  }
}
