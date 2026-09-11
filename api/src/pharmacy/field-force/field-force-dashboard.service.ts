import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql, type SQL } from "drizzle-orm";
import {
  pharmacyCollections,
  pharmacyDistInvoices,
  pharmacyDistOrders,
  pharmacyRoutes,
  pharmacySalesForceProfiles,
  pharmacyTargets,
  pharmacyTerritories,
  pharmacyTradeCustomers,
  pharmacyVisits,
  popsEmployees,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { achievementPct, resolveBranch, todayIso } from "./field-force.shared";

@Injectable()
export class FieldForceDashboardService {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  async dashboard(
    organizationId: string,
    filters: { branchCode?: string; employeeId?: string; territoryId?: string; routeId?: string; date?: string } = {},
  ) {
    const date = filters.date || todayIso();
    const monthStart = `${date.slice(0, 8)}01`;
    const branch = await resolveBranch(this.db, organizationId, filters.branchCode);
    const visitConds: SQL[] = [eq(pharmacyVisits.organizationId, organizationId), eq(pharmacyVisits.plannedDate, date)];
    if (filters.employeeId) visitConds.push(eq(pharmacyVisits.employeeId, filters.employeeId));
    if (filters.territoryId) visitConds.push(eq(pharmacyVisits.territoryId, filters.territoryId));
    if (filters.routeId) visitConds.push(eq(pharmacyVisits.routeId, filters.routeId));
    if (branch) visitConds.push(eq(pharmacyVisits.branchId, branch.id));

    const [v] = await this.db
      .select({
        planned: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${pharmacyVisits.status} = 'completed')::int`,
        started: sql<number>`count(*) filter (where ${pharmacyVisits.status} = 'started')::int`,
        missed: sql<number>`count(*) filter (where ${pharmacyVisits.status} = 'missed')::int`,
        cancelled: sql<number>`count(*) filter (where ${pharmacyVisits.status} = 'cancelled')::int`,
      })
      .from(pharmacyVisits)
      .where(and(...visitConds));

    const salesConds: SQL[] = [
      eq(pharmacyDistInvoices.organizationId, organizationId),
      sql`${pharmacyDistInvoices.invoiceDate} = ${date}`,
    ];
    if (filters.employeeId) salesConds.push(eq(pharmacyDistOrders.salesmanEmployeeId, filters.employeeId));
    const [sales] = await this.db
      .select({
        orders: sql<number>`count(distinct ${pharmacyDistInvoices.orderId})::int`,
        salesPkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.totalPkr}), 0)::int`,
      })
      .from(pharmacyDistInvoices)
      .innerJoin(pharmacyDistOrders, eq(pharmacyDistOrders.id, pharmacyDistInvoices.orderId))
      .where(and(...salesConds));

    const colConds: SQL[] = [
      eq(pharmacyCollections.organizationId, organizationId),
      sql`${pharmacyCollections.createdAt}::date = ${date}`,
    ];
    if (filters.employeeId) colConds.push(eq(pharmacyCollections.salesmanEmployeeId, filters.employeeId));
    const [col] = await this.db
      .select({ collectionPkr: sql<number>`coalesce(sum(${pharmacyCollections.amountPkr}), 0)::int` })
      .from(pharmacyCollections)
      .where(and(...colConds));

    const [sf] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${pharmacySalesForceProfiles.status} = 'active')::int`,
      })
      .from(pharmacySalesForceProfiles)
      .where(eq(pharmacySalesForceProfiles.organizationId, organizationId));

    const targetConds: SQL[] = [
      eq(pharmacyTargets.organizationId, organizationId),
      eq(pharmacyTargets.status, "active"),
      sql`${pharmacyTargets.periodStart} <= ${date}`,
      sql`${pharmacyTargets.periodEnd} >= ${date}`,
    ];
    if (filters.employeeId) targetConds.push(eq(pharmacyTargets.employeeId, filters.employeeId));
    const [tgt] = await this.db
      .select({
        sales: sql<number>`coalesce(sum(${pharmacyTargets.targetSalesPkr}), 0)::int`,
        collection: sql<number>`coalesce(sum(${pharmacyTargets.targetCollectionPkr}), 0)::int`,
        visits: sql<number>`coalesce(sum(${pharmacyTargets.targetVisits}), 0)::int`,
      })
      .from(pharmacyTargets)
      .where(and(...targetConds));

    const [monthSales] = await this.db
      .select({ salesPkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.totalPkr}), 0)::int` })
      .from(pharmacyDistInvoices)
      .innerJoin(pharmacyDistOrders, eq(pharmacyDistOrders.id, pharmacyDistInvoices.orderId))
      .where(
        and(
          eq(pharmacyDistInvoices.organizationId, organizationId),
          sql`${pharmacyDistInvoices.invoiceDate} >= ${monthStart}`,
          sql`${pharmacyDistInvoices.invoiceDate} <= ${date}`,
          filters.employeeId ? eq(pharmacyDistOrders.salesmanEmployeeId, filters.employeeId) : undefined,
        ),
      );
    const [monthCol] = await this.db
      .select({ collectionPkr: sql<number>`coalesce(sum(${pharmacyCollections.amountPkr}), 0)::int` })
      .from(pharmacyCollections)
      .where(
        and(
          eq(pharmacyCollections.organizationId, organizationId),
          sql`${pharmacyCollections.createdAt}::date >= ${monthStart}`,
          sql`${pharmacyCollections.createdAt}::date <= ${date}`,
          filters.employeeId ? eq(pharmacyCollections.salesmanEmployeeId, filters.employeeId) : undefined,
        ),
      );

    const planned = Number(v?.planned ?? 0);
    const completed = Number(v?.completed ?? 0);
    const alerts = await this.alerts(organizationId, date, filters);

    return {
      asOf: new Date().toISOString(),
      date,
      kpis: {
        totalSalesmen: Number(sf?.total ?? 0),
        activeSalesmen: Number(sf?.active ?? 0),
        plannedVisits: planned,
        completedVisits: completed,
        inProgress: Number(v?.started ?? 0),
        missedVisits: Number(v?.missed ?? 0),
        cancelledVisits: Number(v?.cancelled ?? 0),
        orders: Number(sales?.orders ?? 0),
        salesPkr: Number(sales?.salesPkr ?? 0),
        collectionsPkr: Number(col?.collectionPkr ?? 0),
        visitAchievementPct: achievementPct(completed, planned),
        salesAchievementPct: achievementPct(Number(monthSales?.salesPkr ?? 0), Number(tgt?.sales ?? 0)),
        collectionAchievementPct: achievementPct(Number(monthCol?.collectionPkr ?? 0), Number(tgt?.collection ?? 0)),
        salesTargetPkr: Number(tgt?.sales ?? 0),
        collectionTargetPkr: Number(tgt?.collection ?? 0),
      },
      alerts,
      links: {
        visits: "/pops/distribution/visits",
        pjp: "/pops/distribution/pjp",
        performance: "/pops/distribution/field-performance",
        recovery: "/pops/distribution/recovery",
      },
    };
  }

  async performance(
    organizationId: string,
    filters: { from?: string; to?: string; branchCode?: string; group?: "salesman" | "territory" | "route" } = {},
  ) {
    const from = filters.from || todayIso();
    const to = filters.to || from;
    const group = filters.group ?? "salesman";

    const visitRows = await this.db
      .select({
        employeeId: pharmacyVisits.employeeId,
        employeeName: popsEmployees.displayName,
        territoryId: pharmacyVisits.territoryId,
        routeId: pharmacyVisits.routeId,
        planned: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${pharmacyVisits.status} = 'completed')::int`,
        missed: sql<number>`count(*) filter (where ${pharmacyVisits.status} = 'missed')::int`,
      })
      .from(pharmacyVisits)
      .leftJoin(popsEmployees, eq(popsEmployees.id, pharmacyVisits.employeeId))
      .where(
        and(
          eq(pharmacyVisits.organizationId, organizationId),
          sql`coalesce(${pharmacyVisits.plannedDate}, ${pharmacyVisits.visitedAt}::date) >= ${from}`,
          sql`coalesce(${pharmacyVisits.plannedDate}, ${pharmacyVisits.visitedAt}::date) <= ${to}`,
        ),
      )
      .groupBy(pharmacyVisits.employeeId, popsEmployees.displayName, pharmacyVisits.territoryId, pharmacyVisits.routeId);

    const salesRows = await this.db
      .select({
        employeeId: pharmacyDistOrders.salesmanEmployeeId,
        orders: sql<number>`count(*)::int`,
        salesPkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.totalPkr}), 0)::int`,
      })
      .from(pharmacyDistInvoices)
      .innerJoin(pharmacyDistOrders, eq(pharmacyDistOrders.id, pharmacyDistInvoices.orderId))
      .where(
        and(
          eq(pharmacyDistInvoices.organizationId, organizationId),
          sql`${pharmacyDistInvoices.invoiceDate} >= ${from}`,
          sql`${pharmacyDistInvoices.invoiceDate} <= ${to}`,
          sql`${pharmacyDistOrders.salesmanEmployeeId} is not null`,
        ),
      )
      .groupBy(pharmacyDistOrders.salesmanEmployeeId);

    const colRows = await this.db
      .select({
        employeeId: pharmacyCollections.salesmanEmployeeId,
        collectionPkr: sql<number>`coalesce(sum(${pharmacyCollections.amountPkr}), 0)::int`,
      })
      .from(pharmacyCollections)
      .where(
        and(
          eq(pharmacyCollections.organizationId, organizationId),
          sql`${pharmacyCollections.createdAt}::date >= ${from}`,
          sql`${pharmacyCollections.createdAt}::date <= ${to}`,
          sql`${pharmacyCollections.salesmanEmployeeId} is not null`,
        ),
      )
      .groupBy(pharmacyCollections.salesmanEmployeeId);

    const salesMap = new Map(salesRows.map((r) => [r.employeeId, r]));
    const colMap = new Map(colRows.map((r) => [r.employeeId, r]));

    const targets = await this.db
      .select()
      .from(pharmacyTargets)
      .where(
        and(
          eq(pharmacyTargets.organizationId, organizationId),
          eq(pharmacyTargets.status, "active"),
          sql`${pharmacyTargets.periodStart} <= ${to}`,
          sql`${pharmacyTargets.periodEnd} >= ${from}`,
        ),
      );

    const items = visitRows.map((r) => {
      const s = salesMap.get(r.employeeId);
      const c = colMap.get(r.employeeId);
      const t = targets.find((x) => x.employeeId === r.employeeId);
      const planned = Number(r.planned ?? 0);
      const completed = Number(r.completed ?? 0);
      const salesPkr = Number(s?.salesPkr ?? 0);
      const collectionPkr = Number(c?.collectionPkr ?? 0);
      return {
        employeeId: r.employeeId,
        name: r.employeeName,
        territoryId: r.territoryId,
        routeId: r.routeId,
        plannedVisits: planned,
        completedVisits: completed,
        missedVisits: Number(r.missed ?? 0),
        visitAchievementPct: achievementPct(completed, planned),
        orders: Number(s?.orders ?? 0),
        salesPkr,
        salesTargetPkr: t?.targetSalesPkr ?? 0,
        salesAchievementPct: achievementPct(salesPkr, t?.targetSalesPkr ?? 0),
        collectionsPkr: collectionPkr,
        collectionTargetPkr: t?.targetCollectionPkr ?? 0,
        collectionAchievementPct: achievementPct(collectionPkr, t?.targetCollectionPkr ?? 0),
        ordersPerVisit: planned > 0 ? Math.round((Number(s?.orders ?? 0) / planned) * 100) / 100 : 0,
        salesPerVisit: completed > 0 ? Math.round(salesPkr / completed) : 0,
        productiveVisitPct: achievementPct(completed, planned),
      };
    });

    if (group === "territory") {
      const territories = await this.db.select().from(pharmacyTerritories).where(eq(pharmacyTerritories.organizationId, organizationId));
      const names = new Map(territories.map((t) => [t.id, t.name]));
      const map = new Map<string, (typeof items)[0] & { territoryName?: string }>();
      for (const row of items) {
        const key = row.territoryId ?? "unassigned";
        const cur = map.get(key);
        if (!cur) {
          map.set(key, { ...row, name: names.get(row.territoryId ?? "") ?? "Unassigned", territoryName: names.get(row.territoryId ?? "") });
        } else {
          cur.plannedVisits += row.plannedVisits;
          cur.completedVisits += row.completedVisits;
          cur.missedVisits += row.missedVisits;
          cur.orders += row.orders;
          cur.salesPkr += row.salesPkr;
          cur.collectionsPkr += row.collectionsPkr;
        }
      }
      return {
        from,
        to,
        group,
        items: [...map.values()].map((r) => ({
          ...r,
          visitAchievementPct: achievementPct(r.completedVisits, r.plannedVisits),
          salesAchievementPct: achievementPct(r.salesPkr, r.salesTargetPkr),
          collectionAchievementPct: achievementPct(r.collectionsPkr, r.collectionTargetPkr),
        })),
      };
    }

    if (group === "route") {
      const routes = await this.db.select().from(pharmacyRoutes).where(eq(pharmacyRoutes.organizationId, organizationId));
      const names = new Map(routes.map((t) => [t.id, t.name]));
      return {
        from,
        to,
        group,
        items: items.map((r) => ({ ...r, name: names.get(r.routeId ?? "") ?? r.name ?? "Unassigned" })),
      };
    }

    return { from, to, group, items };
  }

  async coverage(organizationId: string, filters: { employeeId?: string; from?: string; to?: string } = {}) {
    const from = filters.from || todayIso();
    const to = filters.to || from;
    const custConds: SQL[] = [eq(pharmacyTradeCustomers.organizationId, organizationId)];
    if (filters.employeeId) custConds.push(eq(pharmacyTradeCustomers.salesmanEmployeeId, filters.employeeId));
    const customers = await this.db.select({ id: pharmacyTradeCustomers.id }).from(pharmacyTradeCustomers).where(and(...custConds));
    const visits = await this.db
      .select({ tradeCustomerId: pharmacyVisits.tradeCustomerId, status: pharmacyVisits.status })
      .from(pharmacyVisits)
      .where(
        and(
          eq(pharmacyVisits.organizationId, organizationId),
          sql`coalesce(${pharmacyVisits.plannedDate}, ${pharmacyVisits.visitedAt}::date) >= ${from}`,
          sql`coalesce(${pharmacyVisits.plannedDate}, ${pharmacyVisits.visitedAt}::date) <= ${to}`,
        ),
      );
    const plannedIds = new Set(visits.map((v) => v.tradeCustomerId).filter(Boolean) as string[]);
    const visitedIds = new Set(visits.filter((v) => v.status === "completed").map((v) => v.tradeCustomerId).filter(Boolean) as string[]);
    const assigned = customers.length;
    const planned = plannedIds.size;
    const visited = visitedIds.size;
    return {
      assignedCustomers: assigned,
      plannedCustomers: planned,
      visitedCustomers: visited,
      notVisited: Math.max(0, planned - visited),
      coveragePct: achievementPct(visited, planned || assigned),
    };
  }

  private async alerts(
    organizationId: string,
    date: string,
    filters: { employeeId?: string },
  ) {
    const [missedHi] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(pharmacyVisits)
      .where(
        and(
          eq(pharmacyVisits.organizationId, organizationId),
          eq(pharmacyVisits.plannedDate, date),
          eq(pharmacyVisits.status, "missed"),
        ),
      );
    const [overCredit] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(pharmacyTradeCustomers)
      .where(
        and(
          eq(pharmacyTradeCustomers.organizationId, organizationId),
          sql`${pharmacyTradeCustomers.creditLimitPkr} > 0`,
          sql`${pharmacyTradeCustomers.outstandingPkr} > ${pharmacyTradeCustomers.creditLimitPkr}`,
          filters.employeeId ? eq(pharmacyTradeCustomers.salesmanEmployeeId, filters.employeeId) : undefined,
        ),
      );
    const [follow] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(pharmacyVisits)
      .where(
        and(
          eq(pharmacyVisits.organizationId, organizationId),
          eq(pharmacyVisits.followUpRequired, true),
          sql`${pharmacyVisits.followUpDate} <= ${date}`,
        ),
      );
    return [
      {
        severity: "critical" as const,
        title: "Missed visits today",
        count: Number(missedHi?.n ?? 0),
        to: `/pops/distribution/visits?date=${date}&status=missed`,
      },
      {
        severity: "critical" as const,
        title: "Customers over credit",
        count: Number(overCredit?.n ?? 0),
        to: "/pops/distribution/recovery",
      },
      {
        severity: "warning" as const,
        title: "Pending follow-ups",
        count: Number(follow?.n ?? 0),
        to: `/pops/distribution/visits?focus=followup`,
      },
    ];
  }
}
