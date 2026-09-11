import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import {
  pharmacyGrns,
  pharmacyPurchaseInvoices,
  pharmacyPurchaseOrders,
  pharmacyPurchaseRequisitions,
  pharmacyPurchaseReturns,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";

export type PurchaseDocumentKind = "requisition" | "order" | "grn" | "invoice" | "return";

const PREFIX: Record<PurchaseDocumentKind, string> = {
  requisition: "REQ",
  order: "PO",
  grn: "GRN",
  invoice: "PINV",
  return: "PRN",
};

type StockTx = PlatformPgDb;

/**
 * Sequential-ish purchase document numbering with unique-index retry.
 * Same pattern as InventoryNumberingService — max existing + 1, retry on conflict.
 */
@Injectable()
export class PurchaseNumberingService {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  private yearPart() {
    return String(new Date().getUTCFullYear());
  }

  private tableMeta(kind: PurchaseDocumentKind) {
    switch (kind) {
      case "requisition":
        return {
          table: pharmacyPurchaseRequisitions,
          column: pharmacyPurchaseRequisitions.reqNumber,
          org: pharmacyPurchaseRequisitions.organizationId,
        };
      case "order":
        return {
          table: pharmacyPurchaseOrders,
          column: pharmacyPurchaseOrders.poNumber,
          org: pharmacyPurchaseOrders.organizationId,
        };
      case "grn":
        return {
          table: pharmacyGrns,
          column: pharmacyGrns.grnNumber,
          org: pharmacyGrns.organizationId,
        };
      case "invoice":
        return {
          table: pharmacyPurchaseInvoices,
          column: pharmacyPurchaseInvoices.invoiceNumber,
          org: pharmacyPurchaseInvoices.organizationId,
        };
      case "return":
        return {
          table: pharmacyPurchaseReturns,
          column: pharmacyPurchaseReturns.returnNumber,
          org: pharmacyPurchaseReturns.organizationId,
        };
    }
  }

  private async currentMax(
    organizationId: string,
    kind: PurchaseDocumentKind,
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
    kind: PurchaseDocumentKind,
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
    kind: PurchaseDocumentKind,
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
