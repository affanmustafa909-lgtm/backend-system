import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import {
  pharmacyAssignments,
  pharmacyCollections,
  pharmacyCompanies,
  pharmacyDeliveries,
  pharmacyDistInvoiceLines,
  pharmacyDistInvoices,
  pharmacyDistOrders,
  pharmacyMedicineBatches,
  pharmacyMedicines,
  pharmacyPurchaseOrders,
  pharmacyTargets,
  pharmacyTradeCustomers,
  pharmacyVisits,
  pharmacyWarehouses,
  pharmacyWholesaleReturns,
  popsBranches,
  popsEmployees,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../drizzle/drizzle.tokens";

export type DashboardFilterInput = {
  branchCode?: string;
  warehouseId?: string;
  companyId?: string;
  salesmanId?: string;
  territoryId?: string;
  routeId?: string;
  from?: string;
  to?: string;
  preset?: string;
  limit?: number;
};

type ResolvedRange = {
  preset: string;
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  fromDate: string;
  toDate: string;
  monthStart: Date;
  todayStart: Date;
};

type ResolvedScope = {
  organizationId: string;
  branchId: string | null;
  warehouseId: string | null;
  companyId: string | null;
  salesmanId: string | null;
  territoryId: string | null;
  routeId: string | null;
  range: ResolvedRange;
  limit: number;
};

type MetricComparison = {
  current: number;
  previous: number;
  pct: number | null;
};

const COST_COVERAGE_THRESHOLD = 0.7;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function n(v: number | string | null | undefined): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0 && current === 0) return 0;
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

function compare(current: number, previous: number): MetricComparison {
  return { current, previous, pct: pctDelta(current, previous) };
}

function clampLimit(raw: number | undefined, fallback = 10, min = 10, max = 50): number {
  const v = Number(raw ?? fallback);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

function resolveDateRange(filters: DashboardFilterInput, defaultPreset: string): ResolvedRange {
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
  const presetRaw = (filters.preset ?? defaultPreset).trim().toLowerCase() || defaultPreset;

  let preset = presetRaw;
  let from = todayStart;
  let to = todayEnd;

  if (preset === "custom" || filters.from || filters.to) {
    if (!filters.from?.trim() || !filters.to?.trim()) {
      if (preset === "custom") {
        throw new BadRequestException("from and to are required for custom preset");
      }
    }
    if (filters.from?.trim() && filters.to?.trim()) {
      preset = "custom";
      from = startOfDay(new Date(filters.from.trim()));
      to = endOfDay(new Date(filters.to.trim()));
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new BadRequestException("Invalid from/to date");
      }
      if (from > to) throw new BadRequestException("from must be on or before to");
    }
  } else if (preset === "yesterday") {
    from = addDays(todayStart, -1);
    to = endOfDay(addDays(todayStart, -1));
  } else if (preset === "last7") {
    from = addDays(todayStart, -6);
    to = todayEnd;
  } else if (preset === "last30") {
    from = addDays(todayStart, -29);
    to = todayEnd;
  } else if (preset === "this_month") {
    from = monthStart;
    to = todayEnd;
  } else if (preset === "previous_month") {
    const prevMonthStart = new Date(todayStart.getFullYear(), todayStart.getMonth() - 1, 1);
    const prevMonthEnd = endOfDay(addDays(monthStart, -1));
    from = prevMonthStart;
    to = prevMonthEnd;
  } else {
    preset = "today";
    from = todayStart;
    to = todayEnd;
  }

  const durationMs = to.getTime() - from.getTime();
  const previousTo = new Date(from.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - durationMs);

  return {
    preset,
    from,
    to,
    previousFrom,
    previousTo,
    fromDate: dateStr(from),
    toDate: dateStr(to),
    monthStart,
    todayStart,
  };
}

