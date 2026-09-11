import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { CreateFieldForceTarget } from "@platform/contracts";
import {
  pharmacyCollections,
  pharmacyDistInvoices,
  pharmacyDistOrders,
  pharmacyTargets,
  pharmacyVisits,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { FieldForceNumberingService } from "./field-force-numbering.service";
import { achievementPct, resolveBranch, writeAudit } from "./field-force.shared";

@Injectable()
export class FieldForceTargetService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly numbering: FieldForceNumberingService,
  ) {}

  async list(
    organizationId: string,
    filters: {
      employeeId?: string;
      territoryId?: string;
      routeId?: string;
      scopeType?: string;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    const conds: SQL[] = [eq(pharmacyTargets.organizationId, organizationId), eq(pharmacyTargets.status, "active")];
    if (filters.employeeId) conds.push(eq(pharmacyTargets.employeeId, filters.employeeId));
    if (filters.territoryId) conds.push(eq(pharmacyTargets.territoryId, filters.territoryId));
    if (filters.routeId) conds.push(eq(pharmacyTargets.routeId, filters.routeId));
    if (filters.scopeType) conds.push(eq(pharmacyTargets.scopeType, filters.scopeType));
    if (filters.from) conds.push(sql`${pharmacyTargets.periodEnd} >= ${filters.from}`);
    if (filters.to) conds.push(sql`${pharmacyTargets.periodStart} <= ${filters.to}`);

    const rows = await this.db
      .select()
      .from(pharmacyTargets)
      .where(and(...conds))
      .orderBy(desc(pharmacyTargets.periodStart));

    const items = [];
    for (const t of rows.slice((page - 1) * pageSize, page * pageSize)) {
      items.push(await this.withActuals(organizationId, t));
    }
    return { items, page, pageSize, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / pageSize)) };
  }

  async create(organizationId: string, input: CreateFieldForceTarget, userId?: string) {
    if (!input.periodStart || !input.periodEnd) throw new BadRequestException("periodStart and periodEnd are required");
    const scopeType = input.scopeType ?? (input.employeeId ? "salesman" : input.territoryId ? "territory" : input.routeId ? "route" : "branch");
    const branch = await resolveBranch(this.db, organizationId, input.branchCode);

    const overlapConds: SQL[] = [
      eq(pharmacyTargets.organizationId, organizationId),
      eq(pharmacyTargets.status, "active"),
      eq(pharmacyTargets.scopeType, scopeType),
      sql`${pharmacyTargets.periodStart} <= ${input.periodEnd}`,
      sql`${pharmacyTargets.periodEnd} >= ${input.periodStart}`,
    ];
    if (input.employeeId) overlapConds.push(eq(pharmacyTargets.employeeId, input.employeeId));
    if (input.territoryId) overlapConds.push(eq(pharmacyTargets.territoryId, input.territoryId));
    if (input.routeId) overlapConds.push(eq(pharmacyTargets.routeId, input.routeId));

    const [overlap] = await this.db.select().from(pharmacyTargets).where(and(...overlapConds)).limit(1);
    if (overlap && !input.changeReason) {
      throw new BadRequestException("Overlapping active target exists — pass changeReason to revise");
    }

    if (overlap && input.changeReason) {
      await this.db.update(pharmacyTargets).set({ status: "superseded" }).where(eq(pharmacyTargets.id, overlap.id));
    }

    return this.numbering.withNumber(organizationId, "target", async (targetNumber) => {
      const [row] = await this.db
        .insert(pharmacyTargets)
        .values({
          organizationId,
          targetNumber,
          periodType: input.periodType ?? "monthly",
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          employeeId: input.employeeId ?? null,
          territoryId: input.territoryId ?? null,
          routeId: input.routeId ?? null,
          branchId: branch?.id ?? null,
          scopeType,
          targetSalesPkr: Math.round(input.targetSalesPkr ?? 0),
          targetCollectionPkr: Math.round(input.targetCollectionPkr ?? 0),
          targetVisits: Math.round(input.targetVisits ?? 0),
          version: overlap ? (overlap.version ?? 1) + 1 : 1,
          previousTargetId: overlap?.id ?? null,
          changeReason: input.changeReason ?? null,
          createdByUserId: userId ?? null,
        })
        .returning();
      if (!row) throw new BadRequestException("Failed to create target");
      await writeAudit(this.db, organizationId, {
        entityType: "target",
        entityId: row.id,
        action: overlap ? "revise" : "create",
        oldValue: overlap ?? undefined,
        newValue: row,
        reason: input.changeReason,
        userId,
      });
      return this.withActuals(organizationId, row);
    });
  }

  async getById(organizationId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(pharmacyTargets)
      .where(and(eq(pharmacyTargets.organizationId, organizationId), eq(pharmacyTargets.id, id)))
      .limit(1);
    if (!row) throw new NotFoundException("Target not found");
    return this.withActuals(organizationId, row);
  }

  private async withActuals(organizationId: string, t: typeof pharmacyTargets.$inferSelect) {
    const salesConds: SQL[] = [
      eq(pharmacyDistInvoices.organizationId, organizationId),
      sql`${pharmacyDistInvoices.invoiceDate} >= ${t.periodStart}`,
      sql`${pharmacyDistInvoices.invoiceDate} <= ${t.periodEnd}`,
    ];
    const colConds: SQL[] = [
      eq(pharmacyCollections.organizationId, organizationId),
      sql`${pharmacyCollections.createdAt}::date >= ${t.periodStart}`,
      sql`${pharmacyCollections.createdAt}::date <= ${t.periodEnd}`,
    ];
    const visitConds: SQL[] = [
      eq(pharmacyVisits.organizationId, organizationId),
      sql`coalesce(${pharmacyVisits.plannedDate}, ${pharmacyVisits.visitedAt}::date) >= ${t.periodStart}`,
      sql`coalesce(${pharmacyVisits.plannedDate}, ${pharmacyVisits.visitedAt}::date) <= ${t.periodEnd}`,
    ];
    if (t.employeeId) {
      salesConds.push(eq(pharmacyDistOrders.salesmanEmployeeId, t.employeeId));
      colConds.push(eq(pharmacyCollections.salesmanEmployeeId, t.employeeId));
      visitConds.push(eq(pharmacyVisits.employeeId, t.employeeId));
    }
    if (t.routeId) visitConds.push(eq(pharmacyVisits.routeId, t.routeId));
    if (t.territoryId) visitConds.push(eq(pharmacyVisits.territoryId, t.territoryId));

    const [sales] = await this.db
      .select({
        total: sql<number>`coalesce(sum(${pharmacyDistInvoices.totalPkr}), 0)::int`,
        orders: sql<number>`count(distinct ${pharmacyDistInvoices.orderId})::int`,
      })
      .from(pharmacyDistInvoices)
      .innerJoin(pharmacyDistOrders, eq(pharmacyDistOrders.id, pharmacyDistInvoices.orderId))
      .where(and(...salesConds));
    const [col] = await this.db
      .select({ total: sql<number>`coalesce(sum(${pharmacyCollections.amountPkr}), 0)::int` })
      .from(pharmacyCollections)
      .where(and(...colConds));
    const [vis] = await this.db
      .select({
        planned: sql<number>`count(*) filter (where ${pharmacyVisits.status} in ('planned','started','completed','missed','cancelled','rescheduled'))::int`,
        completed: sql<number>`count(*) filter (where ${pharmacyVisits.status} = 'completed')::int`,
      })
      .from(pharmacyVisits)
      .where(and(...visitConds));

    const actualSales = Number(sales?.total ?? 0);
    const actualCollection = Number(col?.total ?? 0);
    const actualVisits = Number(vis?.completed ?? 0);
    return {
      ...t,
      actualSalesPkr: actualSales,
      actualCollectionPkr: actualCollection,
      actualVisits,
      plannedVisits: Number(vis?.planned ?? 0),
      orders: Number(sales?.orders ?? 0),
      salesAchievementPct: achievementPct(actualSales, t.targetSalesPkr),
      collectionAchievementPct: achievementPct(actualCollection, t.targetCollectionPkr),
      visitAchievementPct: achievementPct(actualVisits, t.targetVisits),
    };
  }
}
