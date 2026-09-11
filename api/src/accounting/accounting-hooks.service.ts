import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, lte, gte } from "drizzle-orm";
import {
  popsAccounts,
  popsBills,
  popsFinancialPeriods,
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

  async recordSaleFromPharmacySale(
    organizationId: string,
    branchId: string,
    sale: {
      invoiceNumber: string;
      subtotalPkr: number;
      discountPkr: number;
      taxPkr: number;
      totalPkr: number;
      amountPaidPkr: number;
      amountDuePkr: number;
      paymentsJson?: string | null;
      paymentMethod: string;
      createdAt: Date | string;
    },
  ): Promise<void> {
    const existing = await this.db
      .select({ id: popsJournalEntries.id })
      .from(popsJournalEntries)
      .where(
        and(
          eq(popsJournalEntries.organizationId, organizationId),
          eq(popsJournalEntries.source, "pharmacy_sale"),
          eq(popsJournalEntries.sourceRef, sale.invoiceNumber),
        ),
      )
      .limit(1);
    if (existing.length > 0) return;

    let payments: { method: string; amount: number }[] = [];
    if (sale.paymentsJson) {
      try {
        payments = JSON.parse(sale.paymentsJson) as { method: string; amount: number }[];
      } catch {
        payments = [];
      }
    }
    if (payments.length === 0 && sale.amountPaidPkr > 0) {
      payments = [{ method: sale.paymentMethod, amount: sale.amountPaidPkr }];
    }

    const lines: JournalLineInput[] = [];
    for (const p of payments) {
      if (p.amount <= 0 || p.method === "Khata") continue;
      const method = p.method.toLowerCase();
      const code =
        method.includes("card") || method.includes("bank") || method.includes("jazz") || method.includes("easy")
          ? "1102"
          : "1101";
      lines.push({ accountCode: code, debit: p.amount, credit: 0, memo: `${p.method} payment` });
    }
    if (sale.amountDuePkr > 0) {
      lines.push({ accountCode: "1301", debit: sale.amountDuePkr, credit: 0, memo: "Accounts receivable" });
    }

    const netSales = Math.max(0, sale.subtotalPkr - sale.discountPkr);
    if (netSales > 0 || sale.subtotalPkr > 0) {
      lines.push({
        accountCode: "4110",
        debit: 0,
        credit: sale.subtotalPkr,
        memo: "Pharmacy sales",
      });
    }
    if (sale.discountPkr > 0) {
      lines.push({ accountCode: "4105", debit: sale.discountPkr, credit: 0, memo: "Sales discount" });
    }
    if (sale.taxPkr > 0) {
      lines.push({ accountCode: "2201", debit: 0, credit: sale.taxPkr, memo: "Tax collected" });
    }

    const entryDate =
      typeof sale.createdAt === "string"
        ? sale.createdAt.slice(0, 10)
        : sale.createdAt.toISOString().slice(0, 10);

    await this.postEntry(organizationId, branchId, {
      entryRef: `JV-PH-SALE-${sale.invoiceNumber}`,
      entryDate,
      source: "pharmacy_sale",
      sourceRef: sale.invoiceNumber,
      description: `Pharmacy sale ${sale.invoiceNumber}`,
      createdBy: "pharmacy",
      lines,
    });
  }

  async recordPurchaseFromPharmacyGrn(
    organizationId: string,
    branchId: string,
    grn: { grnNumber: string; totalPkr: number; createdAt: Date | string },
  ): Promise<void> {
    if (grn.totalPkr <= 0) return;
    const existing = await this.db
      .select({ id: popsJournalEntries.id })
      .from(popsJournalEntries)
      .where(
        and(
          eq(popsJournalEntries.organizationId, organizationId),
          eq(popsJournalEntries.source, "pharmacy_purchase"),
          eq(popsJournalEntries.sourceRef, grn.grnNumber),
        ),
      )
      .limit(1);
    if (existing.length > 0) return;

    const entryDate =
      typeof grn.createdAt === "string" ? grn.createdAt.slice(0, 10) : grn.createdAt.toISOString().slice(0, 10);

    await this.postEntry(organizationId, branchId, {
      entryRef: `JV-PH-GRN-${grn.grnNumber}`,
      entryDate,
      source: "pharmacy_purchase",
      sourceRef: grn.grnNumber,
      description: `Pharmacy GRN ${grn.grnNumber}`,
      createdBy: "pharmacy",
      lines: [
        { accountCode: "1201", debit: grn.totalPkr, credit: 0, memo: "Inventory received" },
        { accountCode: "2101", debit: 0, credit: grn.totalPkr, memo: "Accounts payable" },
      ],
    });
  }

  async recordPharmacySaleReturn(
    organizationId: string,
    branchId: string,
    ret: {
      returnNumber: string;
      subtotalPkr: number;
      taxPkr: number;
      totalPkr: number;
      refundMethod?: string;
      createdAt: Date | string;
    },
  ): Promise<void> {
    if (ret.totalPkr <= 0) return;
    const existing = await this.db
      .select({ id: popsJournalEntries.id })
      .from(popsJournalEntries)
      .where(
        and(
          eq(popsJournalEntries.organizationId, organizationId),
          eq(popsJournalEntries.source, "pharmacy_sale_return"),
          eq(popsJournalEntries.sourceRef, ret.returnNumber),
        ),
      )
      .limit(1);
    if (existing.length > 0) return;

    const method = (ret.refundMethod ?? "Cash").toLowerCase();
    const cashOrBank =
      method.includes("card") || method.includes("bank") || method.includes("jazz") || method.includes("easy")
        ? "1102"
        : "1101";
    const entryDate =
      typeof ret.createdAt === "string" ? ret.createdAt.slice(0, 10) : ret.createdAt.toISOString().slice(0, 10);

    const lines: JournalLineInput[] = [
      { accountCode: "4110", debit: ret.subtotalPkr, credit: 0, memo: "Pharmacy sales return" },
      { accountCode: cashOrBank, debit: 0, credit: ret.totalPkr, memo: "Refund" },
    ];
    if (ret.taxPkr > 0) {
      lines.push({ accountCode: "2201", debit: ret.taxPkr, credit: 0, memo: "Tax reversal" });
    }

    await this.postEntry(organizationId, branchId, {
      entryRef: `JV-PH-RET-${ret.returnNumber}`,
      entryDate,
      source: "pharmacy_sale_return",
      sourceRef: ret.returnNumber,
      description: `Pharmacy sale return ${ret.returnNumber}`,
      createdBy: "pharmacy",
      lines,
    });
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

  async recordDistWholesaleInvoice(
    organizationId: string,
    branchId: string,
    invoice: {
      invoiceNumber: string;
      subtotalPkr: number;
      discountPkr: number;
      taxPkr: number;
      totalPkr: number;
      amountPaidPkr: number;
      amountDuePkr: number;
      paymentMethod?: string;
      createdAt: Date | string;
    },
  ): Promise<void> {
    if (await this.hasSource(organizationId, "dist_invoice", invoice.invoiceNumber)) return;

    const lines: JournalLineInput[] = [];
    const paid = Math.max(0, Math.round(invoice.amountPaidPkr));
    const due = Math.max(0, Math.round(invoice.amountDuePkr));
    if (paid > 0) {
      lines.push({
        accountCode: this.cashOrBankCode(invoice.paymentMethod ?? "cash"),
        debit: paid,
        credit: 0,
        memo: "Wholesale cash/bank receipt",
      });
    }
    if (due > 0) {
      lines.push({ accountCode: "1301", debit: due, credit: 0, memo: "Accounts receivable" });
    }
    const netSales = Math.max(0, Math.round(invoice.subtotalPkr));
    if (netSales > 0) {
      lines.push({ accountCode: "4111", debit: 0, credit: netSales, memo: "Wholesale sales" });
    }
    if (invoice.discountPkr > 0) {
      lines.push({ accountCode: "4105", debit: Math.round(invoice.discountPkr), credit: 0, memo: "Sales discount" });
    }
    if (invoice.taxPkr > 0) {
      lines.push({ accountCode: "2201", debit: 0, credit: Math.round(invoice.taxPkr), memo: "Output tax" });
    }

    const entryDate =
      typeof invoice.createdAt === "string"
        ? invoice.createdAt.slice(0, 10)
        : invoice.createdAt.toISOString().slice(0, 10);

    await this.postEntry(organizationId, branchId, {
      entryRef: `JV-WINV-${invoice.invoiceNumber}`,
      entryDate,
      source: "dist_invoice",
      sourceRef: invoice.invoiceNumber,
      description: `Wholesale invoice ${invoice.invoiceNumber}`,
      createdBy: "distribution",
      lines,
    });
  }

  async recordDistCollection(
    organizationId: string,
    branchId: string,
    collection: {
      collectionNumber: string;
      amountPkr: number;
      unallocatedPkr: number;
      paymentMethod?: string;
      chequeStatus?: string | null;
      createdAt?: Date | string;
    },
  ): Promise<void> {
    const allocated = Math.max(0, Math.round(collection.amountPkr) - Math.round(collection.unallocatedPkr ?? 0));
    const advance = Math.max(0, Math.round(collection.unallocatedPkr ?? 0));
    if (allocated + advance <= 0) return;
    if (await this.hasSource(organizationId, "dist_collection", collection.collectionNumber)) return;

    const method = collection.paymentMethod ?? "cash";
    const isCheque = /cheque|check/i.test(method);
    const pendingCheque = isCheque && (collection.chequeStatus ?? "pending") !== "cleared";
    const debitCode = pendingCheque ? "1302" : this.cashOrBankCode(method);

    const lines: JournalLineInput[] = [
      { accountCode: debitCode, debit: allocated + advance, credit: 0, memo: "Collection receipt" },
    ];
    if (allocated > 0) {
      lines.push({ accountCode: "1301", debit: 0, credit: allocated, memo: "AR reduction" });
    }
    if (advance > 0) {
      lines.push({ accountCode: "2302", debit: 0, credit: advance, memo: "Customer advance" });
    }

    const entryDate =
      typeof collection.createdAt === "string"
        ? collection.createdAt.slice(0, 10)
        : (collection.createdAt ?? new Date()).toISOString().slice(0, 10);

    await this.postEntry(organizationId, branchId, {
      entryRef: `JV-COL-${collection.collectionNumber}`,
      entryDate,
      source: "dist_collection",
      sourceRef: collection.collectionNumber,
      description: `Collection ${collection.collectionNumber}`,
      createdBy: "distribution",
      lines,
    });
  }

  async recordDistCollectionAllocate(
    organizationId: string,
    branchId: string,
    collectionNumber: string,
    amountPkr: number,
    allocateKey: string,
  ): Promise<void> {
    const amount = Math.round(amountPkr);
    if (amount <= 0) return;
    const sourceRef = `${collectionNumber}:${allocateKey}`;
    if (await this.hasSource(organizationId, "dist_collection_allocate", sourceRef)) return;

    await this.postEntry(organizationId, branchId, {
      entryRef: `JV-COL-ALC-${allocateKey.slice(-8)}`,
      entryDate: new Date().toISOString().slice(0, 10),
      source: "dist_collection_allocate",
      sourceRef,
      description: `Allocate advance ${collectionNumber}`,
      createdBy: "distribution",
      lines: [
        { accountCode: "2302", debit: amount, credit: 0, memo: "Advance applied" },
        { accountCode: "1301", debit: 0, credit: amount, memo: "AR reduction" },
      ],
    });
  }

  async recordDistChequeCleared(
    organizationId: string,
    branchId: string,
    collectionNumber: string,
    amountPkr: number,
  ): Promise<void> {
    const amount = Math.round(amountPkr);
    if (amount <= 0) return;
    const sourceRef = `${collectionNumber}:cleared`;
    if (await this.hasSource(organizationId, "dist_cheque_clear", sourceRef)) return;

    await this.postEntry(organizationId, branchId, {
      entryRef: `JV-CHQ-${collectionNumber}`,
      entryDate: new Date().toISOString().slice(0, 10),
      source: "dist_cheque_clear",
      sourceRef,
      description: `Cheque cleared ${collectionNumber}`,
      createdBy: "distribution",
      lines: [
        { accountCode: "1102", debit: amount, credit: 0, memo: "Bank deposit" },
        { accountCode: "1302", debit: 0, credit: amount, memo: "Cheques receivable" },
      ],
    });
  }

  async recordDistWholesaleReturn(
    organizationId: string,
    branchId: string,
    ret: { returnNumber: string; totalPkr: number; createdAt?: Date | string },
  ): Promise<void> {
    const total = Math.round(ret.totalPkr);
    if (total <= 0) return;
    if (await this.hasSource(organizationId, "dist_wholesale_return", ret.returnNumber)) return;

    const entryDate =
      typeof ret.createdAt === "string"
        ? ret.createdAt.slice(0, 10)
        : (ret.createdAt ?? new Date()).toISOString().slice(0, 10);

    await this.postEntry(organizationId, branchId, {
      entryRef: `JV-WRN-${ret.returnNumber}`,
      entryDate,
      source: "dist_wholesale_return",
      sourceRef: ret.returnNumber,
      description: `Wholesale return ${ret.returnNumber}`,
      createdBy: "distribution",
      lines: [
        { accountCode: "4111", debit: total, credit: 0, memo: "Wholesale sales return" },
        { accountCode: "1301", debit: 0, credit: total, memo: "AR reduction" },
      ],
    });
  }

  async recordPharmacyPurchaseReturn(
    organizationId: string,
    branchId: string,
    ret: { returnNumber: string; totalPkr: number; createdAt?: Date | string },
  ): Promise<void> {
    const total = Math.round(ret.totalPkr);
    if (total <= 0) return;
    if (await this.hasSource(organizationId, "pharmacy_purchase_return", ret.returnNumber)) return;

    const entryDate =
      typeof ret.createdAt === "string"
        ? ret.createdAt.slice(0, 10)
        : (ret.createdAt ?? new Date()).toISOString().slice(0, 10);

    await this.postEntry(organizationId, branchId, {
      entryRef: `JV-PRN-${ret.returnNumber}`,
      entryDate,
      source: "pharmacy_purchase_return",
      sourceRef: ret.returnNumber,
      description: `Purchase return ${ret.returnNumber}`,
      createdBy: "pharmacy",
      lines: [
        { accountCode: "2101", debit: total, credit: 0, memo: "AP reduction" },
        { accountCode: "1201", debit: 0, credit: total, memo: "Inventory returned" },
      ],
    });
  }

  async reverseJournal(
    organizationId: string,
    entryId: string,
    actor: string,
    reason: string,
  ) {
    const [original] = await this.db
      .select()
      .from(popsJournalEntries)
      .where(
        and(eq(popsJournalEntries.id, entryId), eq(popsJournalEntries.organizationId, organizationId)),
      )
      .limit(1);
    if (!original) throw new BadRequestException("Journal not found");
    if (original.status !== "posted") {
      throw new BadRequestException("Only posted journals can be reversed");
    }

    const [already] = await this.db
      .select({ id: popsJournalEntries.id })
      .from(popsJournalEntries)
      .where(
        and(
          eq(popsJournalEntries.organizationId, organizationId),
          eq(popsJournalEntries.source, "reversal"),
          eq(popsJournalEntries.sourceRef, original.entryRef),
        ),
      )
      .limit(1);
    if (already) throw new BadRequestException("Journal already reversed");

    const lines = await this.db
      .select()
      .from(popsJournalLines)
      .where(eq(popsJournalLines.entryId, original.id));
    if (lines.length < 2) throw new BadRequestException("Journal has no lines to reverse");

    await this.assertPeriodOpen(organizationId, original.branchId, new Date().toISOString().slice(0, 10));

    const [reversal] = await this.db
      .insert(popsJournalEntries)
      .values({
        organizationId,
        branchId: original.branchId,
        entryRef: `JV-REV-${original.entryRef}`.slice(0, 60),
        entryDate: new Date().toISOString().slice(0, 10),
        source: "reversal",
        sourceRef: original.entryRef,
        description: `Reversal of ${original.entryRef}: ${reason.trim() || "correction"}`,
        status: "posted",
        reversedFromEntryId: original.id,
        reverseReason: reason.trim() || "correction",
        reversedBy: actor,
        reversedAt: new Date(),
        createdBy: actor,
      })
      .returning();
    if (!reversal) throw new BadRequestException("Failed to create reversal");

    for (const line of lines) {
      await this.db.insert(popsJournalLines).values({
        entryId: reversal.id,
        accountId: line.accountId,
        debitPkr: line.creditPkr,
        creditPkr: line.debitPkr,
        memo: `Reversal of ${original.entryRef}`,
      });
    }

    return reversal;
  }

  async findBySource(organizationId: string, source: string, sourceRef: string) {
    const [row] = await this.db
      .select()
      .from(popsJournalEntries)
      .where(
        and(
          eq(popsJournalEntries.organizationId, organizationId),
          eq(popsJournalEntries.source, source),
          eq(popsJournalEntries.sourceRef, sourceRef),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async assertPeriodOpen(organizationId: string, branchId: string, entryDate: string): Promise<void> {
    const closed = await this.db
      .select({ id: popsFinancialPeriods.id, name: popsFinancialPeriods.name })
      .from(popsFinancialPeriods)
      .where(
        and(
          eq(popsFinancialPeriods.organizationId, organizationId),
          eq(popsFinancialPeriods.branchId, branchId),
          eq(popsFinancialPeriods.status, "closed"),
          lte(popsFinancialPeriods.startDate, entryDate),
          gte(popsFinancialPeriods.endDate, entryDate),
        ),
      )
      .limit(1);
    if (closed[0]) {
      throw new BadRequestException(
        `Period ${closed[0].name} is closed. Reopen it (audited) before posting.`,
      );
    }
  }

  async ensureBranchChart(organizationId: string, branchId: string): Promise<void> {
    const existing = await this.db
      .select({ code: popsAccounts.code })
      .from(popsAccounts)
      .where(
        and(eq(popsAccounts.organizationId, organizationId), eq(popsAccounts.branchId, branchId)),
      );
    const have = new Set(existing.map((a) => a.code));
    let inserted = 0;
    for (const acct of DEFAULT_CHART) {
      if (have.has(acct.code)) continue;
      await this.db.insert(popsAccounts).values({
        organizationId,
        branchId,
        code: acct.code,
        name: acct.name,
        type: acct.type,
        subtype: acct.subtype,
      });
      inserted += 1;
    }
    if (inserted > 0) {
      this.logger.log(`Seeded ${inserted} chart accounts for branch ${branchId}`);
    }
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
    await this.assertPeriodOpen(organizationId, branchId, input.entryDate);

    if (input.sourceRef && (await this.hasSource(organizationId, input.source, input.sourceRef))) {
      return this.findBySource(organizationId, input.source, input.sourceRef);
    }

    const accounts = await this.db
      .select()
      .from(popsAccounts)
      .where(
        and(eq(popsAccounts.organizationId, organizationId), eq(popsAccounts.branchId, branchId)),
      );

    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const resolved: { accountId: string; debit: number; credit: number; memo?: string }[] = [];
    for (const l of input.lines) {
      const debit = Math.round(l.debit);
      const credit = Math.round(l.credit);
      if (debit <= 0 && credit <= 0) continue;
      if (debit > 0 && credit > 0) {
        throw new BadRequestException(`Line ${l.accountCode} cannot have both debit and credit`);
      }
      const acct = byCode.get(l.accountCode);
      if (!acct) {
        throw new BadRequestException(`Account ${l.accountCode} is not on the chart`);
      }
      if (!acct.active) {
        throw new BadRequestException(`Account ${l.accountCode} is inactive`);
      }
      resolved.push({ accountId: acct.id, debit, credit, memo: l.memo });
    }

    if (resolved.length < 2) {
      throw new BadRequestException(`Journal ${input.entryRef} needs at least two lines`);
    }

    const totalDebit = resolved.reduce((s, l) => s + l.debit, 0);
    const totalCredit = resolved.reduce((s, l) => s + l.credit, 0);
    if (totalDebit !== totalCredit || totalDebit === 0) {
      throw new BadRequestException(
        `Unbalanced journal ${input.entryRef}: debit ${totalDebit} vs credit ${totalCredit}`,
      );
    }

    try {
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
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "23505" && input.sourceRef) {
        return this.findBySource(organizationId, input.source, input.sourceRef);
      }
      throw err;
    }
  }

  private cashOrBankCode(method: string): string {
    const m = method.toLowerCase();
    if (m.includes("card") || m.includes("bank") || m.includes("jazz") || m.includes("easy")) return "1102";
    return "1101";
  }

  private async hasSource(organizationId: string, source: string, sourceRef: string): Promise<boolean> {
    const row = await this.findBySource(organizationId, source, sourceRef);
    return Boolean(row);
  }
}