@Injectable()
export class PharmacyDashboardService {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  private async resolveBranch(organizationId: string, branchCode: string) {
    const code = branchCode.trim();
    if (!code) throw new BadRequestException("branchCode is required");
    const [branch] = await this.db
      .select()
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, code)))
      .limit(1);
    if (!branch) throw new NotFoundException(`Branch not found: ${code}`);
    return branch;
  }

  private async resolveScope(
    organizationId: string,
    filters: DashboardFilterInput,
    defaultPreset = "today",
  ): Promise<ResolvedScope> {
    const branch = filters.branchCode?.trim()
      ? await this.resolveBranch(organizationId, filters.branchCode.trim())
      : null;

    let warehouseId: string | null = null;
    if (filters.warehouseId?.trim()) {
      const wid = filters.warehouseId.trim();
      const [wh] = await this.db
        .select()
        .from(pharmacyWarehouses)
        .where(and(eq(pharmacyWarehouses.id, wid), eq(pharmacyWarehouses.organizationId, organizationId)))
        .limit(1);
      if (!wh) throw new BadRequestException("Warehouse not found for this organization");
      if (branch && wh.branchId !== branch.id) {
        throw new BadRequestException("Warehouse does not belong to the selected branch");
      }
      warehouseId = wh.id;
    }

    return {
      organizationId,
      branchId: branch?.id ?? null,
      warehouseId,
      companyId: filters.companyId?.trim() || null,
      salesmanId: filters.salesmanId?.trim() || null,
      territoryId: filters.territoryId?.trim() || null,
      routeId: filters.routeId?.trim() || null,
      range: resolveDateRange(filters, defaultPreset),
      limit: clampLimit(filters.limit),
    };
  }

  private invBase(scope: ResolvedScope): SQL {
    const parts: SQL[] = [eq(pharmacyDistInvoices.organizationId, scope.organizationId)];
    if (scope.branchId) parts.push(eq(pharmacyDistInvoices.branchId, scope.branchId));
    return and(...parts)!;
  }

  private invPeriod(scope: ResolvedScope, from: Date, to: Date): SQL {
    return and(this.invBase(scope), gte(pharmacyDistInvoices.createdAt, from), lte(pharmacyDistInvoices.createdAt, to))!;
  }

  private needsOrderJoin(scope: ResolvedScope): boolean {
    return Boolean(scope.warehouseId || scope.salesmanId);
  }

  private needsCustomerJoin(scope: ResolvedScope): boolean {
    return Boolean(scope.territoryId || scope.routeId);
  }

  private orderFilter(scope: ResolvedScope): SQL | undefined {
    const parts: SQL[] = [];
    if (scope.warehouseId) parts.push(eq(pharmacyDistOrders.warehouseId, scope.warehouseId));
    if (scope.salesmanId) parts.push(eq(pharmacyDistOrders.salesmanEmployeeId, scope.salesmanId));
    return parts.length ? and(...parts) : undefined;
  }

  private customerFilter(scope: ResolvedScope): SQL | undefined {
    const parts: SQL[] = [];
    if (scope.territoryId) parts.push(eq(pharmacyTradeCustomers.territoryId, scope.territoryId));
    if (scope.routeId) parts.push(eq(pharmacyTradeCustomers.routeId, scope.routeId));
    return parts.length ? and(...parts) : undefined;
  }

  private orderBase(scope: ResolvedScope): SQL {
    const parts: SQL[] = [eq(pharmacyDistOrders.organizationId, scope.organizationId)];
    if (scope.branchId) parts.push(eq(pharmacyDistOrders.branchId, scope.branchId));
    if (scope.warehouseId) parts.push(eq(pharmacyDistOrders.warehouseId, scope.warehouseId));
    if (scope.salesmanId) parts.push(eq(pharmacyDistOrders.salesmanEmployeeId, scope.salesmanId));
    return and(...parts)!;
  }

  private colBase(scope: ResolvedScope): SQL {
    const parts: SQL[] = [eq(pharmacyCollections.organizationId, scope.organizationId)];
    if (scope.branchId) parts.push(eq(pharmacyCollections.branchId, scope.branchId));
    if (scope.salesmanId) parts.push(eq(pharmacyCollections.salesmanEmployeeId, scope.salesmanId));
    return and(...parts)!;
  }

  private retBase(scope: ResolvedScope): SQL {
    const parts: SQL[] = [eq(pharmacyWholesaleReturns.organizationId, scope.organizationId)];
    if (scope.branchId) parts.push(eq(pharmacyWholesaleReturns.branchId, scope.branchId));
    if (scope.warehouseId) parts.push(eq(pharmacyWholesaleReturns.warehouseId, scope.warehouseId));
    return and(...parts)!;
  }

  private delBase(scope: ResolvedScope): SQL {
    const parts: SQL[] = [eq(pharmacyDeliveries.organizationId, scope.organizationId)];
    if (scope.branchId) parts.push(eq(pharmacyDeliveries.branchId, scope.branchId));
    if (scope.routeId) parts.push(eq(pharmacyDeliveries.routeId, scope.routeId));
    return and(...parts)!;
  }

  private medBase(scope: ResolvedScope): SQL {
    const parts: SQL[] = [eq(pharmacyMedicines.organizationId, scope.organizationId)];
    if (scope.branchId) parts.push(eq(pharmacyMedicines.branchId, scope.branchId));
    if (scope.companyId) parts.push(eq(pharmacyMedicines.companyId, scope.companyId));
    if (scope.warehouseId) parts.push(eq(pharmacyMedicines.preferredWarehouseId, scope.warehouseId));
    return and(...parts)!;
  }

  private async salesAgg(scope: ResolvedScope, from: Date, to: Date) {
    const period = this.invPeriod(scope, from, to);
    const orderF = this.orderFilter(scope);
    const custF = this.customerFilter(scope);
    const companyF = scope.companyId ? eq(pharmacyMedicines.companyId, scope.companyId) : undefined;

    if (scope.companyId || this.needsOrderJoin(scope) || this.needsCustomerJoin(scope)) {
      const where = and(
        period,
        orderF,
        custF,
        companyF,
      )!;

      const q = this.db
        .select({
          gross: sql<number>`coalesce(sum(${pharmacyDistInvoiceLines.lineTotalPkr}), 0)::int`,
          discounts: sql<number>`0::int`,
          invoices: sql<number>`count(distinct ${pharmacyDistInvoices.id})::int`,
          cash: sql<number>`coalesce(sum(case when lower(${pharmacyDistInvoices.paymentMethod}) in ('cash','cod') then ${pharmacyDistInvoiceLines.lineTotalPkr} else 0 end), 0)::int`,
          credit: sql<number>`coalesce(sum(case when lower(${pharmacyDistInvoices.paymentMethod}) not in ('cash','cod') then ${pharmacyDistInvoiceLines.lineTotalPkr} else 0 end), 0)::int`,
        })
        .from(pharmacyDistInvoiceLines)
        .innerJoin(pharmacyDistInvoices, eq(pharmacyDistInvoiceLines.invoiceId, pharmacyDistInvoices.id))
        .innerJoin(pharmacyMedicines, eq(pharmacyDistInvoiceLines.medicineId, pharmacyMedicines.id));

      const withOrder = this.needsOrderJoin(scope)
        ? q.leftJoin(pharmacyDistOrders, eq(pharmacyDistInvoices.orderId, pharmacyDistOrders.id))
        : q;
      const withCust = this.needsCustomerJoin(scope)
        ? withOrder.innerJoin(
            pharmacyTradeCustomers,
            eq(pharmacyDistInvoices.tradeCustomerId, pharmacyTradeCustomers.id),
          )
        : withOrder;

      const [row] = await withCust.where(where);
      return {
        gross: n(row?.gross),
        discounts: 0,
        invoices: n(row?.invoices),
        cash: n(row?.cash),
        credit: n(row?.credit),
      };
    }

    const [row] = await this.db
      .select({
        gross: sql<number>`coalesce(sum(${pharmacyDistInvoices.totalPkr}), 0)::int`,
        discounts: sql<number>`coalesce(sum(${pharmacyDistInvoices.discountPkr}), 0)::int`,
        invoices: sql<number>`count(*)::int`,
        cash: sql<number>`coalesce(sum(${pharmacyDistInvoices.totalPkr}) filter (where lower(${pharmacyDistInvoices.paymentMethod}) in ('cash','cod')), 0)::int`,
        credit: sql<number>`coalesce(sum(${pharmacyDistInvoices.totalPkr}) filter (where lower(${pharmacyDistInvoices.paymentMethod}) not in ('cash','cod')), 0)::int`,
      })
      .from(pharmacyDistInvoices)
      .where(period);

    return {
      gross: n(row?.gross),
      discounts: n(row?.discounts),
      invoices: n(row?.invoices),
      cash: n(row?.cash),
      credit: n(row?.credit),
    };
  }

  private async returnsAgg(scope: ResolvedScope, from: Date, to: Date) {
    const parts: SQL[] = [
      this.retBase(scope),
      gte(pharmacyWholesaleReturns.createdAt, from),
      lte(pharmacyWholesaleReturns.createdAt, to),
    ];
    if (this.needsCustomerJoin(scope)) {
      const custF = this.customerFilter(scope);
      const [row] = await this.db
        .select({
          amount: sql<number>`coalesce(sum(${pharmacyWholesaleReturns.totalPkr}), 0)::int`,
          count: sql<number>`count(*)::int`,
        })
        .from(pharmacyWholesaleReturns)
        .innerJoin(
          pharmacyTradeCustomers,
          eq(pharmacyWholesaleReturns.tradeCustomerId, pharmacyTradeCustomers.id),
        )
        .where(and(...parts, custF)!);
      return { amount: n(row?.amount), count: n(row?.count) };
    }
    const [row] = await this.db
      .select({
        amount: sql<number>`coalesce(sum(${pharmacyWholesaleReturns.totalPkr}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(pharmacyWholesaleReturns)
      .where(and(...parts)!);
    return { amount: n(row?.amount), count: n(row?.count) };
  }

  private async collectionsAgg(scope: ResolvedScope, from: Date, to: Date) {
    const parts: SQL[] = [
      this.colBase(scope),
      gte(pharmacyCollections.createdAt, from),
      lte(pharmacyCollections.createdAt, to),
    ];
    if (this.needsCustomerJoin(scope)) {
      const custF = this.customerFilter(scope);
      const [row] = await this.db
        .select({
          amount: sql<number>`coalesce(sum(${pharmacyCollections.amountPkr}), 0)::int`,
          count: sql<number>`count(*)::int`,
        })
        .from(pharmacyCollections)
        .innerJoin(
          pharmacyTradeCustomers,
          eq(pharmacyCollections.tradeCustomerId, pharmacyTradeCustomers.id),
        )
        .where(and(...parts, custF)!);
      return { amount: n(row?.amount), count: n(row?.count) };
    }
    const [row] = await this.db
      .select({
        amount: sql<number>`coalesce(sum(${pharmacyCollections.amountPkr}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(pharmacyCollections)
      .where(and(...parts)!);
    return { amount: n(row?.amount), count: n(row?.count) };
  }

  private async ordersCount(scope: ResolvedScope, from: Date, to: Date) {
    const parts: SQL[] = [
      this.orderBase(scope),
      gte(pharmacyDistOrders.createdAt, from),
      lte(pharmacyDistOrders.createdAt, to),
      sql`${pharmacyDistOrders.status} not in ('cancelled','draft')`,
    ];
    if (this.needsCustomerJoin(scope)) {
      const custF = this.customerFilter(scope);
      const [row] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(pharmacyDistOrders)
        .innerJoin(pharmacyTradeCustomers, eq(pharmacyDistOrders.tradeCustomerId, pharmacyTradeCustomers.id))
        .where(and(...parts, custF)!);
      return n(row?.count);
    }
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(pharmacyDistOrders)
      .where(and(...parts)!);
    return n(row?.count);
  }

  private async profitabilityAgg(scope: ResolvedScope, from: Date, to: Date) {
    const period = this.invPeriod(scope, from, to);
    const orderF = this.orderFilter(scope);
    const custF = this.customerFilter(scope);
    const companyF = scope.companyId ? eq(pharmacyMedicines.companyId, scope.companyId) : undefined;

    let q = this.db
      .select({
        netSales: sql<number>`coalesce(sum(${pharmacyDistInvoiceLines.lineTotalPkr}), 0)::int`,
        coveredSales: sql<number>`coalesce(sum(case when coalesce(${pharmacyMedicineBatches.purchaseRatePkr}, ${pharmacyMedicines.costPricePkr}, 0) > 0 then ${pharmacyDistInvoiceLines.lineTotalPkr} else 0 end), 0)::int`,
        cogs: sql<number>`coalesce(sum(${pharmacyDistInvoiceLines.quantity} * coalesce(${pharmacyMedicineBatches.purchaseRatePkr}, ${pharmacyMedicines.costPricePkr}, 0)), 0)::int`,
        lineCount: sql<number>`count(*)::int`,
      })
      .from(pharmacyDistInvoiceLines)
      .innerJoin(pharmacyDistInvoices, eq(pharmacyDistInvoiceLines.invoiceId, pharmacyDistInvoices.id))
      .innerJoin(pharmacyMedicines, eq(pharmacyDistInvoiceLines.medicineId, pharmacyMedicines.id))
      .leftJoin(pharmacyMedicineBatches, eq(pharmacyDistInvoiceLines.batchId, pharmacyMedicineBatches.id));

    if (this.needsOrderJoin(scope)) {
      q = q.leftJoin(pharmacyDistOrders, eq(pharmacyDistInvoices.orderId, pharmacyDistOrders.id)) as typeof q;
    }
    if (this.needsCustomerJoin(scope)) {
      q = q.innerJoin(
        pharmacyTradeCustomers,
        eq(pharmacyDistInvoices.tradeCustomerId, pharmacyTradeCustomers.id),
      ) as typeof q;
    }

    const [row] = await q.where(and(period, orderF, custF, companyF)!);
    const netSales = n(row?.netSales);
    const coveredSales = n(row?.coveredSales);
    const cogs = n(row?.cogs);
    const coverage = netSales > 0 ? coveredSales / netSales : 1;
    return { netSales, coveredSales, cogs, coverage, lineCount: n(row?.lineCount) };
  }

  async summary(organizationId: string, filters: DashboardFilterInput = {}) {
    const scope = await this.resolveScope(organizationId, filters, "today");
    const { range } = scope;
    const in7 = dateStr(addDays(range.todayStart, 7));
    const in30 = dateStr(addDays(range.todayStart, 30));
    const todayStr = dateStr(range.todayStart);

    const custWhereParts: SQL[] = [eq(pharmacyTradeCustomers.organizationId, organizationId)];
    if (scope.branchId) custWhereParts.push(eq(pharmacyTradeCustomers.branchId, scope.branchId));
    if (scope.territoryId) custWhereParts.push(eq(pharmacyTradeCustomers.territoryId, scope.territoryId));
    if (scope.routeId) custWhereParts.push(eq(pharmacyTradeCustomers.routeId, scope.routeId));
    if (scope.salesmanId) {
      custWhereParts.push(eq(pharmacyTradeCustomers.salesmanEmployeeId, scope.salesmanId));
    }
    const custWhere = and(...custWhereParts)!;

    const assignParts: SQL[] = [
      eq(pharmacyAssignments.organizationId, organizationId),
      gte(pharmacyAssignments.assignmentDate, range.fromDate),
      lte(pharmacyAssignments.assignmentDate, range.toDate),
    ];
    if (scope.branchId) assignParts.push(eq(pharmacyAssignments.branchId, scope.branchId));
    if (scope.salesmanId) assignParts.push(eq(pharmacyAssignments.employeeId, scope.salesmanId));
    if (scope.routeId) assignParts.push(eq(pharmacyAssignments.routeId, scope.routeId));
    const assignWhere = and(...assignParts)!;

    const [
      salesCur,
      salesPrev,
      retCur,
      retPrev,
      colCur,
      colPrev,
      colMonth,
      ordersCur,
      ordersPrev,
      profit,
      stock,
      expiry,
      orderOps,
      pendingDeliveries,
      pendingPurchaseOrders,
      field,
      outstanding,
      overdue,
    ] = await Promise.all([
      this.salesAgg(scope, range.from, range.to),
      this.salesAgg(scope, range.previousFrom, range.previousTo),
      this.returnsAgg(scope, range.from, range.to),
      this.returnsAgg(scope, range.previousFrom, range.previousTo),
      this.collectionsAgg(scope, range.from, range.to),
      this.collectionsAgg(scope, range.previousFrom, range.previousTo),
      this.collectionsAgg(scope, range.monthStart, endOfDay(new Date())),
      this.ordersCount(scope, range.from, range.to),
      this.ordersCount(scope, range.previousFrom, range.previousTo),
      this.profitabilityAgg(scope, range.from, range.to),
      this.db
        .select({
          lowStockSkus: sql<number>`count(*) filter (where ${pharmacyMedicines.status} = 'active' and ${pharmacyMedicines.currentStock} <= ${pharmacyMedicines.reorderLevel})::int`,
          stockValuePkr: sql<number>`coalesce(sum(${pharmacyMedicines.currentStock} * ${pharmacyMedicines.costPricePkr}), 0)::int`,
          skuCount: sql<number>`count(*) filter (where ${pharmacyMedicines.status} = 'active')::int`,
        })
        .from(pharmacyMedicines)
        .where(this.medBase(scope))
        .then((r) => r[0]),
      this.db
        .select({
          expiredBatches: sql<number>`count(*) filter (where ${pharmacyMedicineBatches.expiryDate} < ${todayStr} and ${pharmacyMedicineBatches.quantity} >= 1)::int`,
          nearExpiry7: sql<number>`count(*) filter (where ${pharmacyMedicineBatches.expiryDate} >= ${todayStr} and ${pharmacyMedicineBatches.expiryDate} <= ${in7} and ${pharmacyMedicineBatches.quantity} >= 1)::int`,
          nearExpiry30: sql<number>`count(*) filter (where ${pharmacyMedicineBatches.expiryDate} > ${in7} and ${pharmacyMedicineBatches.expiryDate} <= ${in30} and ${pharmacyMedicineBatches.quantity} >= 1)::int`,
        })
        .from(pharmacyMedicineBatches)
        .innerJoin(pharmacyMedicines, eq(pharmacyMedicineBatches.medicineId, pharmacyMedicines.id))
        .where(
          and(
            this.medBase(scope),
            scope.warehouseId ? eq(pharmacyMedicineBatches.warehouseId, scope.warehouseId) : undefined,
          )!,
        )
        .then((r) => r[0]),
      this.db
        .select({
          pendingOrders: sql<number>`count(*) filter (where ${pharmacyDistOrders.status} in ('draft','booked','submitted','approved','stock_reserved','picking','packed','ready_for_dispatch'))::int`,
          pendingApproval: sql<number>`count(*) filter (where ${pharmacyDistOrders.status} in ('booked','submitted'))::int`,
        })
        .from(pharmacyDistOrders)
        .where(this.orderBase(scope))
        .then((r) => r[0]),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(pharmacyDeliveries)
        .where(and(this.delBase(scope), sql`${pharmacyDeliveries.status} not in ('delivered','cancelled')`)!)
        .then((r) => n(r[0]?.count)),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(pharmacyPurchaseOrders)
        .where(
          and(
            eq(pharmacyPurchaseOrders.organizationId, organizationId),
            scope.branchId ? eq(pharmacyPurchaseOrders.branchId, scope.branchId) : undefined,
            sql`${pharmacyPurchaseOrders.status} in ('draft','approved')`,
          )!,
        )
        .then((r) => n(r[0]?.count)),
      this.db
        .select({
          planned: sql<number>`count(*)::int`,
          completed: sql<number>`count(distinct ${pharmacyAssignments.id}) filter (where ${pharmacyVisits.id} is not null and ${pharmacyVisits.status} = 'completed')::int`,
        })
        .from(pharmacyAssignments)
        .leftJoin(
          pharmacyVisits,
          and(
            eq(pharmacyVisits.assignmentId, pharmacyAssignments.id),
            eq(pharmacyVisits.status, "completed"),
          ),
        )
        .where(assignWhere)
        .then((r) => r[0]),
      this.db
        .select({
          outstandingPkr: sql<number>`coalesce(sum(${pharmacyTradeCustomers.outstandingPkr}), 0)::int`,
        })
        .from(pharmacyTradeCustomers)
        .where(custWhere)
        .then((r) => r[0]),
      this.db
        .select({
          overduePkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.amountDuePkr}), 0)::int`,
          overdueCustomers: sql<number>`count(distinct ${pharmacyDistInvoices.tradeCustomerId})::int`,
        })
        .from(pharmacyDistInvoices)
        .innerJoin(
          pharmacyTradeCustomers,
          eq(pharmacyDistInvoices.tradeCustomerId, pharmacyTradeCustomers.id),
        )
        .where(
          and(
            this.invBase(scope),
            sql`${pharmacyDistInvoices.amountDuePkr} > 0`,
            sql`(${pharmacyDistInvoices.invoiceDate}::date + coalesce(${pharmacyTradeCustomers.creditDays}, 30)) < ${todayStr}::date`,
            this.customerFilter(scope),
            scope.salesmanId
              ? eq(pharmacyTradeCustomers.salesmanEmployeeId, scope.salesmanId)
              : undefined,
          )!,
        )
        .then((r) => r[0]),
    ]);

    const netCur = Math.max(0, salesCur.gross - retCur.amount);
    const netPrev = Math.max(0, salesPrev.gross - retPrev.amount);
    const aovCur = salesCur.invoices > 0 ? Math.round(netCur / salesCur.invoices) : 0;
    const aovPrev = salesPrev.invoices > 0 ? Math.round(netPrev / salesPrev.invoices) : 0;

    const achievementPct =
      salesCur.credit > 0
        ? Math.round((colCur.amount / salesCur.credit) * 10000) / 100
        : colCur.amount === 0
          ? 0
          : null;
    const achievementPrev =
      salesPrev.credit > 0
        ? Math.round((colPrev.amount / salesPrev.credit) * 10000) / 100
        : colPrev.amount === 0
          ? 0
          : null;

    const reliable = profit.coverage >= COST_COVERAGE_THRESHOLD;
    const gp = Math.max(0, profit.netSales - profit.cogs);
    const marginPct = profit.netSales > 0 ? Math.round((gp / profit.netSales) * 10000) / 100 : 0;

    const planned = n(field?.planned);
    const completed = n(field?.completed);
    const missed = Math.max(0, planned - completed);

    return {
      generatedAt: new Date().toISOString(),
      filters: {
        preset: range.preset,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        previousFrom: range.previousFrom.toISOString(),
        previousTo: range.previousTo.toISOString(),
        branchId: scope.branchId,
        warehouseId: scope.warehouseId,
        companyId: scope.companyId,
        salesmanId: scope.salesmanId,
        territoryId: scope.territoryId,
        routeId: scope.routeId,
      },
      sales: {
        gross: compare(salesCur.gross, salesPrev.gross),
        returns: compare(retCur.amount, retPrev.amount),
        net: compare(netCur, netPrev),
        cash: compare(salesCur.cash, salesPrev.cash),
        credit: compare(salesCur.credit, salesPrev.credit),
        discounts: compare(salesCur.discounts, salesPrev.discounts),
        orders: compare(ordersCur, ordersPrev),
        invoices: compare(salesCur.invoices, salesPrev.invoices),
        aov: compare(aovCur, aovPrev),
      },
      collections: {
        period: compare(colCur.amount, colPrev.amount),
        month: n(colMonth.amount),
        outstanding: n(outstanding?.outstandingPkr),
        overdue: n(overdue?.overduePkr),
        overdueCustomers: n(overdue?.overdueCustomers),
        achievementPct: {
          current: achievementPct,
          previous: achievementPrev,
          pct:
            achievementPct == null || achievementPrev == null
              ? null
              : pctDelta(achievementPct, achievementPrev),
        },
      },
      profitability: reliable
        ? {
            reliable: true as const,
            coveragePct: Math.round(profit.coverage * 10000) / 100,
            cogs: profit.cogs,
            grossProfit: gp,
            marginPct,
          }
        : {
            reliable: false as const,
            coveragePct: Math.round(profit.coverage * 10000) / 100,
          },
      inventory: {
        lowStockSkus: n(stock?.lowStockSkus),
        stockValuePkr: n(stock?.stockValuePkr),
        skuCount: n(stock?.skuCount),
        expiredBatches: n(expiry?.expiredBatches),
        nearExpiry7: n(expiry?.nearExpiry7),
        nearExpiry30: n(expiry?.nearExpiry30),
      },
      operations: {
        pendingOrders: n(orderOps?.pendingOrders),
        pendingApproval: n(orderOps?.pendingApproval),
        pendingDeliveries,
        pendingPurchaseOrders,
      },
      field: {
        planned,
        completed,
        missed,
      },
    };
  }

  async salesTrend(organizationId: string, filters: DashboardFilterInput = {}) {
    const scope = await this.resolveScope(organizationId, filters, "last30");
    const { range } = scope;
    const period = this.invPeriod(scope, range.from, range.to);
    const orderF = this.orderFilter(scope);
    const custF = this.customerFilter(scope);
    const companyF = scope.companyId ? eq(pharmacyMedicines.companyId, scope.companyId) : undefined;

    let salesQ = this.db
      .select({
        date: sql<string>`to_char(${pharmacyDistInvoices.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        sales: sql<number>`coalesce(sum(${pharmacyDistInvoiceLines.lineTotalPkr}), 0)::int`,
      })
      .from(pharmacyDistInvoiceLines)
      .innerJoin(pharmacyDistInvoices, eq(pharmacyDistInvoiceLines.invoiceId, pharmacyDistInvoices.id))
      .innerJoin(pharmacyMedicines, eq(pharmacyDistInvoiceLines.medicineId, pharmacyMedicines.id));

    if (this.needsOrderJoin(scope)) {
      salesQ = salesQ.leftJoin(
        pharmacyDistOrders,
        eq(pharmacyDistInvoices.orderId, pharmacyDistOrders.id),
      ) as typeof salesQ;
    }
    if (this.needsCustomerJoin(scope)) {
      salesQ = salesQ.innerJoin(
        pharmacyTradeCustomers,
        eq(pharmacyDistInvoices.tradeCustomerId, pharmacyTradeCustomers.id),
      ) as typeof salesQ;
    }

    const returnsParts: SQL[] = [
      this.retBase(scope),
      gte(pharmacyWholesaleReturns.createdAt, range.from),
      lte(pharmacyWholesaleReturns.createdAt, range.to),
    ];

    const [salesRows, returnRows] = await Promise.all([
      salesQ
        .where(and(period, orderF, custF, companyF)!)
        .groupBy(sql`to_char(${pharmacyDistInvoices.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`),
      this.needsCustomerJoin(scope)
        ? this.db
            .select({
              date: sql<string>`to_char(${pharmacyWholesaleReturns.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
              returns: sql<number>`coalesce(sum(${pharmacyWholesaleReturns.totalPkr}), 0)::int`,
            })
            .from(pharmacyWholesaleReturns)
            .innerJoin(
              pharmacyTradeCustomers,
              eq(pharmacyWholesaleReturns.tradeCustomerId, pharmacyTradeCustomers.id),
            )
            .where(and(...returnsParts, this.customerFilter(scope))!)
            .groupBy(sql`to_char(${pharmacyWholesaleReturns.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`)
        : this.db
            .select({
              date: sql<string>`to_char(${pharmacyWholesaleReturns.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
              returns: sql<number>`coalesce(sum(${pharmacyWholesaleReturns.totalPkr}), 0)::int`,
            })
            .from(pharmacyWholesaleReturns)
            .where(and(...returnsParts)!)
            .groupBy(sql`to_char(${pharmacyWholesaleReturns.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`),
    ]);

    const salesMap = new Map(salesRows.map((r) => [r.date, n(r.sales)]));
    const retMap = new Map(returnRows.map((r) => [r.date, n(r.returns)]));
    const points: { date: string; sales: number; returns: number; netSales: number }[] = [];
    for (let d = startOfDay(range.from); d <= range.to; d = addDays(d, 1)) {
      const key = dateStr(d);
      const sales = salesMap.get(key) ?? 0;
      const returns = retMap.get(key) ?? 0;
      points.push({ date: key, sales, returns, netSales: Math.max(0, sales - returns) });
    }

    return {
      generatedAt: new Date().toISOString(),
      preset: range.preset,
      from: range.fromDate,
      to: range.toDate,
      points,
    };
  }

  async topProducts(organizationId: string, filters: DashboardFilterInput = {}) {
    const scope = await this.resolveScope(organizationId, filters, "today");
    const limit = clampLimit(filters.limit, 10);
    const period = this.invPeriod(scope, scope.range.from, scope.range.to);
    const orderF = this.orderFilter(scope);
    const custF = this.customerFilter(scope);
    const companyF = scope.companyId ? eq(pharmacyMedicines.companyId, scope.companyId) : undefined;

    let q = this.db
      .select({
        medicineId: pharmacyMedicines.id,
        name: pharmacyMedicines.name,
        sku: pharmacyMedicines.sku,
        quantity: sql<number>`coalesce(sum(${pharmacyDistInvoiceLines.quantity}), 0)::int`,
        netSales: sql<number>`coalesce(sum(${pharmacyDistInvoiceLines.lineTotalPkr}), 0)::int`,
        coveredSales: sql<number>`coalesce(sum(case when coalesce(${pharmacyMedicineBatches.purchaseRatePkr}, ${pharmacyMedicines.costPricePkr}, 0) > 0 then ${pharmacyDistInvoiceLines.lineTotalPkr} else 0 end), 0)::int`,
        cogs: sql<number>`coalesce(sum(${pharmacyDistInvoiceLines.quantity} * coalesce(${pharmacyMedicineBatches.purchaseRatePkr}, ${pharmacyMedicines.costPricePkr}, 0)), 0)::int`,
      })
      .from(pharmacyDistInvoiceLines)
      .innerJoin(pharmacyDistInvoices, eq(pharmacyDistInvoiceLines.invoiceId, pharmacyDistInvoices.id))
      .innerJoin(pharmacyMedicines, eq(pharmacyDistInvoiceLines.medicineId, pharmacyMedicines.id))
      .leftJoin(pharmacyMedicineBatches, eq(pharmacyDistInvoiceLines.batchId, pharmacyMedicineBatches.id));

    if (this.needsOrderJoin(scope)) {
      q = q.leftJoin(pharmacyDistOrders, eq(pharmacyDistInvoices.orderId, pharmacyDistOrders.id)) as typeof q;
    }
    if (this.needsCustomerJoin(scope)) {
      q = q.innerJoin(
        pharmacyTradeCustomers,
        eq(pharmacyDistInvoices.tradeCustomerId, pharmacyTradeCustomers.id),
      ) as typeof q;
    }

    const rows = await q
      .where(and(period, orderF, custF, companyF)!)
      .groupBy(pharmacyMedicines.id, pharmacyMedicines.name, pharmacyMedicines.sku)
      .orderBy(sql`sum(${pharmacyDistInvoiceLines.lineTotalPkr}) desc`)
      .limit(limit);

    const totalCovered = rows.reduce((s, r) => s + n(r.coveredSales), 0);
    const totalSales = rows.reduce((s, r) => s + n(r.netSales), 0);
    const reliable = totalSales === 0 ? true : totalCovered / totalSales >= COST_COVERAGE_THRESHOLD;

    return {
      generatedAt: new Date().toISOString(),
      reliable,
      items: rows.map((r) => {
        const netSales = n(r.netSales);
        const cogs = n(r.cogs);
        const profit = netSales - cogs;
        const base = {
          medicineId: r.medicineId,
          name: r.name,
          sku: r.sku,
          quantity: n(r.quantity),
          netSales,
          href: `/pops/pharmacy/medicines?focus=${r.medicineId}`,
        };
        if (!reliable) return base;
        return {
          ...base,
          cogs,
          profit,
          marginPct: netSales > 0 ? Math.round((profit / netSales) * 10000) / 100 : 0,
        };
      }),
    };
  }

  async topCustomers(organizationId: string, filters: DashboardFilterInput = {}) {
    const scope = await this.resolveScope(organizationId, filters, "today");
    const limit = clampLimit(filters.limit, 10);
    const period = this.invPeriod(scope, scope.range.from, scope.range.to);
    const orderF = this.orderFilter(scope);
    const custF = this.customerFilter(scope);
    const todayStr = dateStr(scope.range.todayStart);

    const salesPromise = (async () => {
      if (scope.companyId) {
        let lineQ = this.db
          .select({
            tradeCustomerId: pharmacyTradeCustomers.id,
            name: pharmacyTradeCustomers.name,
            code: pharmacyTradeCustomers.code,
            sales: sql<number>`coalesce(sum(${pharmacyDistInvoiceLines.lineTotalPkr}), 0)::int`,
            outstanding: pharmacyTradeCustomers.outstandingPkr,
            creditDays: pharmacyTradeCustomers.creditDays,
          })
          .from(pharmacyDistInvoiceLines)
          .innerJoin(pharmacyDistInvoices, eq(pharmacyDistInvoiceLines.invoiceId, pharmacyDistInvoices.id))
          .innerJoin(pharmacyMedicines, eq(pharmacyDistInvoiceLines.medicineId, pharmacyMedicines.id))
          .innerJoin(
            pharmacyTradeCustomers,
            eq(pharmacyDistInvoices.tradeCustomerId, pharmacyTradeCustomers.id),
          );
        if (this.needsOrderJoin(scope)) {
          lineQ = lineQ.leftJoin(
            pharmacyDistOrders,
            eq(pharmacyDistInvoices.orderId, pharmacyDistOrders.id),
          ) as typeof lineQ;
        }
        return lineQ
          .where(and(period, orderF, custF, eq(pharmacyMedicines.companyId, scope.companyId))!)
          .groupBy(
            pharmacyTradeCustomers.id,
            pharmacyTradeCustomers.name,
            pharmacyTradeCustomers.code,
            pharmacyTradeCustomers.outstandingPkr,
            pharmacyTradeCustomers.creditDays,
          )
          .orderBy(sql`sum(${pharmacyDistInvoiceLines.lineTotalPkr}) desc`)
          .limit(limit);
      }

      let salesQ = this.db
        .select({
          tradeCustomerId: pharmacyTradeCustomers.id,
          name: pharmacyTradeCustomers.name,
          code: pharmacyTradeCustomers.code,
          sales: sql<number>`coalesce(sum(${pharmacyDistInvoices.totalPkr}), 0)::int`,
          outstanding: pharmacyTradeCustomers.outstandingPkr,
          creditDays: pharmacyTradeCustomers.creditDays,
        })
        .from(pharmacyDistInvoices)
        .innerJoin(
          pharmacyTradeCustomers,
          eq(pharmacyDistInvoices.tradeCustomerId, pharmacyTradeCustomers.id),
        );
      if (this.needsOrderJoin(scope)) {
        salesQ = salesQ.leftJoin(
          pharmacyDistOrders,
          eq(pharmacyDistInvoices.orderId, pharmacyDistOrders.id),
        ) as typeof salesQ;
      }
      return salesQ
        .where(and(period, orderF, custF)!)
        .groupBy(
          pharmacyTradeCustomers.id,
          pharmacyTradeCustomers.name,
          pharmacyTradeCustomers.code,
          pharmacyTradeCustomers.outstandingPkr,
          pharmacyTradeCustomers.creditDays,
        )
        .orderBy(sql`sum(${pharmacyDistInvoices.totalPkr}) desc`)
        .limit(limit);
    })();

    const [itemsSource, returnRows, collectionRows, overdueRows] = await Promise.all([
      salesPromise,
      this.db
        .select({
          tradeCustomerId: pharmacyWholesaleReturns.tradeCustomerId,
          returns: sql<number>`coalesce(sum(${pharmacyWholesaleReturns.totalPkr}), 0)::int`,
        })
        .from(pharmacyWholesaleReturns)
        .innerJoin(
          pharmacyTradeCustomers,
          eq(pharmacyWholesaleReturns.tradeCustomerId, pharmacyTradeCustomers.id),
        )
        .where(
          and(
            this.retBase(scope),
            gte(pharmacyWholesaleReturns.createdAt, scope.range.from),
            lte(pharmacyWholesaleReturns.createdAt, scope.range.to),
            custF,
          )!,
        )
        .groupBy(pharmacyWholesaleReturns.tradeCustomerId),
      this.db
        .select({
          tradeCustomerId: pharmacyCollections.tradeCustomerId,
          collections: sql<number>`coalesce(sum(${pharmacyCollections.amountPkr}), 0)::int`,
        })
        .from(pharmacyCollections)
        .innerJoin(
          pharmacyTradeCustomers,
          eq(pharmacyCollections.tradeCustomerId, pharmacyTradeCustomers.id),
        )
        .where(
          and(
            this.colBase(scope),
            gte(pharmacyCollections.createdAt, scope.range.from),
            lte(pharmacyCollections.createdAt, scope.range.to),
            custF,
          )!,
        )
        .groupBy(pharmacyCollections.tradeCustomerId),
      this.db
        .select({
          tradeCustomerId: pharmacyDistInvoices.tradeCustomerId,
          overdue: sql<number>`coalesce(sum(${pharmacyDistInvoices.amountDuePkr}), 0)::int`,
        })
        .from(pharmacyDistInvoices)
        .innerJoin(
          pharmacyTradeCustomers,
          eq(pharmacyDistInvoices.tradeCustomerId, pharmacyTradeCustomers.id),
        )
        .where(
          and(
            this.invBase(scope),
            sql`${pharmacyDistInvoices.amountDuePkr} > 0`,
            sql`(${pharmacyDistInvoices.invoiceDate}::date + coalesce(${pharmacyTradeCustomers.creditDays}, 30)) < ${todayStr}::date`,
            custF,
          )!,
        )
        .groupBy(pharmacyDistInvoices.tradeCustomerId),
    ]);

    const retMap = new Map(returnRows.map((r) => [r.tradeCustomerId, n(r.returns)]));
    const colMap = new Map(collectionRows.map((r) => [r.tradeCustomerId, n(r.collections)]));
    const overdueMap = new Map(overdueRows.map((r) => [r.tradeCustomerId, n(r.overdue)]));

    return {
      generatedAt: new Date().toISOString(),
      items: itemsSource.map((r) => {
        const sales = n(r.sales);
        const returns = retMap.get(r.tradeCustomerId) ?? 0;
        return {
          tradeCustomerId: r.tradeCustomerId,
          name: r.name,
          code: r.code,
          sales,
          returns,
          net: Math.max(0, sales - returns),
          collections: colMap.get(r.tradeCustomerId) ?? 0,
          outstanding: n(r.outstanding),
          overdue: (overdueMap.get(r.tradeCustomerId) ?? 0) > 0,
          href: `/pops/distribution/trade-customers?focus=${r.tradeCustomerId}`,
        };
      }),
    };
  }

  async companyPerformance(organizationId: string, filters: DashboardFilterInput = {}) {
    const scope = await this.resolveScope(organizationId, filters, "today");
    const period = this.invPeriod(scope, scope.range.from, scope.range.to);
    const orderF = this.orderFilter(scope);
    const custF = this.customerFilter(scope);
    const companyF = scope.companyId ? eq(pharmacyCompanies.id, scope.companyId) : undefined;

    let q = this.db
      .select({
        companyId: pharmacyCompanies.id,
        name: pharmacyCompanies.name,
        code: pharmacyCompanies.code,
        quantity: sql<number>`coalesce(sum(${pharmacyDistInvoiceLines.quantity}), 0)::int`,
        netSales: sql<number>`coalesce(sum(${pharmacyDistInvoiceLines.lineTotalPkr}), 0)::int`,
        invoices: sql<number>`count(distinct ${pharmacyDistInvoices.id})::int`,
      })
      .from(pharmacyDistInvoiceLines)
      .innerJoin(pharmacyDistInvoices, eq(pharmacyDistInvoiceLines.invoiceId, pharmacyDistInvoices.id))
      .innerJoin(pharmacyMedicines, eq(pharmacyDistInvoiceLines.medicineId, pharmacyMedicines.id))
      .innerJoin(pharmacyCompanies, eq(pharmacyMedicines.companyId, pharmacyCompanies.id));

    if (this.needsOrderJoin(scope)) {
      q = q.leftJoin(pharmacyDistOrders, eq(pharmacyDistInvoices.orderId, pharmacyDistOrders.id)) as typeof q;
    }
    if (this.needsCustomerJoin(scope)) {
      q = q.innerJoin(
        pharmacyTradeCustomers,
        eq(pharmacyDistInvoices.tradeCustomerId, pharmacyTradeCustomers.id),
      ) as typeof q;
    }

    const rows = await q
      .where(and(period, orderF, custF, companyF)!)
      .groupBy(pharmacyCompanies.id, pharmacyCompanies.name, pharmacyCompanies.code)
      .orderBy(sql`sum(${pharmacyDistInvoiceLines.lineTotalPkr}) desc`);

    return {
      generatedAt: new Date().toISOString(),
      items: rows.map((r) => ({
        companyId: r.companyId,
        name: r.name,
        code: r.code,
        quantity: n(r.quantity),
        netSales: n(r.netSales),
        invoices: n(r.invoices),
        href: `/pops/pharmacy/companies?focus=${r.companyId}`,
      })),
    };
  }

  async salesmen(organizationId: string, filters: DashboardFilterInput = {}) {
    const scope = await this.resolveScope(organizationId, filters, "today");
    const period = this.invPeriod(scope, scope.range.from, scope.range.to);
    const custF = this.customerFilter(scope);
    const companyF = scope.companyId ? eq(pharmacyMedicines.companyId, scope.companyId) : undefined;

    let salesQ = this.db
      .select({
        employeeId: pharmacyDistOrders.salesmanEmployeeId,
        name: popsEmployees.displayName,
        sales: sql<number>`coalesce(sum(${pharmacyDistInvoiceLines.lineTotalPkr}), 0)::int`,
        invoices: sql<number>`count(distinct ${pharmacyDistInvoices.id})::int`,
      })
      .from(pharmacyDistInvoiceLines)
      .innerJoin(pharmacyDistInvoices, eq(pharmacyDistInvoiceLines.invoiceId, pharmacyDistInvoices.id))
      .innerJoin(pharmacyDistOrders, eq(pharmacyDistInvoices.orderId, pharmacyDistOrders.id))
      .innerJoin(popsEmployees, eq(pharmacyDistOrders.salesmanEmployeeId, popsEmployees.id))
      .innerJoin(pharmacyMedicines, eq(pharmacyDistInvoiceLines.medicineId, pharmacyMedicines.id));

    if (this.needsCustomerJoin(scope)) {
      salesQ = salesQ.innerJoin(
        pharmacyTradeCustomers,
        eq(pharmacyDistInvoices.tradeCustomerId, pharmacyTradeCustomers.id),
      ) as typeof salesQ;
    }

    const salesWhere = and(
      period,
      eq(pharmacyDistOrders.organizationId, organizationId),
      scope.branchId ? eq(pharmacyDistOrders.branchId, scope.branchId) : undefined,
      scope.warehouseId ? eq(pharmacyDistOrders.warehouseId, scope.warehouseId) : undefined,
      scope.salesmanId ? eq(pharmacyDistOrders.salesmanEmployeeId, scope.salesmanId) : undefined,
      sql`${pharmacyDistOrders.salesmanEmployeeId} is not null`,
      custF,
      companyF,
    )!;

    const [salesRows, collectionRows, targetRows] = await Promise.all([
      salesQ
        .where(salesWhere)
        .groupBy(pharmacyDistOrders.salesmanEmployeeId, popsEmployees.displayName)
        .orderBy(sql`sum(${pharmacyDistInvoiceLines.lineTotalPkr}) desc`),
      this.db
        .select({
          employeeId: pharmacyCollections.salesmanEmployeeId,
          collections: sql<number>`coalesce(sum(${pharmacyCollections.amountPkr}), 0)::int`,
        })
        .from(pharmacyCollections)
        .where(
          and(
            this.colBase(scope),
            gte(pharmacyCollections.createdAt, scope.range.from),
            lte(pharmacyCollections.createdAt, scope.range.to),
            sql`${pharmacyCollections.salesmanEmployeeId} is not null`,
          )!,
        )
        .groupBy(pharmacyCollections.salesmanEmployeeId),
      this.db
        .select({
          employeeId: pharmacyTargets.employeeId,
          targetSalesPkr: sql<number>`coalesce(sum(${pharmacyTargets.targetSalesPkr}), 0)::int`,
        })
        .from(pharmacyTargets)
        .where(
          and(
            eq(pharmacyTargets.organizationId, organizationId),
            sql`${pharmacyTargets.employeeId} is not null`,
            lte(pharmacyTargets.periodStart, scope.range.toDate),
            gte(pharmacyTargets.periodEnd, scope.range.fromDate),
            scope.salesmanId ? eq(pharmacyTargets.employeeId, scope.salesmanId) : undefined,
            scope.companyId ? eq(pharmacyTargets.companyId, scope.companyId) : undefined,
          )!,
        )
        .groupBy(pharmacyTargets.employeeId),
    ]);

    const colMap = new Map(collectionRows.map((r) => [r.employeeId, n(r.collections)]));
    const targetMap = new Map(targetRows.map((r) => [r.employeeId, n(r.targetSalesPkr)]));

    return {
      generatedAt: new Date().toISOString(),
      items: salesRows.map((r) => {
        const employeeId = r.employeeId!;
        const sales = n(r.sales);
        const target = targetMap.get(employeeId) ?? 0;
        const achievementPct = target === 0 ? null : Math.round((sales / target) * 10000) / 100;
        return {
          employeeId,
          name: r.name,
          sales,
          invoices: n(r.invoices),
          collections: colMap.get(employeeId) ?? 0,
          target,
          achievementPct,
          achievementLabel: achievementPct == null ? "N/A" : `${achievementPct}%`,
        };
      }),
    };
  }

  async actionCenter(organizationId: string, filters: DashboardFilterInput = {}) {
    const scope = await this.resolveScope(organizationId, filters, "today");
    const todayStr = dateStr(scope.range.todayStart);
    const in30 = dateStr(addDays(scope.range.todayStart, 30));

    const custParts: SQL[] = [eq(pharmacyTradeCustomers.organizationId, organizationId)];
    if (scope.branchId) custParts.push(eq(pharmacyTradeCustomers.branchId, scope.branchId));
    if (scope.territoryId) custParts.push(eq(pharmacyTradeCustomers.territoryId, scope.territoryId));
    if (scope.routeId) custParts.push(eq(pharmacyTradeCustomers.routeId, scope.routeId));
    if (scope.salesmanId) custParts.push(eq(pharmacyTradeCustomers.salesmanEmployeeId, scope.salesmanId));

    const [
      pendingApproval,
      creditExceeded,
      lowStock,
      nearExpiry,
      expired,
      overdueCustomers,
      pendingDeliveries,
      openDueInvoices,
      pendingPo,
      creditOverrides,
    ] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(pharmacyDistOrders)
        .where(and(this.orderBase(scope), sql`${pharmacyDistOrders.status} in ('booked','submitted')`)!)
        .then((r) => n(r[0]?.count)),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(pharmacyTradeCustomers)
        .where(
          and(
            ...custParts,
            sql`${pharmacyTradeCustomers.creditLimitPkr} > 0`,
            sql`${pharmacyTradeCustomers.outstandingPkr} > ${pharmacyTradeCustomers.creditLimitPkr}`,
          )!,
        )
        .then((r) => n(r[0]?.count)),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(pharmacyMedicines)
        .where(
          and(
            this.medBase(scope),
            eq(pharmacyMedicines.status, "active"),
            sql`${pharmacyMedicines.currentStock} <= ${pharmacyMedicines.reorderLevel}`,
          )!,
        )
        .then((r) => n(r[0]?.count)),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(pharmacyMedicineBatches)
        .innerJoin(pharmacyMedicines, eq(pharmacyMedicineBatches.medicineId, pharmacyMedicines.id))
        .where(
          and(
            this.medBase(scope),
            scope.warehouseId ? eq(pharmacyMedicineBatches.warehouseId, scope.warehouseId) : undefined,
            sql`${pharmacyMedicineBatches.expiryDate} >= ${todayStr}`,
            sql`${pharmacyMedicineBatches.expiryDate} <= ${in30}`,
            sql`${pharmacyMedicineBatches.quantity} >= 1`,
          )!,
        )
        .then((r) => n(r[0]?.count)),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(pharmacyMedicineBatches)
        .innerJoin(pharmacyMedicines, eq(pharmacyMedicineBatches.medicineId, pharmacyMedicines.id))
        .where(
          and(
            this.medBase(scope),
            scope.warehouseId ? eq(pharmacyMedicineBatches.warehouseId, scope.warehouseId) : undefined,
            sql`${pharmacyMedicineBatches.expiryDate} < ${todayStr}`,
            sql`${pharmacyMedicineBatches.quantity} >= 1`,
          )!,
        )
        .then((r) => n(r[0]?.count)),
      this.db
        .select({ count: sql<number>`count(distinct ${pharmacyDistInvoices.tradeCustomerId})::int` })
        .from(pharmacyDistInvoices)
        .innerJoin(
          pharmacyTradeCustomers,
          eq(pharmacyDistInvoices.tradeCustomerId, pharmacyTradeCustomers.id),
        )
        .where(
          and(
            this.invBase(scope),
            sql`${pharmacyDistInvoices.amountDuePkr} > 0`,
            sql`(${pharmacyDistInvoices.invoiceDate}::date + coalesce(${pharmacyTradeCustomers.creditDays}, 30)) < ${todayStr}::date`,
            this.customerFilter(scope),
          )!,
        )
        .then((r) => n(r[0]?.count)),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(pharmacyDeliveries)
        .where(and(this.delBase(scope), sql`${pharmacyDeliveries.status} not in ('delivered','cancelled')`)!)
        .then((r) => n(r[0]?.count)),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(pharmacyDistInvoices)
        .where(and(this.invBase(scope), sql`${pharmacyDistInvoices.amountDuePkr} > 0`)!)
        .then((r) => n(r[0]?.count)),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(pharmacyPurchaseOrders)
        .where(
          and(
            eq(pharmacyPurchaseOrders.organizationId, organizationId),
            scope.branchId ? eq(pharmacyPurchaseOrders.branchId, scope.branchId) : undefined,
            sql`${pharmacyPurchaseOrders.status} in ('draft','approved')`,
          )!,
        )
        .then((r) => n(r[0]?.count)),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(pharmacyDistOrders)
        .where(
          and(
            this.orderBase(scope),
            eq(pharmacyDistOrders.creditOverride, true),
            gte(pharmacyDistOrders.createdAt, scope.range.todayStart),
          )!,
        )
        .then((r) => n(r[0]?.count)),
    ]);

    type ActionItem = {
      id: string;
      severity: "CRITICAL" | "WARNING" | "INFO";
      title: string;
      count: number;
      description: string;
      href: string;
    };

    const items: ActionItem[] = [];
    const push = (
      id: string,
      severity: ActionItem["severity"],
      title: string,
      count: number,
      description: string,
      href: string,
    ) => {
      if (count > 0) items.push({ id, severity, title, count, description, href });
    };

    push(
      "expired",
      "CRITICAL",
      "Expired stock batches",
      expired,
      "Batches past expiry still holding quantity",
      "/pops/distribution/expiry?focus=expired",
    );
    push(
      "credit-exceeded",
      "CRITICAL",
      "Credit limit exceeded",
      creditExceeded,
      "Trade customers above credit limit",
      "/pops/distribution/aging?focus=creditExceeded",
    );
    push(
      "overdue",
      "CRITICAL",
      "Overdue receivables",
      overdueCustomers,
      "Customers with invoices past credit days",
      "/pops/distribution/aging?focus=overdue",
    );
    push(
      "pending-approval",
      "WARNING",
      "Orders pending approval",
      pendingApproval,
      "Booked/submitted orders awaiting approval",
      "/pops/distribution/orders?focus=pendingApproval",
    );
    push(
      "credit-override",
      "WARNING",
      "Credit overrides today",
      creditOverrides,
      "Orders placed with credit override today",
      "/pops/distribution/orders?focus=creditOverride",
    );
    push(
      "low-stock",
      "WARNING",
      "Low stock SKUs",
      lowStock,
      "Active medicines at or below reorder level",
      "/pops/distribution/inventory?focus=lowStock",
    );
    push(
      "near-expiry",
      "WARNING",
      "Near expiry (30d)",
      nearExpiry,
      "Batches expiring within 30 days",
      "/pops/distribution/expiry?focus=near",
    );
    push(
      "pending-delivery",
      "INFO",
      "Pending deliveries",
      pendingDeliveries,
      "Deliveries not yet delivered or cancelled",
      "/pops/distribution/deliveries?focus=pending",
    );
    push(
      "open-dues",
      "INFO",
      "Open invoice dues",
      openDueInvoices,
      "Invoices with remaining amount due",
      "/pops/distribution/collections",
    );
    push(
      "pending-po",
      "INFO",
      "Pending purchase orders",
      pendingPo,
      "Draft or approved POs not fully received",
      "/pops/distribution/purchase-orders?focus=pending",
    );

    const groups = {
      CRITICAL: items.filter((i) => i.severity === "CRITICAL"),
      WARNING: items.filter((i) => i.severity === "WARNING"),
      INFO: items.filter((i) => i.severity === "INFO"),
    };

    return {
      generatedAt: new Date().toISOString(),
      groups,
      items,
    };
  }

  async stockHealth(organizationId: string, filters: DashboardFilterInput = {}) {
    const scope = await this.resolveScope(organizationId, filters, "today");
    const todayStr = dateStr(scope.range.todayStart);
    const in7 = dateStr(addDays(scope.range.todayStart, 7));
    const in30 = dateStr(addDays(scope.range.todayStart, 30));
    const in60 = dateStr(addDays(scope.range.todayStart, 60));
    const in90 = dateStr(addDays(scope.range.todayStart, 90));

    const batchWhere = and(
      this.medBase(scope),
      scope.warehouseId ? eq(pharmacyMedicineBatches.warehouseId, scope.warehouseId) : undefined,
    )!;

    const [stock, expiry, outOfStock] = await Promise.all([
      this.db
        .select({
          lowStockSkus: sql<number>`count(*) filter (where ${pharmacyMedicines.status} = 'active' and ${pharmacyMedicines.currentStock} <= ${pharmacyMedicines.reorderLevel} and ${pharmacyMedicines.currentStock} > 0)::int`,
          stockValuePkr: sql<number>`coalesce(sum(${pharmacyMedicines.currentStock} * ${pharmacyMedicines.costPricePkr}), 0)::int`,
          skuCount: sql<number>`count(*) filter (where ${pharmacyMedicines.status} = 'active')::int`,
          totalUnits: sql<number>`coalesce(sum(${pharmacyMedicines.currentStock}), 0)::int`,
        })
        .from(pharmacyMedicines)
        .where(this.medBase(scope))
        .then((r) => r[0]),
      this.db
        .select({
          expired: sql<number>`count(*) filter (where ${pharmacyMedicineBatches.expiryDate} < ${todayStr} and ${pharmacyMedicineBatches.quantity} >= 1)::int`,
          d0to7: sql<number>`count(*) filter (where ${pharmacyMedicineBatches.expiryDate} >= ${todayStr} and ${pharmacyMedicineBatches.expiryDate} <= ${in7} and ${pharmacyMedicineBatches.quantity} >= 1)::int`,
          d8to30: sql<number>`count(*) filter (where ${pharmacyMedicineBatches.expiryDate} > ${in7} and ${pharmacyMedicineBatches.expiryDate} <= ${in30} and ${pharmacyMedicineBatches.quantity} >= 1)::int`,
          d31to60: sql<number>`count(*) filter (where ${pharmacyMedicineBatches.expiryDate} > ${in30} and ${pharmacyMedicineBatches.expiryDate} <= ${in60} and ${pharmacyMedicineBatches.quantity} >= 1)::int`,
          d61to90: sql<number>`count(*) filter (where ${pharmacyMedicineBatches.expiryDate} > ${in60} and ${pharmacyMedicineBatches.expiryDate} <= ${in90} and ${pharmacyMedicineBatches.quantity} >= 1)::int`,
          expiredValuePkr: sql<number>`coalesce(sum((${pharmacyMedicineBatches.quantity}) * (${pharmacyMedicineBatches.purchaseRatePkr})) filter (where ${pharmacyMedicineBatches.expiryDate} < ${todayStr} and ${pharmacyMedicineBatches.quantity} >= 1), 0)::int`,
          nearExpiryValuePkr: sql<number>`coalesce(sum((${pharmacyMedicineBatches.quantity}) * (${pharmacyMedicineBatches.purchaseRatePkr})) filter (where ${pharmacyMedicineBatches.expiryDate} >= ${todayStr} and ${pharmacyMedicineBatches.expiryDate} <= ${in30} and ${pharmacyMedicineBatches.quantity} >= 1), 0)::int`,
        })
        .from(pharmacyMedicineBatches)
        .innerJoin(pharmacyMedicines, eq(pharmacyMedicineBatches.medicineId, pharmacyMedicines.id))
        .where(batchWhere)
        .then((r) => r[0]),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(pharmacyMedicines)
        .where(
          and(
            this.medBase(scope),
            eq(pharmacyMedicines.status, "active"),
            sql`${pharmacyMedicines.currentStock} <= 0`,
          )!,
        )
        .then((r) => n(r[0]?.count)),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      skuCount: n(stock?.skuCount),
      totalUnits: n(stock?.totalUnits),
      stockValuePkr: n(stock?.stockValuePkr),
      lowStockSkus: n(stock?.lowStockSkus),
      outOfStockSkus: outOfStock,
      expiry: {
        expired: n(expiry?.expired),
        d0to7: n(expiry?.d0to7),
        d8to30: n(expiry?.d8to30),
        d31to60: n(expiry?.d31to60),
        d61to90: n(expiry?.d61to90),
        expiredValuePkr: n(expiry?.expiredValuePkr),
        nearExpiryValuePkr: n(expiry?.nearExpiryValuePkr),
      },
    };
  }

  async recovery(organizationId: string, filters: DashboardFilterInput = {}) {
    const scope = await this.resolveScope(organizationId, filters, "today");
    const todayStr = dateStr(scope.range.todayStart);
    const d30 = dateStr(addDays(scope.range.todayStart, -30));
    const d60 = dateStr(addDays(scope.range.todayStart, -60));
    const d90 = dateStr(addDays(scope.range.todayStart, -90));
    const d120 = dateStr(addDays(scope.range.todayStart, -120));
    const custF = this.customerFilter(scope);

    const dueWhere = and(
      this.invBase(scope),
      sql`${pharmacyDistInvoices.amountDuePkr} > 0`,
      custF,
      scope.salesmanId ? eq(pharmacyTradeCustomers.salesmanEmployeeId, scope.salesmanId) : undefined,
    )!;

    const [aging, todayCol, monthCol, overdue] = await Promise.all([
      this.db
        .select({
          currentAmount: sql<number>`coalesce(sum(${pharmacyDistInvoices.amountDuePkr}) filter (where ${pharmacyDistInvoices.invoiceDate}::date >= ${d30}), 0)::int`,
          currentCustomers: sql<number>`count(distinct ${pharmacyDistInvoices.tradeCustomerId}) filter (where ${pharmacyDistInvoices.invoiceDate}::date >= ${d30})::int`,
          d31to60Amount: sql<number>`coalesce(sum(${pharmacyDistInvoices.amountDuePkr}) filter (where ${pharmacyDistInvoices.invoiceDate}::date < ${d30} and ${pharmacyDistInvoices.invoiceDate}::date >= ${d60}), 0)::int`,
          d31to60Customers: sql<number>`count(distinct ${pharmacyDistInvoices.tradeCustomerId}) filter (where ${pharmacyDistInvoices.invoiceDate}::date < ${d30} and ${pharmacyDistInvoices.invoiceDate}::date >= ${d60})::int`,
          d61to90Amount: sql<number>`coalesce(sum(${pharmacyDistInvoices.amountDuePkr}) filter (where ${pharmacyDistInvoices.invoiceDate}::date < ${d60} and ${pharmacyDistInvoices.invoiceDate}::date >= ${d90}), 0)::int`,
          d61to90Customers: sql<number>`count(distinct ${pharmacyDistInvoices.tradeCustomerId}) filter (where ${pharmacyDistInvoices.invoiceDate}::date < ${d60} and ${pharmacyDistInvoices.invoiceDate}::date >= ${d90})::int`,
          d91to120Amount: sql<number>`coalesce(sum(${pharmacyDistInvoices.amountDuePkr}) filter (where ${pharmacyDistInvoices.invoiceDate}::date < ${d90} and ${pharmacyDistInvoices.invoiceDate}::date >= ${d120}), 0)::int`,
          d91to120Customers: sql<number>`count(distinct ${pharmacyDistInvoices.tradeCustomerId}) filter (where ${pharmacyDistInvoices.invoiceDate}::date < ${d90} and ${pharmacyDistInvoices.invoiceDate}::date >= ${d120})::int`,
          d120plusAmount: sql<number>`coalesce(sum(${pharmacyDistInvoices.amountDuePkr}) filter (where ${pharmacyDistInvoices.invoiceDate}::date < ${d120}), 0)::int`,
          d120plusCustomers: sql<number>`count(distinct ${pharmacyDistInvoices.tradeCustomerId}) filter (where ${pharmacyDistInvoices.invoiceDate}::date < ${d120})::int`,
        })
        .from(pharmacyDistInvoices)
        .innerJoin(
          pharmacyTradeCustomers,
          eq(pharmacyDistInvoices.tradeCustomerId, pharmacyTradeCustomers.id),
        )
        .where(dueWhere)
        .then((r) => r[0]),
      this.collectionsAgg(scope, scope.range.todayStart, endOfDay(new Date())),
      this.collectionsAgg(scope, scope.range.monthStart, endOfDay(new Date())),
      this.db
        .select({
          overdueAmount: sql<number>`coalesce(sum(${pharmacyDistInvoices.amountDuePkr}), 0)::int`,
          overdueCustomers: sql<number>`count(distinct ${pharmacyDistInvoices.tradeCustomerId})::int`,
        })
        .from(pharmacyDistInvoices)
        .innerJoin(
          pharmacyTradeCustomers,
          eq(pharmacyDistInvoices.tradeCustomerId, pharmacyTradeCustomers.id),
        )
        .where(
          and(
            dueWhere,
            sql`(${pharmacyDistInvoices.invoiceDate}::date + coalesce(${pharmacyTradeCustomers.creditDays}, 30)) < ${todayStr}::date`,
          )!,
        )
        .then((r) => r[0]),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      aging: [
        {
          bucket: "current_0_30",
          amount: n(aging?.currentAmount),
          customers: n(aging?.currentCustomers),
        },
        {
          bucket: "d31_60",
          amount: n(aging?.d31to60Amount),
          customers: n(aging?.d31to60Customers),
        },
        {
          bucket: "d61_90",
          amount: n(aging?.d61to90Amount),
          customers: n(aging?.d61to90Customers),
        },
        {
          bucket: "d91_120",
          amount: n(aging?.d91to120Amount),
          customers: n(aging?.d91to120Customers),
        },
        {
          bucket: "d120_plus",
          amount: n(aging?.d120plusAmount),
          customers: n(aging?.d120plusCustomers),
        },
      ],
      collectionToday: todayCol.amount,
      collectionMonth: monthCol.amount,
      overdueAmount: n(overdue?.overdueAmount),
      overdueCustomers: n(overdue?.overdueCustomers),
    };
  }

  async deliveries(organizationId: string, filters: DashboardFilterInput = {}) {
    const scope = await this.resolveScope(organizationId, filters, "today");
    const where = and(
      this.delBase(scope),
      gte(pharmacyDeliveries.createdAt, scope.range.from),
      lte(pharmacyDeliveries.createdAt, scope.range.to),
    )!;

    const [byStatus, totals] = await Promise.all([
      this.db
        .select({
          status: pharmacyDeliveries.status,
          count: sql<number>`count(*)::int`,
          collectedPkr: sql<number>`coalesce(sum(${pharmacyDeliveries.collectedPkr}), 0)::int`,
        })
        .from(pharmacyDeliveries)
        .where(where)
        .groupBy(pharmacyDeliveries.status)
        .orderBy(sql`count(*) desc`),
      this.db
        .select({
          total: sql<number>`count(*)::int`,
          collectedPkr: sql<number>`coalesce(sum(${pharmacyDeliveries.collectedPkr}), 0)::int`,
        })
        .from(pharmacyDeliveries)
        .where(where)
        .then((r) => r[0]),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      total: n(totals?.total),
      collectedPkr: n(totals?.collectedPkr),
      byStatus: byStatus.map((r) => ({
        status: r.status,
        count: n(r.count),
        collectedPkr: n(r.collectedPkr),
      })),
    };
  }

  async fieldForce(organizationId: string, filters: DashboardFilterInput = {}) {
    const scope = await this.resolveScope(organizationId, filters, "today");
    const { range } = scope;

    const assignParts: SQL[] = [
      eq(pharmacyAssignments.organizationId, organizationId),
      gte(pharmacyAssignments.assignmentDate, range.fromDate),
      lte(pharmacyAssignments.assignmentDate, range.toDate),
    ];
    if (scope.branchId) assignParts.push(eq(pharmacyAssignments.branchId, scope.branchId));
    if (scope.salesmanId) assignParts.push(eq(pharmacyAssignments.employeeId, scope.salesmanId));
    if (scope.routeId) assignParts.push(eq(pharmacyAssignments.routeId, scope.routeId));
    const assignWhere = and(...assignParts)!;

    const [summary, perSalesman, salesByEmp, colByEmp] = await Promise.all([
      this.db
        .select({
          planned: sql<number>`count(distinct ${pharmacyAssignments.id})::int`,
          completed: sql<number>`count(distinct ${pharmacyAssignments.id}) filter (where ${pharmacyVisits.id} is not null)::int`,
        })
        .from(pharmacyAssignments)
        .leftJoin(
          pharmacyVisits,
          and(
            eq(pharmacyVisits.assignmentId, pharmacyAssignments.id),
            eq(pharmacyVisits.status, "completed"),
          ),
        )
        .where(assignWhere)
        .then((r) => r[0]),
      this.db
        .select({
          employeeId: pharmacyAssignments.employeeId,
          name: popsEmployees.displayName,
          planned: sql<number>`count(distinct ${pharmacyAssignments.id})::int`,
          visited: sql<number>`count(distinct ${pharmacyAssignments.id}) filter (where ${pharmacyVisits.id} is not null)::int`,
        })
        .from(pharmacyAssignments)
        .innerJoin(popsEmployees, eq(pharmacyAssignments.employeeId, popsEmployees.id))
        .leftJoin(
          pharmacyVisits,
          and(
            eq(pharmacyVisits.assignmentId, pharmacyAssignments.id),
            eq(pharmacyVisits.status, "completed"),
          ),
        )
        .where(assignWhere)
        .groupBy(pharmacyAssignments.employeeId, popsEmployees.displayName)
        .orderBy(sql`count(distinct ${pharmacyAssignments.id}) desc`),
      this.db
        .select({
          employeeId: pharmacyDistOrders.salesmanEmployeeId,
          orders: sql<number>`count(*)::int`,
          sales: sql<number>`coalesce(sum(${pharmacyDistInvoices.totalPkr}), 0)::int`,
        })
        .from(pharmacyDistInvoices)
        .innerJoin(pharmacyDistOrders, eq(pharmacyDistInvoices.orderId, pharmacyDistOrders.id))
        .where(
          and(
            this.invPeriod(scope, range.from, range.to),
            eq(pharmacyDistOrders.organizationId, organizationId),
            scope.branchId ? eq(pharmacyDistOrders.branchId, scope.branchId) : undefined,
            scope.salesmanId ? eq(pharmacyDistOrders.salesmanEmployeeId, scope.salesmanId) : undefined,
            sql`${pharmacyDistOrders.salesmanEmployeeId} is not null`,
          )!,
        )
        .groupBy(pharmacyDistOrders.salesmanEmployeeId),
      this.db
        .select({
          employeeId: pharmacyCollections.salesmanEmployeeId,
          collection: sql<number>`coalesce(sum(${pharmacyCollections.amountPkr}), 0)::int`,
        })
        .from(pharmacyCollections)
        .where(
          and(
            this.colBase(scope),
            gte(pharmacyCollections.createdAt, range.from),
            lte(pharmacyCollections.createdAt, range.to),
            sql`${pharmacyCollections.salesmanEmployeeId} is not null`,
          )!,
        )
        .groupBy(pharmacyCollections.salesmanEmployeeId),
    ]);

    const salesMap = new Map(
      salesByEmp.map((r) => [r.employeeId, { orders: n(r.orders), sales: n(r.sales) }]),
    );
    const colMap = new Map(colByEmp.map((r) => [r.employeeId, n(r.collection)]));

    const visitDayParts: SQL[] = [
      eq(pharmacyVisits.organizationId, organizationId),
      sql`${pharmacyVisits.plannedDate} >= ${range.fromDate}`,
      sql`${pharmacyVisits.plannedDate} <= ${range.toDate}`,
    ];
    if (scope.salesmanId) visitDayParts.push(eq(pharmacyVisits.employeeId, scope.salesmanId));
    if (scope.routeId) visitDayParts.push(eq(pharmacyVisits.routeId, scope.routeId));
    const [visitPlan] = await this.db
      .select({
        planned: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${pharmacyVisits.status} = 'completed')::int`,
        missed: sql<number>`count(*) filter (where ${pharmacyVisits.status} = 'missed')::int`,
      })
      .from(pharmacyVisits)
      .where(and(...visitDayParts));

    const plannedFromVisits = n(visitPlan?.planned);
    const planned = plannedFromVisits > 0 ? plannedFromVisits : n(summary?.planned);
    const completed = plannedFromVisits > 0 ? n(visitPlan?.completed) : n(summary?.completed);
    const missed = plannedFromVisits > 0 ? n(visitPlan?.missed) : Math.max(0, planned - completed);

    return {
      generatedAt: new Date().toISOString(),
      summary: { planned, completed, missed },
      salesmen: perSalesman.map((r) => {
        const plannedN = n(r.planned);
        const visited = n(r.visited);
        const sales = salesMap.get(r.employeeId);
        return {
          employeeId: r.employeeId,
          name: r.name,
          planned: plannedN,
          visited,
          missed: Math.max(0, plannedN - visited),
          orders: sales?.orders ?? 0,
          sales: sales?.sales ?? 0,
          collection: colMap.get(r.employeeId) ?? 0,
        };
      }),
    };
  }
}
