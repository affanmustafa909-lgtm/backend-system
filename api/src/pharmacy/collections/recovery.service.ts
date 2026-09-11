import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, desc, eq, sql, type SQL } from "drizzle-orm";
import {
  pharmacyCollections,
  pharmacyDistInvoices,
  pharmacyPromisesToPay,
  pharmacyTradeCustomers,
  popsBranches,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { DeliveryNumberingService } from "../delivery/delivery-numbering.service";

export type RecoveryItem = {
  kind: "overdue" | "over_credit" | "bounced_cheque" | "broken_promise";
  priority: "critical" | "warning" | "info";
  tradeCustomerId: string;
  customerCode: string | null;
  customerName: string | null;
  amountPkr: number;
  reference: string;
  detail: string;
  invoiceId?: string | null;
  collectionId?: string | null;
  promiseId?: string | null;
};

/**
 * Recovery work queue: overdue invoices, credit breaches, bounced cheques, broken PTPs.
 */
@Injectable()
export class RecoveryService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly numbering: DeliveryNumberingService,
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

  async getQueue(
    organizationId: string,
    filters: {
      branchCode?: string;
      priority?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 50));
    const offset = (page - 1) * pageSize;
    const branch = await this.resolveBranch(organizationId, filters.branchCode);

    const items: RecoveryItem[] = [];

    const invConds: SQL[] = [
      eq(pharmacyDistInvoices.organizationId, organizationId),
      sql`${pharmacyDistInvoices.amountDuePkr} > 0`,
    ];
    if (branch) invConds.push(eq(pharmacyDistInvoices.branchId, branch.id));

    const dueAgeExpr = sql<number>`(
      current_date
      - (
        ${pharmacyDistInvoices.invoiceDate}::date
        + (coalesce(${pharmacyTradeCustomers.creditDays}, 0) || ' days')::interval
      )::date
    )`;

    const overdue = await this.db
      .select({
        invoiceId: pharmacyDistInvoices.id,
        invoiceNumber: pharmacyDistInvoices.invoiceNumber,
        amountDuePkr: pharmacyDistInvoices.amountDuePkr,
        tradeCustomerId: pharmacyDistInvoices.tradeCustomerId,
        customerCode: pharmacyTradeCustomers.code,
        customerName: pharmacyTradeCustomers.name,
        ageDays: dueAgeExpr,
      })
      .from(pharmacyDistInvoices)
      .innerJoin(
        pharmacyTradeCustomers,
        eq(pharmacyDistInvoices.tradeCustomerId, pharmacyTradeCustomers.id),
      )
      .where(and(...invConds, sql`${dueAgeExpr} > 0`))
      .orderBy(desc(dueAgeExpr))
      .limit(200);

    for (const row of overdue) {
      const age = Number(row.ageDays ?? 0);
      items.push({
        kind: "overdue",
        priority: age > 90 ? "critical" : age > 30 ? "warning" : "info",
        tradeCustomerId: row.tradeCustomerId,
        customerCode: row.customerCode,
        customerName: row.customerName,
        amountPkr: row.amountDuePkr,
        reference: row.invoiceNumber,
        detail: `Overdue by ${age} days`,
        invoiceId: row.invoiceId,
      });
    }

    const custConds: SQL[] = [
      eq(pharmacyTradeCustomers.organizationId, organizationId),
      sql`${pharmacyTradeCustomers.creditLimitPkr} > 0`,
      sql`${pharmacyTradeCustomers.outstandingPkr} > ${pharmacyTradeCustomers.creditLimitPkr}`,
    ];
    if (branch) custConds.push(eq(pharmacyTradeCustomers.branchId, branch.id));

    const overCredit = await this.db
      .select()
      .from(pharmacyTradeCustomers)
      .where(and(...custConds))
      .limit(100);

    for (const c of overCredit) {
      const over = c.outstandingPkr - c.creditLimitPkr;
      items.push({
        kind: "over_credit",
        priority: over > c.creditLimitPkr * 0.5 ? "critical" : "warning",
        tradeCustomerId: c.id,
        customerCode: c.code,
        customerName: c.name,
        amountPkr: over,
        reference: c.code,
        detail: `Outstanding ${c.outstandingPkr} exceeds limit ${c.creditLimitPkr}`,
      });
    }

    const chequeConds: SQL[] = [
      eq(pharmacyCollections.organizationId, organizationId),
      eq(pharmacyCollections.chequeStatus, "bounced"),
    ];
    if (branch) chequeConds.push(eq(pharmacyCollections.branchId, branch.id));

    const bounced = await this.db
      .select({
        id: pharmacyCollections.id,
        collectionNumber: pharmacyCollections.collectionNumber,
        amountPkr: pharmacyCollections.amountPkr,
        tradeCustomerId: pharmacyCollections.tradeCustomerId,
        customerCode: pharmacyTradeCustomers.code,
        customerName: pharmacyTradeCustomers.name,
        chequeNumber: pharmacyCollections.chequeNumber,
      })
      .from(pharmacyCollections)
      .innerJoin(
        pharmacyTradeCustomers,
        eq(pharmacyCollections.tradeCustomerId, pharmacyTradeCustomers.id),
      )
      .where(and(...chequeConds))
      .limit(100);

    for (const b of bounced) {
      items.push({
        kind: "bounced_cheque",
        priority: "critical",
        tradeCustomerId: b.tradeCustomerId,
        customerCode: b.customerCode,
        customerName: b.customerName,
        amountPkr: b.amountPkr,
        reference: b.collectionNumber,
        detail: `Bounced cheque ${b.chequeNumber ?? ""}`.trim(),
        collectionId: b.id,
      });
    }

    const promiseConds: SQL[] = [
      eq(pharmacyPromisesToPay.organizationId, organizationId),
      eq(pharmacyPromisesToPay.status, "open"),
      sql`${pharmacyPromisesToPay.promiseDate} < current_date`,
    ];
    if (branch) promiseConds.push(eq(pharmacyPromisesToPay.branchId, branch.id));

    const broken = await this.db
      .select({
        id: pharmacyPromisesToPay.id,
        promiseNumber: pharmacyPromisesToPay.promiseNumber,
        promisedAmountPkr: pharmacyPromisesToPay.promisedAmountPkr,
        promiseDate: pharmacyPromisesToPay.promiseDate,
        tradeCustomerId: pharmacyPromisesToPay.tradeCustomerId,
        customerCode: pharmacyTradeCustomers.code,
        customerName: pharmacyTradeCustomers.name,
        invoiceId: pharmacyPromisesToPay.invoiceId,
      })
      .from(pharmacyPromisesToPay)
      .innerJoin(
        pharmacyTradeCustomers,
        eq(pharmacyPromisesToPay.tradeCustomerId, pharmacyTradeCustomers.id),
      )
      .where(and(...promiseConds))
      .limit(100);

    for (const p of broken) {
      items.push({
        kind: "broken_promise",
        priority: "warning",
        tradeCustomerId: p.tradeCustomerId,
        customerCode: p.customerCode,
        customerName: p.customerName,
        amountPkr: p.promisedAmountPkr,
        reference: p.promiseNumber,
        detail: `Promise due ${p.promiseDate} not kept`,
        promiseId: p.id,
        invoiceId: p.invoiceId,
      });
    }

    const priorityRank = { critical: 0, warning: 1, info: 2 };
    let sorted = items.sort(
      (a, b) => priorityRank[a.priority] - priorityRank[b.priority] || b.amountPkr - a.amountPkr,
    );
    if (filters.priority?.trim()) {
      sorted = sorted.filter((i) => i.priority === filters.priority!.trim());
    }

    const total = sorted.length;
    const pageItems = sorted.slice(offset, offset + pageSize);

    return {
      items: pageItems,
      page,
      pageSize,
      total,
      summary: {
        critical: sorted.filter((i) => i.priority === "critical").length,
        warning: sorted.filter((i) => i.priority === "warning").length,
        info: sorted.filter((i) => i.priority === "info").length,
      },
      asOf: new Date().toISOString(),
    };
  }

  async createPromise(
    organizationId: string,
    input: {
      branchCode?: string;
      tradeCustomerId: string;
      invoiceId?: string;
      promisedAmountPkr: number;
      promiseDate: string;
      notes?: string;
    },
    userId?: string,
  ) {
    if (!input.tradeCustomerId || !(input.promisedAmountPkr > 0) || !input.promiseDate) {
      throw new BadRequestException("tradeCustomerId, promisedAmountPkr, and promiseDate are required");
    }
    const branch = input.branchCode?.trim()
      ? await this.resolveBranch(organizationId, input.branchCode)
      : null;

    return this.numbering.withNumber(organizationId, "promise", async (promiseNumber) => {
      const [row] = await this.db
        .insert(pharmacyPromisesToPay)
        .values({
          organizationId,
          branchId: branch?.id ?? null,
          promiseNumber,
          tradeCustomerId: input.tradeCustomerId,
          invoiceId: input.invoiceId ?? null,
          promisedAmountPkr: Math.round(input.promisedAmountPkr),
          promiseDate: input.promiseDate,
          status: "open",
          notes: input.notes ?? null,
          createdByUserId: userId ?? null,
        })
        .returning();
      if (!row) throw new BadRequestException("Failed to create promise");
      return row;
    });
  }

  async listPromises(
    organizationId: string,
    filters: { tradeCustomerId?: string; status?: string; page?: number; pageSize?: number } = {},
  ) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    const offset = (page - 1) * pageSize;
    const conds: SQL[] = [eq(pharmacyPromisesToPay.organizationId, organizationId)];
    if (filters.tradeCustomerId) {
      conds.push(eq(pharmacyPromisesToPay.tradeCustomerId, filters.tradeCustomerId));
    }
    if (filters.status) conds.push(eq(pharmacyPromisesToPay.status, filters.status));
    const where = and(...conds);
    const [totalRow] = await this.db.select({ n: count() }).from(pharmacyPromisesToPay).where(where);
    const items = await this.db
      .select()
      .from(pharmacyPromisesToPay)
      .where(where)
      .orderBy(desc(pharmacyPromisesToPay.createdAt))
      .limit(pageSize)
      .offset(offset);
    return { items, page, pageSize, total: Number(totalRow?.n ?? 0) };
  }

  async updatePromiseStatus(organizationId: string, id: string, status: string) {
    const allowed = ["open", "kept", "broken", "cancelled"];
    if (!allowed.includes(status)) {
      throw new BadRequestException(`status must be one of: ${allowed.join(", ")}`);
    }
    const [existing] = await this.db
      .select()
      .from(pharmacyPromisesToPay)
      .where(and(eq(pharmacyPromisesToPay.id, id), eq(pharmacyPromisesToPay.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Promise not found");
    const [updated] = await this.db
      .update(pharmacyPromisesToPay)
      .set({ status })
      .where(eq(pharmacyPromisesToPay.id, id))
      .returning();
    return updated;
  }
}
