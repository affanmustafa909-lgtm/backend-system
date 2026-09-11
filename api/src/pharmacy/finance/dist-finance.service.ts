import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  pharmacyCollections,
  pharmacyDistInvoices,
  pharmacyGrns,
  pharmacyPurchaseReturns,
  pharmacyTradeCustomers,
  pharmacyWholesaleReturns,
  popsAccounts,
  popsBranches,
  popsExpenses,
  popsJournalEntries,
  popsJournalLines,
  popsSuppliers,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { AccountingService } from "../../accounting/accounting.service";
import { AgingService } from "../collections/aging.service";
import { PharmacyErpService } from "../pharmacy-erp.service";

/**
 * Dist-facing finance views. Does not own journals, AR outstanding, or AP.
 * Journals stay in AccountingService / AccountingHooksService.
 * Customer outstanding stays on pharmacy_trade_customers.
 */
@Injectable()
export class DistFinanceService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly accounting: AccountingService,
    private readonly aging: AgingService,
    private readonly erp: PharmacyErpService,
  ) {}

  private async resolveBranch(organizationId: string, branchCode: string) {
    const [branch] = await this.db
      .select()
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, branchCode)))
      .limit(1);
    if (!branch) throw new NotFoundException(`Branch not found: ${branchCode}`);
    return branch;
  }

  async getDashboard(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = `${today.slice(0, 7)}-01`;

    const [acctDash, agingPage, recon] = await Promise.all([
      this.accounting.getDashboard(organizationId, branchCode),
      this.aging.listCustomers(organizationId, { branchCode, page: 1, pageSize: 1 }),
      this.getReconciliation(organizationId, branchCode),
    ]);

    const [todayReceipts] = await this.db
      .select({
        n: sql<number>`coalesce(sum(${pharmacyCollections.amountPkr}), 0)::int`,
      })
      .from(pharmacyCollections)
      .where(
        and(
          eq(pharmacyCollections.organizationId, organizationId),
          eq(pharmacyCollections.branchId, branch.id),
          sql`${pharmacyCollections.createdAt}::date = ${today}::date`,
        ),
      );

    const [todayExpenses] = await this.db
      .select({
        n: sql<number>`coalesce(sum(${popsExpenses.amountPkr}), 0)::int`,
      })
      .from(popsExpenses)
      .where(
        and(
          eq(popsExpenses.organizationId, organizationId),
          eq(popsExpenses.branchId, branch.id),
          eq(popsExpenses.expenseDate, today),
        ),
      );

    const [monthRevenue] = await this.db
      .select({
        n: sql<number>`coalesce(sum(${pharmacyDistInvoices.totalPkr}), 0)::int`,
      })
      .from(pharmacyDistInvoices)
      .where(
        and(
          eq(pharmacyDistInvoices.organizationId, organizationId),
          eq(pharmacyDistInvoices.branchId, branch.id),
          gte(pharmacyDistInvoices.invoiceDate, monthStart),
        ),
      );

    const [monthExpenses] = await this.db
      .select({
        n: sql<number>`coalesce(sum(${popsExpenses.amountPkr}), 0)::int`,
      })
      .from(popsExpenses)
      .where(
        and(
          eq(popsExpenses.organizationId, organizationId),
          eq(popsExpenses.branchId, branch.id),
          gte(popsExpenses.expenseDate, monthStart),
        ),
      );

    const expenseBreakdown = await this.db
      .select({
        category: popsExpenses.category,
        amountPkr: sql<number>`coalesce(sum(${popsExpenses.amountPkr}), 0)::int`,
      })
      .from(popsExpenses)
      .where(
        and(
          eq(popsExpenses.organizationId, organizationId),
          eq(popsExpenses.branchId, branch.id),
          gte(popsExpenses.expenseDate, monthStart),
        ),
      )
      .groupBy(popsExpenses.category)
      .orderBy(desc(sql`sum(${popsExpenses.amountPkr})`))
      .limit(8);

    const revenueTrend = await this.db
      .select({
        month: sql<string>`to_char(${pharmacyDistInvoices.invoiceDate}::date, 'YYYY-MM')`,
        amountPkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.totalPkr}), 0)::int`,
      })
      .from(pharmacyDistInvoices)
      .where(
        and(
          eq(pharmacyDistInvoices.organizationId, organizationId),
          eq(pharmacyDistInvoices.branchId, branch.id),
          gte(pharmacyDistInvoices.invoiceDate, sql`(current_date - interval '5 months')::date`),
        ),
      )
      .groupBy(sql`to_char(${pharmacyDistInvoices.invoiceDate}::date, 'YYYY-MM')`)
      .orderBy(sql`to_char(${pharmacyDistInvoices.invoiceDate}::date, 'YYYY-MM')`);

    return {
      asOf: new Date().toISOString(),
      branchCode,
      kpis: {
        cashBalance: recon.cash.glCashPkr,
        bankBalance: recon.bank.glBankPkr,
        accountsReceivable: agingPage.totals.totalDuePkr,
        accountsPayable: recon.supplier.glApPkr,
        todayReceipts: todayReceipts?.n ?? 0,
        todayPayments: todayExpenses?.n ?? 0,
        monthlyRevenue: monthRevenue?.n ?? 0,
        monthlyExpenses: monthExpenses?.n ?? 0,
        taxPayable: recon.tax.glTaxPkr,
        /** Gross profit only when COGS postings exist — never invent it. */
        grossProfit: null,
        netProfit: acctDash.profitLoss ?? null,
      },
      receivablesAging: agingPage.totals,
      payablesAging: recon.supplier,
      expenseBreakdown,
      revenueTrend,
      cashFlow: {
        inflows: todayReceipts?.n ?? 0,
        outflows: todayExpenses?.n ?? 0,
      },
      control: recon.checks,
      accountingDashboard: acctDash,
    };
  }

  async getReconciliation(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);

    const [customer] = await this.db
      .select({
        outstandingPkr: sql<number>`coalesce(sum(${pharmacyTradeCustomers.outstandingPkr}), 0)::int`,
      })
      .from(pharmacyTradeCustomers)
      .where(eq(pharmacyTradeCustomers.organizationId, organizationId));

    const [invoiceDue] = await this.db
      .select({
        amountDuePkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.amountDuePkr}), 0)::int`,
      })
      .from(pharmacyDistInvoices)
      .where(
        and(
          eq(pharmacyDistInvoices.organizationId, organizationId),
          eq(pharmacyDistInvoices.branchId, branch.id),
        ),
      );

    const [grn] = await this.db
      .select({ n: sql<number>`coalesce(sum(${pharmacyGrns.totalPkr}), 0)::int` })
      .from(pharmacyGrns)
      .where(and(eq(pharmacyGrns.organizationId, organizationId), eq(pharmacyGrns.branchId, branch.id)));

    const [prn] = await this.db
      .select({ n: sql<number>`coalesce(sum(${pharmacyPurchaseReturns.totalPkr}), 0)::int` })
      .from(pharmacyPurchaseReturns)
      .where(
        and(
          eq(pharmacyPurchaseReturns.organizationId, organizationId),
          eq(pharmacyPurchaseReturns.branchId, branch.id),
        ),
      );

    const gl = async (code: string) => this.glBalance(organizationId, branch.id, code);

    const glAr = await gl("1301");
    const glAp = await gl("2101");
    const glCash = await gl("1101");
    const glBank = await gl("1102");
    const glInv = await gl("1201");
    const glTax = await gl("2201");

    const customerOutstanding = customer?.outstandingPkr ?? 0;
    const invoiceOutstanding = invoiceDue?.amountDuePkr ?? 0;
    const supplierDocs = (grn?.n ?? 0) - (prn?.n ?? 0);

    const checks = [
      {
        severity: invoiceOutstanding === glAr ? "ok" : "critical",
        code: "ar_vs_invoice_due",
        label: "Branch invoice amount due vs AR GL (1301)",
        expectedPkr: invoiceOutstanding,
        actualPkr: glAr,
        differencePkr: invoiceOutstanding - glAr,
      },
      {
        severity: invoiceOutstanding === customerOutstanding ? "ok" : "warning",
        code: "invoice_due_vs_customer",
        label: "Invoice amount due vs customer outstanding",
        expectedPkr: invoiceOutstanding,
        actualPkr: customerOutstanding,
        differencePkr: invoiceOutstanding - customerOutstanding,
      },
      {
        severity: supplierDocs === glAp ? "ok" : "critical",
        code: "ap_vs_supplier_docs",
        label: "GRN − purchase returns vs AP GL (2101)",
        expectedPkr: supplierDocs,
        actualPkr: glAp,
        differencePkr: supplierDocs - glAp,
      },
    ];

    return {
      customer: {
        outstandingPkr: customerOutstanding,
        invoiceDuePkr: invoiceOutstanding,
        glArPkr: glAr,
        differencePkr: customerOutstanding - glAr,
      },
      supplier: {
        grnPkr: grn?.n ?? 0,
        purchaseReturnPkr: prn?.n ?? 0,
        documentNetPkr: supplierDocs,
        glApPkr: glAp,
        differencePkr: supplierDocs - glAp,
      },
      cash: { glCashPkr: glCash },
      bank: { glBankPkr: glBank },
      inventory: { glInventoryPkr: glInv },
      tax: { glTaxPkr: glTax },
      checks,
    };
  }

  async getSupplierLedger(organizationId: string, supplierId: string, branchCode?: string) {
    const [supplier] = await this.db
      .select()
      .from(popsSuppliers)
      .where(and(eq(popsSuppliers.id, supplierId), eq(popsSuppliers.organizationId, organizationId)))
      .limit(1);
    if (!supplier) throw new NotFoundException("Supplier not found");

    const branch = branchCode ? await this.resolveBranch(organizationId, branchCode) : null;

    const grnConds = [
      eq(pharmacyGrns.organizationId, organizationId),
      eq(pharmacyGrns.supplierId, supplierId),
    ];
    if (branch) grnConds.push(eq(pharmacyGrns.branchId, branch.id));
    const grns = await this.db
      .select()
      .from(pharmacyGrns)
      .where(and(...grnConds))
      .orderBy(pharmacyGrns.receivedDate);

    const retConds = [
      eq(pharmacyPurchaseReturns.organizationId, organizationId),
      eq(pharmacyPurchaseReturns.supplierId, supplierId),
    ];
    if (branch) retConds.push(eq(pharmacyPurchaseReturns.branchId, branch.id));
    const returns = await this.db
      .select()
      .from(pharmacyPurchaseReturns)
      .where(and(...retConds))
      .orderBy(pharmacyPurchaseReturns.createdAt);

    type Line = {
      date: string;
      type: string;
      reference: string;
      debit: number;
      credit: number;
      description: string;
    };
    const lines: Line[] = [];
    for (const g of grns) {
      lines.push({
        date: g.receivedDate,
        type: "purchase",
        reference: g.grnNumber,
        debit: 0,
        credit: g.totalPkr,
        description: "GRN / purchase",
      });
    }
    for (const r of returns) {
      lines.push({
        date: r.createdAt.toISOString().slice(0, 10),
        type: "purchase_return",
        reference: r.returnNumber,
        debit: r.totalPkr,
        credit: 0,
        description: r.reason ?? "Purchase return",
      });
    }
    lines.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));

    let running = 0;
    const statement = lines.map((l) => {
      running += l.credit - l.debit;
      return { ...l, runningBalance: running };
    });

    return {
      supplier: { id: supplier.id, name: supplier.name },
      openingBalance: 0,
      purchasesPkr: grns.reduce((s, g) => s + g.totalPkr, 0),
      returnsPkr: returns.reduce((s, r) => s + r.totalPkr, 0),
      closingBalance: running,
      lines: statement,
    };
  }

  async getCustomerStatement(organizationId: string, customerId: string) {
    const ledger = await this.erp.getTradeCustomerLedger(organizationId, customerId);
    const returns = await this.db
      .select()
      .from(pharmacyWholesaleReturns)
      .where(
        and(
          eq(pharmacyWholesaleReturns.organizationId, organizationId),
          eq(pharmacyWholesaleReturns.tradeCustomerId, customerId),
        ),
      )
      .orderBy(pharmacyWholesaleReturns.createdAt)
      .limit(200);

    type Line = {
      date: string;
      type: string;
      reference: string;
      debit: number;
      credit: number;
      description: string;
    };
    const lines: Line[] = [];
    for (const inv of ledger.invoices as Array<{
      invoiceDate?: string;
      createdAt: Date | string;
      invoiceNumber: string;
      totalPkr: number;
    }>) {
      const date =
        inv.invoiceDate ??
        (typeof inv.createdAt === "string" ? inv.createdAt.slice(0, 10) : inv.createdAt.toISOString().slice(0, 10));
      lines.push({
        date,
        type: "sale",
        reference: inv.invoiceNumber,
        debit: inv.totalPkr,
        credit: 0,
        description: "Wholesale invoice",
      });
    }
    for (const c of ledger.collections as Array<{
      createdAt: Date | string;
      collectionNumber: string;
      amountPkr: number;
      unallocatedPkr: number;
    }>) {
      const date =
        typeof c.createdAt === "string" ? c.createdAt.slice(0, 10) : c.createdAt.toISOString().slice(0, 10);
      const allocated = c.amountPkr - (c.unallocatedPkr ?? 0);
      if (allocated > 0) {
        lines.push({
          date,
          type: "collection",
          reference: c.collectionNumber,
          debit: 0,
          credit: allocated,
          description: "Collection",
        });
      }
    }
    for (const r of returns) {
      lines.push({
        date: r.createdAt.toISOString().slice(0, 10),
        type: "sales_return",
        reference: r.returnNumber,
        debit: 0,
        credit: r.totalPkr,
        description: r.reason ?? "Wholesale return",
      });
    }
    lines.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
    let running = 0;
    const statement = lines.map((l) => {
      running += l.debit - l.credit;
      return { ...l, runningBalance: running };
    });

    return {
      ...ledger,
      returns,
      openingBalance: 0,
      closingBalance: ledger.outstandingPkr,
      statement,
    };
  }

  private async glBalance(organizationId: string, branchId: string, code: string): Promise<number> {
    const [acct] = await this.db
      .select()
      .from(popsAccounts)
      .where(
        and(
          eq(popsAccounts.organizationId, organizationId),
          eq(popsAccounts.branchId, branchId),
          eq(popsAccounts.code, code),
        ),
      )
      .limit(1);
    if (!acct) return 0;
    const [row] = await this.db
      .select({
        debit: sql<number>`coalesce(sum(${popsJournalLines.debitPkr}), 0)`.mapWith(Number),
        credit: sql<number>`coalesce(sum(${popsJournalLines.creditPkr}), 0)`.mapWith(Number),
      })
      .from(popsJournalLines)
      .innerJoin(popsJournalEntries, eq(popsJournalEntries.id, popsJournalLines.entryId))
      .where(
        and(eq(popsJournalLines.accountId, acct.id), eq(popsJournalEntries.status, "posted")),
      );
    const raw = (row?.debit ?? 0) - (row?.credit ?? 0);
    return acct.type === "asset" || acct.type === "expense" ? raw : -raw;
  }
}
