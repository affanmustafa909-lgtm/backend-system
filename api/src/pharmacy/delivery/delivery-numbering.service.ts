import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import {
  pharmacyCollections,
  pharmacyDeliveries,
  pharmacyPromisesToPay,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";

export type DeliveryDocumentKind = "delivery" | "collection" | "promise";

const PREFIX: Record<DeliveryDocumentKind, string> = {
  delivery: "DLV",
  collection: "COL",
  promise: "PTP",
};

type StockTx = PlatformPgDb;

/**
 * Sequential DLV/COL/PTP numbering with unique-index retry.
 * Replaces legacy PharmacyErpService.nextRef(Date.now) for Phase 7 documents.
 */
@Injectable()
export class DeliveryNumberingService {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  private yearPart() {
    return String(new Date().getUTCFullYear());
  }

  private tableMeta(kind: DeliveryDocumentKind) {
    switch (kind) {
      case "delivery":
        return {
          table: pharmacyDeliveries,
          column: pharmacyDeliveries.deliveryNumber,
          org: pharmacyDeliveries.organizationId,
        };
      case "collection":
        return {
          table: pharmacyCollections,
          column: pharmacyCollections.collectionNumber,
          org: pharmacyCollections.organizationId,
        };
      case "promise":
        return {
          table: pharmacyPromisesToPay,
          column: pharmacyPromisesToPay.promiseNumber,
          org: pharmacyPromisesToPay.organizationId,
        };
    }
  }

  private async currentMax(
    organizationId: string,
    kind: DeliveryDocumentKind,
    prefix: string,
    tx: StockTx,
  ) {
    const { table, column, org } = this.tableMeta(kind);
    const pattern = `${prefix}-%`;
    const [row] = await tx
      .select({
        maxSeq: sql<number>`coalesce(max(nullif(regexp_replace(${column}, '^.*-', ''), '')::bigint), 0)`,
      })
      .from(table)
      .where(and(eq(org, organizationId), sql`${column} like ${pattern}`));
    return Number(row?.maxSeq ?? 0);
  }

  async next(
    organizationId: string,
    kind: DeliveryDocumentKind,
    attempt = 0,
    tx: StockTx = this.db,
  ): Promise<string> {
    const prefix = `${PREFIX[kind]}-${this.yearPart()}`;
    const max = await this.currentMax(organizationId, kind, prefix, tx);
    const seq = max + 1 + attempt;
    return `${prefix}-${String(seq).padStart(5, "0")}`;
  }

  async withNumber<T>(
    organizationId: string,
    kind: DeliveryDocumentKind,
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
          message.includes("_uq") ||
          (typeof err === "object" && err !== null && (err as { code?: string }).code === "23505");
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
