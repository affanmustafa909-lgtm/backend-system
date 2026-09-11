import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, eq, sql, type SQL } from "drizzle-orm";
import {
  pharmacyGrns,
  pharmacyPurchaseOrderLines,
  pharmacyPurchaseOrders,
  pharmacyPurchaseReturns,
  popsBranches,
  popsSuppliers,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";

/**
 * Supplier performance aggregates from real PO / GRN / return documents.
 *
 * Formulas (documented — no invented composite scores):
 * - orderCount: count of POs for supplier
 * - receivedCount: count of GRNs for supplier
 * - onTimeRate: GRNs where receivedDate <= PO.expectedDate / GRNs linked to PO with expectedDate
 * - fillRate: sum(line receivedQty) / sum(line quantity+free) across POs (0–1)
 * - returnRate: return totalPkr / GRN totalPkr (0–1)
 * - purchaseTotalPkr: sum of GRN totals
 */
@Injectable()
export class SupplierPerformanceService {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  private async resolveBranch(organizationId: string, branchCode?: string) {
    if (!branchCode?.trim()) return null;
    const [branch] = await this.db
      .select()
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, branchCode.trim())))
      .limit(1);
    if (!branch) throw new NotFoundException(`Branch not found: ${branchCode}`);
    return branch;
  }

  async performance(organizationId: string, supplierId: string, branchCode?: string) {
    const [supplier] = await this.db
      .select()
      .from(popsSuppliers)
      .where(and(eq(popsSuppliers.id, supplierId), eq(popsSuppliers.organizationId, organizationId)))
      .limit(1);
    if (!supplier) throw new NotFoundException("Supplier not found");

    const branch = await this.resolveBranch(organizationId, branchCode);

    const poClauses: SQL[] = [
      eq(pharmacyPurchaseOrders.organizationId, organizationId),
      eq(pharmacyPurchaseOrders.supplierId, supplierId),
    ];
    const grnClauses: SQL[] = [
      eq(pharmacyGrns.organizationId, organizationId),
      eq(pharmacyGrns.supplierId, supplierId),
    ];
    const retClauses: SQL[] = [
      eq(pharmacyPurchaseReturns.organizationId, organizationId),
      eq(pharmacyPurchaseReturns.supplierId, supplierId),
    ];
    if (branch) {
      poClauses.push(eq(pharmacyPurchaseOrders.branchId, branch.id));
      grnClauses.push(eq(pharmacyGrns.branchId, branch.id));
      retClauses.push(eq(pharmacyPurchaseReturns.branchId, branch.id));
    }

    const [orderAgg] = await this.db
      .select({ n: count() })
      .from(pharmacyPurchaseOrders)
      .where(and(...poClauses));

    const [grnAgg] = await this.db
      .select({
        n: count(),
        total: sql<number>`coalesce(sum(${pharmacyGrns.totalPkr}), 0)`,
      })
      .from(pharmacyGrns)
      .where(and(...grnClauses));

    const [retAgg] = await this.db
      .select({
        n: count(),
        total: sql<number>`coalesce(sum(${pharmacyPurchaseReturns.totalPkr}), 0)`,
      })
      .from(pharmacyPurchaseReturns)
      .where(and(...retClauses));

    const onTimeJoin: SQL[] = [
      eq(pharmacyGrns.organizationId, organizationId),
      eq(pharmacyGrns.supplierId, supplierId),
      sql`${pharmacyPurchaseOrders.expectedDate} is not null`,
    ];
    if (branch) onTimeJoin.push(eq(pharmacyGrns.branchId, branch.id));

    const [onTimeAgg] = await this.db
      .select({
        withExpected: count(),
        onTime: sql<number>`coalesce(sum(case when ${pharmacyGrns.receivedDate} <= ${pharmacyPurchaseOrders.expectedDate} then 1 else 0 end), 0)`,
      })
      .from(pharmacyGrns)
      .innerJoin(pharmacyPurchaseOrders, eq(pharmacyPurchaseOrders.id, pharmacyGrns.purchaseOrderId))
      .where(and(...onTimeJoin));

    const withExpected = Number(onTimeAgg?.withExpected ?? 0);
    const onTime = Number(onTimeAgg?.onTime ?? 0);
    const onTimeRate = withExpected > 0 ? onTime / withExpected : null;

    const fillJoin: SQL[] = [
      eq(pharmacyPurchaseOrders.organizationId, organizationId),
      eq(pharmacyPurchaseOrders.supplierId, supplierId),
    ];
    if (branch) fillJoin.push(eq(pharmacyPurchaseOrders.branchId, branch.id));

    const [fillAgg] = await this.db
      .select({
        ordered: sql<number>`coalesce(sum(${pharmacyPurchaseOrderLines.quantity} + ${pharmacyPurchaseOrderLines.freeQuantity}), 0)`,
        received: sql<number>`coalesce(sum(${pharmacyPurchaseOrderLines.receivedQty}), 0)`,
      })
      .from(pharmacyPurchaseOrderLines)
      .innerJoin(
        pharmacyPurchaseOrders,
        eq(pharmacyPurchaseOrders.id, pharmacyPurchaseOrderLines.purchaseOrderId),
      )
      .where(and(...fillJoin));

    const ordered = Number(fillAgg?.ordered ?? 0);
    const received = Number(fillAgg?.received ?? 0);
    const fillRate = ordered > 0 ? Math.min(1, received / ordered) : null;

    const purchaseTotalPkr = Number(grnAgg?.total ?? 0);
    const returnTotalPkr = Number(retAgg?.total ?? 0);
    const returnRate = purchaseTotalPkr > 0 ? returnTotalPkr / purchaseTotalPkr : null;

    return {
      supplierId,
      supplierName: supplier.name,
      orderCount: Number(orderAgg?.n ?? 0),
      receivedCount: Number(grnAgg?.n ?? 0),
      returnCount: Number(retAgg?.n ?? 0),
      purchaseTotalPkr,
      returnTotalPkr,
      onTimeRate,
      fillRate,
      returnRate,
      formulas: {
        onTimeRate: "GRNs with receivedDate <= PO.expectedDate / GRNs linked to PO with expectedDate",
        fillRate: "sum(receivedQty) / sum(quantity + freeQuantity) across PO lines",
        returnRate: "sum(return totalPkr) / sum(GRN totalPkr)",
      },
    };
  }
}
