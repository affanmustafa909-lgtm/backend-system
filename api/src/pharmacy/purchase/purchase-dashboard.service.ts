import { Inject, Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { and, count, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import {
  pharmacyGrns,
  pharmacyPurchaseOrders,
  pharmacyPurchaseRequisitions,
  pharmacyPurchaseReturns,
  popsBranches,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { InventoryService } from "../inventory/inventory.service";

export type PurchaseKpi = {
  key: string;
  label: string;
  value: number;
  /** Query hint path for Dist UI click-through. */
  to: string;
};

@Injectable()
export class PurchaseDashboardService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly inventory: InventoryService,
  ) {}

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

  async getDashboard(organizationId: string, branchCode?: string): Promise<{ kpis: PurchaseKpi[] }> {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = `${today.slice(0, 7)}-01`;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const grnOrg = (extra: SQL[] = []) => {
      const c: SQL[] = [eq(pharmacyGrns.organizationId, organizationId), ...extra];
      if (branch) c.push(eq(pharmacyGrns.branchId, branch.id));
      return and(...c);
    };
    const poOrg = (extra: SQL[] = []) => {
      const c: SQL[] = [eq(pharmacyPurchaseOrders.organizationId, organizationId), ...extra];
      if (branch) c.push(eq(pharmacyPurchaseOrders.branchId, branch.id));
      return and(...c);
    };
    const reqOrg = (extra: SQL[] = []) => {
      const c: SQL[] = [eq(pharmacyPurchaseRequisitions.organizationId, organizationId), ...extra];
      if (branch) c.push(eq(pharmacyPurchaseRequisitions.branchId, branch.id));
      return and(...c);
    };
    const retOrg = () => {
      const c: SQL[] = [eq(pharmacyPurchaseReturns.organizationId, organizationId)];
      if (branch) c.push(eq(pharmacyPurchaseReturns.branchId, branch.id));
      return and(...c);
    };

    const [purchaseToday] = await this.db
      .select({ total: sql<number>`coalesce(sum(${pharmacyGrns.totalPkr}), 0)` })
      .from(pharmacyGrns)
      .where(grnOrg([eq(pharmacyGrns.receivedDate, today)]));

    const [purchaseMonth] = await this.db
      .select({ total: sql<number>`coalesce(sum(${pharmacyGrns.totalPkr}), 0)` })
      .from(pharmacyGrns)
      .where(grnOrg([gte(pharmacyGrns.receivedDate, monthStart)]));

    const [pendingReqs] = await this.db
      .select({ n: count() })
      .from(pharmacyPurchaseRequisitions)
      .where(reqOrg([inArray(pharmacyPurchaseRequisitions.status, ["draft", "submitted", "approved"])]));

    const [pendingPos] = await this.db
      .select({ n: count() })
      .from(pharmacyPurchaseOrders)
      .where(
        poOrg([
          inArray(pharmacyPurchaseOrders.status, [
            "draft",
            "submitted",
            "approved",
            "sent",
            "supplier_confirmed",
            "partial",
          ]),
        ]),
      );

    const [pendingApprovals] = await this.db
      .select({ n: count() })
      .from(pharmacyPurchaseOrders)
      .where(poOrg([eq(pharmacyPurchaseOrders.status, "submitted")]));

    const [partialPos] = await this.db
      .select({ n: count() })
      .from(pharmacyPurchaseOrders)
      .where(poOrg([eq(pharmacyPurchaseOrders.status, "partial")]));

    const [overdue] = await this.db
      .select({ n: count() })
      .from(pharmacyPurchaseOrders)
      .where(
        poOrg([
          lt(pharmacyPurchaseOrders.expectedDate, today),
          inArray(pharmacyPurchaseOrders.status, [
            "approved",
            "sent",
            "supplier_confirmed",
            "partial",
          ]),
        ]),
      );

    const [returnsCount] = await this.db
      .select({ n: count() })
      .from(pharmacyPurchaseReturns)
      .where(retOrg());

    const [grnSum] = await this.db
      .select({ total: sql<number>`coalesce(sum(${pharmacyGrns.totalPkr}), 0)` })
      .from(pharmacyGrns)
      .where(grnOrg());
    const [retSum] = await this.db
      .select({ total: sql<number>`coalesce(sum(${pharmacyPurchaseReturns.totalPkr}), 0)` })
      .from(pharmacyPurchaseReturns)
      .where(retOrg());
    const payablesEstimate = Math.max(0, Number(grnSum?.total ?? 0) - Number(retSum?.total ?? 0));

    const [pendingConfirmations] = await this.db
      .select({ n: count() })
      .from(pharmacyPurchaseOrders)
      .where(poOrg([eq(pharmacyPurchaseOrders.status, "sent")]));

    let lowStockCount = 0;
    if (branchCode?.trim()) {
      try {
        const reorder = await this.inventory.reorderSuggestions(organizationId, {
          branchCode: branchCode.trim(),
          page: 1,
          pageSize: 100,
        });
        lowStockCount = Math.min(reorder.total, 100);
      } catch (err) {
        if (!(err instanceof BadRequestException) && !(err instanceof NotFoundException)) {
          /* ignore reorder failures on dashboard */
        }
      }
    }

    const kpis: PurchaseKpi[] = [
      {
        key: "purchase_today",
        label: "Purchases today (GRN)",
        value: Number(purchaseToday?.total ?? 0),
        to: "/v1/pharmacy/purchase/grns?dateFrom=" + today + "&dateTo=" + today,
      },
      {
        key: "purchase_month",
        label: "Purchases this month (GRN)",
        value: Number(purchaseMonth?.total ?? 0),
        to: "/v1/pharmacy/purchase/grns?dateFrom=" + monthStart,
      },
      {
        key: "pending_requisitions",
        label: "Pending requisitions",
        value: Number(pendingReqs?.n ?? 0),
        to: "/v1/pharmacy/purchase/requisitions?status=submitted",
      },
      {
        key: "pending_pos",
        label: "Open purchase orders",
        value: Number(pendingPos?.n ?? 0),
        to: "/v1/pharmacy/purchase/orders",
      },
      {
        key: "pending_approvals",
        label: "POs awaiting approval",
        value: Number(pendingApprovals?.n ?? 0),
        to: "/v1/pharmacy/purchase/orders?status=submitted",
      },
      {
        key: "partial_pos",
        label: "Partially received POs",
        value: Number(partialPos?.n ?? 0),
        to: "/v1/pharmacy/purchase/orders?status=partial",
      },
      {
        key: "overdue_expected",
        label: "Overdue expected delivery",
        value: Number(overdue?.n ?? 0),
        to: "/v1/pharmacy/purchase/orders?status=approved",
      },
      {
        key: "returns_count",
        label: "Purchase returns",
        value: Number(returnsCount?.n ?? 0),
        to: "/v1/pharmacy/purchase/returns",
      },
      {
        key: "payables_estimate",
        label: "Payables estimate (GRN − returns)",
        value: payablesEstimate,
        to: "/v1/pharmacy/purchase/invoices",
      },
      {
        key: "low_stock",
        label: "Low stock (reorder, capped)",
        value: lowStockCount,
        to: "/v1/pharmacy/inventory/reorder",
      },
      {
        key: "pending_confirmations",
        label: "Awaiting supplier confirmation",
        value: Number(pendingConfirmations?.n ?? 0),
        to: "/v1/pharmacy/purchase/orders?status=sent",
      },
    ];

    return { kpis };
  }
}
