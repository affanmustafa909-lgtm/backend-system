import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import {
  pharmacyStockAdjustments,
  pharmacyStockCounts,
  pharmacyStockTransfers,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import type { StockTx } from "../pharmacy-stock.engine";

export type InventoryDocumentKind = "transfer" | "adjustment" | "count";

const PREFIX: Record<InventoryDocumentKind, string> = {
  transfer: "TRF",
  adjustment: "ADJ",
  count: "CNT",
};

/**
 * Gap-free-ish document numbering for inventory documents.
 *
 * The existing ERP numbering helper is a timestamp stub, which can collide
 * under concurrency. Here the number is derived from the current maximum for
 * the organisation and the series is protected by a unique index on
 * `(organization_id, <number column>)`, so a lost race surfaces as a unique
 * violation and is retried rather than silently duplicating a document number.
 */
@Injectable()
export class InventoryNumberingService {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  private yearPart() {
    return String(new Date().getUTCFullYear());
  }

  /** Highest sequence already used for this kind, prefix, and year. */
  private async currentMax(organizationId: string, kind: InventoryDocumentKind, prefix: string, tx: StockTx) {
    const pattern = `${prefix}-%`;
    const column =
      kind === "transfer"
        ? pharmacyStockTransfers.transferNumber
        : kind === "adjustment"
          ? pharmacyStockAdjustments.adjustmentNumber
          : pharmacyStockCounts.countNumber;
    const table =
      kind === "transfer"
        ? pharmacyStockTransfers
        : kind === "adjustment"
          ? pharmacyStockAdjustments
          : pharmacyStockCounts;
    const orgColumn =
      kind === "transfer"
        ? pharmacyStockTransfers.organizationId
        : kind === "adjustment"
          ? pharmacyStockAdjustments.organizationId
          : pharmacyStockCounts.organizationId;

    const [row] = await tx
      .select({
        // Trailing numeric block of the document number.
        maxSeq: sql<number>`coalesce(max(nullif(regexp_replace(${column}, '^.*-', ''), '')::bigint), 0)`,
      })
      .from(table)
      .where(and(eq(orgColumn, organizationId), sql`${column} like ${pattern}`));

    return Number(row?.maxSeq ?? 0);
  }

  /**
   * Next document number. `attempt` is added to the sequence so a caller
   * retrying after a unique violation moves past the number that was taken.
   */
  async next(
    organizationId: string,
    kind: InventoryDocumentKind,
    attempt = 0,
    tx: StockTx = this.db,
  ): Promise<string> {
    const prefix = `${PREFIX[kind]}-${this.yearPart()}`;
    const max = await this.currentMax(organizationId, kind, prefix, tx);
    const seq = max + 1 + attempt;
    return `${prefix}-${String(seq).padStart(5, "0")}`;
  }

  /**
   * Runs `work` with a freshly allocated document number, retrying on unique
   * violations so two concurrent creates cannot end up with the same number.
   */
  async withNumber<T>(
    organizationId: string,
    kind: InventoryDocumentKind,
    work: (documentNumber: string) => Promise<T>,
  ): Promise<T> {
    const maxAttempts = 5;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const documentNumber = await this.next(organizationId, kind, attempt);
      try {
        return await work(documentNumber);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const isDuplicate =
          message.includes("duplicate key") ||
          message.includes("unique constraint") ||
          message.includes("_uq");
        if (!isDuplicate) throw err;
        lastError = err;
      }
    }
    throw new ConflictException(
      `Could not allocate a unique ${kind} number after ${maxAttempts} attempts. Please retry. (${
        lastError instanceof Error ? lastError.message : "unknown"
      })`,
    );
  }
}
