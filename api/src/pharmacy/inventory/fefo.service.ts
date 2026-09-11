import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import {
  pharmacyMedicineBatches,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import type { StockTx } from "../pharmacy-stock.engine";

export type FefoAllocation = {
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  warehouseId: string | null;
  quantity: number;
  unitCostPkr: number;
  /** True when an operator-chosen batch was honoured ahead of FEFO order. */
  overridden: boolean;
};

export type FefoPlan = {
  requested: number;
  allocated: number;
  /** requested - allocated. Greater than zero means the line cannot be fulfilled. */
  shortfall: number;
  allocations: FefoAllocation[];
  /** Batches skipped and why — surfaced so operators are never left guessing. */
  excluded: { batchId: string; batchNumber: string; quantity: number; reason: string }[];
};

export type FefoPlanInput = {
  organizationId: string;
  branchId: string;
  medicineId: string;
  qty: number;
  warehouseId?: string | null;
  preferredBatchId?: string | null;
  /** Policy from InventorySettings.blockExpiredSale (inverted). */
  allowExpired?: boolean;
  /** Lock rows for update. Required when the plan will be executed. */
  lock?: boolean;
};

/** `YYYY-MM-DD` in UTC — batch expiry is a date column, not a timestamp. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * First-Expiry-First-Out allocation.
 *
 * This is a genuine FEFO implementation, not "oldest purchase batch":
 * candidates are ordered by the earliest *valid* expiry date, and stock that is
 * expired, on hold, or sitting in a non-available state is excluded outright.
 */
@Injectable()
export class FefoService {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  /**
   * Candidate batches in strict FEFO order.
   *
   * Legacy batches with a NULL warehouse are still visible to every warehouse in
   * the branch — the pre-Phase-4 data has NULLs and hiding them would make real
   * stock vanish. They are reported by the data-quality tool instead.
   */
  private async candidates(tx: StockTx, input: FefoPlanInput) {
    const clauses: SQL[] = [
      eq(pharmacyMedicineBatches.medicineId, input.medicineId),
      sql`${pharmacyMedicineBatches.quantity} > 0`,
    ];
    if (input.warehouseId) {
      clauses.push(
        sql`(${pharmacyMedicineBatches.warehouseId} = ${input.warehouseId} OR ${pharmacyMedicineBatches.warehouseId} IS NULL)`,
      );
    }

    const query = tx
      .select()
      .from(pharmacyMedicineBatches)
      .where(and(...clauses))
      .orderBy(asc(pharmacyMedicineBatches.expiryDate), asc(pharmacyMedicineBatches.createdAt));

    // Row locks serialise concurrent allocations on the same batch, which is the
    // only way to stop two simultaneous sales overselling the same units.
    return input.lock ? await query.for("update") : await query;
  }

  /**
   * A batch is allocatable only when it is active and unexpired.
   * `status` values other than `active` mean a manual hold (blocked, quarantine,
   * recalled) and must never be picked automatically.
   */
  private exclusionReason(
    batch: typeof pharmacyMedicineBatches.$inferSelect,
    allowExpired: boolean,
  ): string | null {
    const status = (batch.status ?? "active").toLowerCase();
    if (status !== "active") return `batch on hold (${status})`;
    if (!allowExpired && batch.expiryDate && batch.expiryDate < today()) return "expired";
    return null;
  }

  async plan(input: FefoPlanInput, tx: StockTx = this.db): Promise<FefoPlan> {
    const requested = Math.max(0, Math.floor(input.qty));
    const plan: FefoPlan = {
      requested,
      allocated: 0,
      shortfall: requested,
      allocations: [],
      excluded: [],
    };
    if (requested <= 0) {
      plan.shortfall = 0;
      return plan;
    }

    const allowExpired = input.allowExpired ?? false;
    const rows = await this.candidates(tx, input);

    let remaining = requested;

    // An explicit operator choice is honoured first, then FEFO covers the rest.
    // Partial cover is allowed so a valid override can never fail a whole line.
    if (input.preferredBatchId) {
      const preferred = rows.find((b) => b.id === input.preferredBatchId);
      if (preferred) {
        const reason = this.exclusionReason(preferred, allowExpired);
        if (reason) {
          plan.excluded.push({
            batchId: preferred.id,
            batchNumber: preferred.batchNumber,
            quantity: preferred.quantity,
            reason: `selected batch ${reason}`,
          });
        } else {
          const take = Math.min(preferred.quantity, remaining);
          if (take > 0) {
            plan.allocations.push({
              batchId: preferred.id,
              batchNumber: preferred.batchNumber,
              expiryDate: preferred.expiryDate,
              warehouseId: preferred.warehouseId ?? null,
              quantity: take,
              unitCostPkr: preferred.purchaseRatePkr ?? 0,
              overridden: true,
            });
            remaining -= take;
          }
        }
      }
    }

    for (const batch of rows) {
      if (remaining <= 0) break;
      if (plan.allocations.some((a) => a.batchId === batch.id)) continue;
      const reason = this.exclusionReason(batch, allowExpired);
      if (reason) {
        plan.excluded.push({
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          quantity: batch.quantity,
          reason,
        });
        continue;
      }
      const take = Math.min(batch.quantity, remaining);
      if (take <= 0) continue;
      plan.allocations.push({
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        warehouseId: batch.warehouseId ?? null,
        quantity: take,
        unitCostPkr: batch.purchaseRatePkr ?? 0,
        overridden: false,
      });
      remaining -= take;
    }

    plan.allocated = requested - remaining;
    plan.shortfall = remaining;
    return plan;
  }
}
