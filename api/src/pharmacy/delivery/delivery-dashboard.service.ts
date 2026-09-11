import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { pharmacyDeliveries, popsBranches, type PlatformPgDb } from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";

/**
 * Delivery KPI aggregates via SQL counts — avoids load-all into Node.
 */
@Injectable()
export class DeliveryDashboardService {
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

  async getDashboard(organizationId: string, branchCode?: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const conds: SQL[] = [eq(pharmacyDeliveries.organizationId, organizationId)];
    if (branch) conds.push(eq(pharmacyDeliveries.branchId, branch.id));
    const where = and(...conds);

    const [agg] = await this.db
      .select({
        ready: sql<number>`count(*) filter (where ${pharmacyDeliveries.status} in ('ready','pending'))::int`,
        pendingDispatch: sql<number>`count(*) filter (where ${pharmacyDeliveries.status} in ('ready','pending'))::int`,
        dispatched: sql<number>`count(*) filter (where ${pharmacyDeliveries.status} = 'dispatched')::int`,
        outForDelivery: sql<number>`count(*) filter (where ${pharmacyDeliveries.status} = 'out_for_delivery')::int`,
        deliveredToday: sql<number>`count(*) filter (where ${pharmacyDeliveries.status} in ('delivered','partial') and ${pharmacyDeliveries.deliveredAt} >= ${todayStart})::int`,
        failed: sql<number>`count(*) filter (where ${pharmacyDeliveries.status} in ('failed','refused'))::int`,
        podPending: sql<number>`count(*) filter (where ${pharmacyDeliveries.status} in ('dispatched','out_for_delivery'))::int`,
        totalOpen: sql<number>`count(*) filter (where ${pharmacyDeliveries.status} not in ('delivered','cancelled','refused'))::int`,
      })
      .from(pharmacyDeliveries)
      .where(where);

    return {
      ready: agg?.ready ?? 0,
      pendingDispatch: agg?.pendingDispatch ?? 0,
      dispatched: agg?.dispatched ?? 0,
      outForDelivery: agg?.outForDelivery ?? 0,
      deliveredToday: agg?.deliveredToday ?? 0,
      failed: agg?.failed ?? 0,
      podPending: agg?.podPending ?? 0,
      totalOpen: agg?.totalOpen ?? 0,
      asOf: new Date().toISOString(),
    };
  }
}
