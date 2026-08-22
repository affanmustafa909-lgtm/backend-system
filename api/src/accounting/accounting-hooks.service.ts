import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import {
  popsAccounts,
  popsBills,
  popsGoodsReceipts,
  popsJournalEntries,
  popsJournalLines,
  popsSuppliers,
  popsVendorBills,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../drizzle/drizzle.tokens";
import { DEFAULT_CHART } from "./accounting-chart";

type JournalLineInput = { accountCode: string; debit: number; credit: number; memo?: string };

function salesRevenueAccount(tableLabel: string): string {
  const label = tableLabel.toLowerCase();
  if (label.includes("delivery") || label.startsWith("dl-")) return "4103";
  if (label.includes("takeaway") || label.startsWith("tw-")) return "4102";
  return "4101";
}

@Injectable()
export class AccountingHooksService {
  private readonly logger = new Logger(AccountingHooksService.name);

  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  async recordSaleFromBill(
    organizationId: string,
    branchId: string,
    bill: typeof popsBills.$inferSelect,
  ): Promise<void> {
    const existing = await this.db
      .select({ id: popsJournalEntries.id })
      .from(popsJournalEntries)
      .where(
        and(
          eq(popsJournalEntries.organizationId, organizationId),
          eq(popsJournalEntries.source, "sale"),
          eq(popsJournalEntries.sourceRef, bill.billRef),
        ),
      )
      .limit(1);
    if (existing.length > 0) return;

    let payments: { method: string; amount: number }[] = [];
    if (bill.paymentsJson) {
      try {
        payments = JSON.parse(bill.paymentsJson) as { method: string; amount: number }[];
      } catch {
        payments = [{ method: "cash", amount: bill.totalPkr }];
      }
    } else {
      payments = [{ method: "cash", amount: bill.totalPkr }];
    }

    const lines: JournalLineInput[] = [];
    for (const p of payments) {
      const code = p.method === "card" || p.method === "bank" ? "1102" : "1101";
      lines.push({ accountCode: code, debit: p.amount, credit: 0, memo: `${p.method} payment` });
    }

    const revenue = bill.subtotalPkr - bill.discountPkr;
    if (revenue > 0) {
      lines.push({
        accountCode: salesRevenueAccount(bill.tableLabel),
        debit: 0,
        credit: revenue,
        memo: `${bill.tableLabel} sales`,
      });
    }
    if (bill.discountPkr > 0) {
      lines.push({ accountCode: "4105", debit: bill.discountPkr, credit: 0, memo: "Sales discount" });
    }
    if (bill.servicePkr > 0) {
      lines.push({ accountCode: "4104", debit: 0, credit: bill.servicePkr, memo: "Service charges" });
    }
    if (bill.taxPkr > 0) {
      lines.push({ accountCode: "2201", debit: 0, credit: bill.taxPkr, memo: "Tax collected" });
    }

    await this.postEntry(organizationId, branchId, {
      entryRef: `JV-SALE-${bill.billRef}`,
      entryDate: bill.createdAt.toISOString().slice(0, 10),
      source: "sale",
      sourceRef: bill.billRef,
      description: `POS sale ${bill.billRef} — ${bill.tableLabel}`,
      createdBy: bill.waiterName,
      lines,
    });
  }

  async recordCogs(
    organizationId: string,
    branchId: string,
    sourceRef: string,
    amountPkr: number,
    memo: string,
  ): Promise<void> {
    if (amountPkr <= 0) return;

    const existing = await this.db
      .select({ id: popsJournalEntries.id })
      .from(popsJournalEntries)
      .where(
        and(
          eq(popsJournalEntries.organizationId, organizationId),
          eq(popsJournalEntries.source, "cogs"),
          eq(popsJournalEntries.sourceRef, sourceRef),
        ),
      )
      .limit(1);
    if (existing.length > 0) return;

    await this.postEntry(organizationId, branchId, {
      entryRef: `JV-COGS-${sourceRef}`,
      entryDate: new Date().toISOString().slice(0, 10),
      source: "cogs",
      sourceRef,
      description: `COGS — ${memo}`,
      createdBy: "system",
      lines: [
        { accountCode: "5101", debit: amountPkr, credit: 0, memo: "Cost of goods sold" },
        { accountCode: "1201", debit: 0, credit: amountPkr, memo: "Inventory reduction" },
      ],
    });
  }

  async recordPurchaseFromGrn(
    organizationId: string,
    branchId: string,
    grn: typeof popsGoodsReceipts.$inferSelect,
  ): Promise<void> {
    const existing = await this.db
      .select({ id: popsJournalEntries.id })
      .from(popsJournalEntries)
      .where(
        and(
          eq(popsJournalEntries.organizationId, organizationId),
          eq(popsJournalEntries.source, "purchase"),
          eq(popsJournalEntries.sourceRef, grn.grnNumber),
        ),
      )
      .limit(1);
    if (existing.length > 0) return;

    const entry = await this.postEntry(organizationId, branchId, {
      entryRef: `JV-PO-${grn.grnNumber}`,
      entryDate: grn.deliveryDate ?? new Date().toISOString().slice(0, 10),
      source: "purchase",
      sourceRef: grn.grnNumber,
      description: `Inventory purchase ${grn.grnNumber}`,
      createdBy: grn.receivedBy ?? "system",
      lines: [
        { accountCode: "1201", debit: grn.totalCostPkr, credit: 0, memo: "Stock received" },
        { accountCode: "2101", debit: 0, credit: grn.totalCostPkr, memo: "Vendor payable" },
      ],
    });
    if (!entry) return;

    const suppliers = await this.db
      .select()
      .from(popsSuppliers)
      .where(eq(popsSuppliers.id, grn.supplierId))
      .limit(1);
    const supplier = suppliers[0];

    await this.db.insert(popsVendorBills).values({
      organizationId,
      branchId,
      billRef: `VB-${grn.grnNumber}`,
      supplierId: grn.supplierId,
      invoiceNumber: grn.invoiceNumber,
      amountPkr: grn.totalCostPkr,
      paidPkr: 0,
      dueDate: null,
      status: "open",
      sourceRef: grn.grnNumber,
      journalEntryId: entry.id,
    });

    if (supplier) {
      this.logger.log(`AP recorded for ${supplier.name}: Rs ${grn.totalCostPkr}`);
    }
  }

  async recordStockAdjustment(
    organizationId: string,
    branchId: string,
    adjustmentRef: string,
    type: "Add" | "Remove",
    amountPkr: number,
    reason: string,
  ): Promise<void> {
    if (amountPkr <= 0) return;

    const existing = await this.db
      .select({ id: popsJournalEntries.id })
      .from(popsJournalEntries)
      .where(
        and(
          eq(popsJournalEntries.organizationId, organizationId),
          eq(popsJournalEntries.source, "adjustment"),
          eq(popsJournalEntries.sourceRef, adjustmentRef),
        ),
      )
      .limit(1);
    if (existing.length > 0) return;

    const lines =
      type === "Remove"
        ? [
            { accountCode: "5206", debit: amountPkr, credit: 0, memo: reason },
            { accountCode: "1201", debit: 0, credit: amountPkr, memo: "Stock removed" },
          ]
        : [
            { accountCode: "1201", debit: amountPkr, credit: 0, memo: "Stock added" },
            { accountCode: "3001", debit: 0, credit: amountPkr, memo: reason },
          ];

    await this.postEntry(organizationId, branchId, {
      entryRef: `JV-ADJ-${adjustmentRef}`,
      entryDate: new Date().toISOString().slice(0, 10),
      source: "adjustment",
      sourceRef: adjustmentRef,
      description: `Stock adjustment — ${type}`,
      createdBy: "system",
      lines,
    });
  }

  async recordWaste(
    organizationId: string,
    branchId: string,
    wasteRef: string,
    amountPkr: number,
    wasteType: string,
  ): Promise<void> {
    if (amountPkr <= 0) return;

    const existing = await this.db
      .select({ id: popsJournalEntries.id })
      .from(popsJournalEntries)
      .where(
        and(
          eq(popsJournalEntries.organizationId, organizationId),
          eq(popsJournalEntries.source, "waste"),
          eq(popsJournalEntries.sourceRef, wasteRef),
        ),
      )
      .limit(1);
    if (existing.length > 0) return;

    await this.postEntry(organizationId, branchId, {
      entryRef: `JV-WASTE-${wasteRef}`,
      entryDate: new Date().toISOString().slice(0, 10),
      source: "waste",
      sourceRef: wasteRef,
      description: `Waste — ${wasteType}`,
      createdBy: "system",
      lines: [
        { accountCode: "5201", debit: amountPkr, credit: 0, memo: wasteType },
        { accountCode: "1201", debit: 0, credit: amountPkr, memo: "Inventory write-off" },
      ],
    });
  }

  async recordProduction(
    organizationId: string,
    branchId: string,
    batchRef: string,
    amountPkr: number,
    outputName: string,
  ): Promise<void> {
    if (amountPkr <= 0) return;

    const existing = await this.db
      .select({ id: popsJournalEntries.id })
      .from(popsJournalEntries)
      .where(
        and(
          eq(popsJournalEntries.organizationId, organizationId),
          eq(popsJournalEntries.source, "production"),
          eq(popsJournalEntries.sourceRef, batchRef),
        ),
      )
      .limit(1);
    if (existing.length > 0) return;

    await this.postEntry(organizationId, branchId, {
      entryRef: `JV-PROD-${batchRef}`,
      entryDate: new Date().toISOString().slice(0, 10),
      source: "production",
      sourceRef: batchRef,
      description: `Production batch — ${outputName}`,
      createdBy: "system",
      lines: [
        { accountCode: "1201", debit: amountPkr, credit: 0, memo: "Finished goods produced" },
        { accountCode: "1201", debit: 0, credit: amountPkr, memo: "Raw materials consumed" },
      ],
    });
  }

  async ensureBranchChart(organizationId: string, branchId: string): Promise<void> {
    const existing = await this.db
      .select({ id: popsAccounts.id })
      .from(popsAccounts)
      .where(
        and(eq(popsAccounts.organizationId, organizationId), eq(popsAccounts.branchId, branchId)),
      )
      .limit(1);
    if (existing.length > 0) return;

    for (const acct of DEFAULT_CHART) {
      await this.db.insert(popsAccounts).values({
        organizationId,
        branchId,
        code: acct.code,
        name: acct.name,
        type: acct.type,
        subtype: acct.subtype,
      });
    }
    this.logger.log(`Seeded chart of accounts for branch ${branchId}`);
  }

  async postEntry(
    organizationId: string,
    branchId: string,
    input: {
      entryRef: string;
      entryDate: string;
      source: string;
      sourceRef: string;
      description: string;
      createdBy: string;
      lines: JournalLineInput[];
    },
  ) {
    await this.ensureBranchChart(organizationId, branchId);

    const accounts = await this.db
      .select()
      .from(popsAccounts)
      .where(
        and(eq(popsAccounts.organizationId, organizationId), eq(popsAccounts.branchId, branchId)),
      );

    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const resolved = input.lines
      .map((l) => {
        const acct = byCode.get(l.accountCode);
        if (!acct) return null;
        return { accountId: acct.id, debit: l.debit, credit: l.credit, memo: l.memo };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null && (l.debit > 0 || l.credit > 0));

    if (resolved.length < 2) {
      this.logger.warn(`Skipping journal ${input.entryRef}: accounts not seeded`);
      return null;
    }

    const totalDebit = resolved.reduce((s, l) => s + l.debit, 0);
    const totalCredit = resolved.reduce((s, l) => s + l.credit, 0);
    if (totalDebit !== totalCredit) {
      this.logger.warn(`Unbalanced entry ${input.entryRef}: ${totalDebit} vs ${totalCredit}`);
      return null;
    }

    const [entry] = await this.db
      .insert(popsJournalEntries)
      .values({
        organizationId,
        branchId,
        entryRef: input.entryRef,
        entryDate: input.entryDate,
        source: input.source,
        sourceRef: input.sourceRef,
        description: input.description,
        status: "posted",
        createdBy: input.createdBy,
      })
      .returning();

    if (!entry) return null;

    for (const line of resolved) {
      await this.db.insert(popsJournalLines).values({
        entryId: entry.id,
        accountId: line.accountId,
        debitPkr: line.debit,
        creditPkr: line.credit,
        memo: line.memo ?? null,
      });
    }

    return entry;
  }
}
