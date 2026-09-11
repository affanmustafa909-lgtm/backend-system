import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import {
  pharmacyDistInvoices,
  pharmacyTradeCustomers,
  popsBranches,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";

/**
 * Day-bucket aging: dueDate = invoiceDate + creditDays (customer).
 * Aligns Aging page with dashboard recovery day buckets (not amount-risk thresholds).
 */
@Injectable()
export class AgingService {
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

  async listCustomers(
    organizationId: string,
    filters: {
      branchCode?: string;
      page?: number;
      pageSize?: number;
      minOutstanding?: number;
    } = {},
  ) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    const offset = (page - 1) * pageSize;
    const branch = await this.resolveBranch(organizationId, filters.branchCode);

    const invConds: SQL[] = [
      eq(pharmacyDistInvoices.organizationId, organizationId),
      sql`${pharmacyDistInvoices.amountDuePkr} > 0`,
    ];
    if (branch) invConds.push(eq(pharmacyDistInvoices.branchId, branch.id));

    // dueDate = invoice_date + credit_days; age_days = today - dueDate (negative = not yet due → current)
    const dueAgeExpr = sql<number>`(
      current_date
      - (
        ${pharmacyDistInvoices.invoiceDate}::date
        + (coalesce(${pharmacyTradeCustomers.creditDays}, 0) || ' days')::interval
      )::date
    )`;

    const rows = await this.db
      .select({
        tradeCustomerId: pharmacyDistInvoices.tradeCustomerId,
        customerCode: pharmacyTradeCustomers.code,
        customerName: pharmacyTradeCustomers.name,
        creditLimitPkr: pharmacyTradeCustomers.creditLimitPkr,
        creditDays: pharmacyTradeCustomers.creditDays,
        outstandingPkr: pharmacyTradeCustomers.outstandingPkr,
        currentPkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.amountDuePkr}) filter (where ${dueAgeExpr} <= 0), 0)::int`,
        d1to30Pkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.amountDuePkr}) filter (where ${dueAgeExpr} between 1 and 30), 0)::int`,
        d31to60Pkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.amountDuePkr}) filter (where ${dueAgeExpr} between 31 and 60), 0)::int`,
        d61to90Pkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.amountDuePkr}) filter (where ${dueAgeExpr} between 61 and 90), 0)::int`,
        d91to120Pkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.amountDuePkr}) filter (where ${dueAgeExpr} between 91 and 120), 0)::int`,
        d120plusPkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.amountDuePkr}) filter (where ${dueAgeExpr} > 120), 0)::int`,
        totalDuePkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.amountDuePkr}), 0)::int`,
        openInvoices: sql<number>`count(*)::int`,
      })
      .from(pharmacyDistInvoices)
      .innerJoin(
        pharmacyTradeCustomers,
        eq(pharmacyDistInvoices.tradeCustomerId, pharmacyTradeCustomers.id),
      )
      .where(and(...invConds))
      .groupBy(
        pharmacyDistInvoices.tradeCustomerId,
        pharmacyTradeCustomers.code,
        pharmacyTradeCustomers.name,
        pharmacyTradeCustomers.creditLimitPkr,
        pharmacyTradeCustomers.creditDays,
        pharmacyTradeCustomers.outstandingPkr,
      )
      .orderBy(desc(sql`sum(${pharmacyDistInvoices.amountDuePkr})`));

    const minOut = filters.minOutstanding ?? 0;
    const filtered = rows.filter((r) => (r.totalDuePkr ?? 0) >= minOut);
    const total = filtered.length;
    const items = filtered.slice(offset, offset + pageSize);

    const totals = filtered.reduce(
      (acc, r) => {
        acc.currentPkr += r.currentPkr ?? 0;
        acc.d1to30Pkr += r.d1to30Pkr ?? 0;
        acc.d31to60Pkr += r.d31to60Pkr ?? 0;
        acc.d61to90Pkr += r.d61to90Pkr ?? 0;
        acc.d91to120Pkr += r.d91to120Pkr ?? 0;
        acc.d120plusPkr += r.d120plusPkr ?? 0;
        acc.totalDuePkr += r.totalDuePkr ?? 0;
        return acc;
      },
      {
        currentPkr: 0,
        d1to30Pkr: 0,
        d31to60Pkr: 0,
        d61to90Pkr: 0,
        d91to120Pkr: 0,
        d120plusPkr: 0,
        totalDuePkr: 0,
      },
    );

    return { items, page, pageSize, total, totals, asOf: new Date().toISOString() };
  }
}
