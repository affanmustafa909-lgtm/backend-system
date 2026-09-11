import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, count, desc, eq, type SQL } from "drizzle-orm";
import {
  pharmacyGrnLines,
  pharmacyGrns,
  pharmacyPurchaseInvoiceLines,
  pharmacyPurchaseInvoices,
  pharmacyPurchaseOrders,
  popsBranches,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { normalizePage, pageResult, type PageResult } from "../inventory/batch-stock.service";
import { PurchaseNumberingService } from "./purchase-numbering.service";

/**
 * Purchase invoices are a documentary / three-way match layer.
 *
 * Pharmacy GRNs already post AP via AccountingHooksService.recordPurchaseFromPharmacyGrn (JV).
 * Posting an invoice here does NOT create a second journal entry by default, to avoid
 * double-counting payables. Optional vendor-bill creation is intentionally not wired.
 */
@Injectable()
export class PurchaseInvoiceService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly numbering: PurchaseNumberingService,
  ) {}

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

  async list(
    organizationId: string,
    filters: { branchCode?: string; status?: string; supplierId?: string; page?: number; pageSize?: number },
  ): Promise<PageResult<typeof pharmacyPurchaseInvoices.$inferSelect>> {
    const { page, pageSize, offset } = normalizePage(filters.page, filters.pageSize);
    const clauses: SQL[] = [eq(pharmacyPurchaseInvoices.organizationId, organizationId)];
    if (filters.branchCode?.trim()) {
      const branch = await this.resolveBranch(organizationId, filters.branchCode);
      clauses.push(eq(pharmacyPurchaseInvoices.branchId, branch.id));
    }
    if (filters.status?.trim()) clauses.push(eq(pharmacyPurchaseInvoices.status, filters.status.trim()));
    if (filters.supplierId?.trim()) {
      clauses.push(eq(pharmacyPurchaseInvoices.supplierId, filters.supplierId.trim()));
    }
    const where = and(...clauses);
    const [totalRow] = await this.db.select({ n: count() }).from(pharmacyPurchaseInvoices).where(where);
    const items = await this.db
      .select()
      .from(pharmacyPurchaseInvoices)
      .where(where)
      .orderBy(desc(pharmacyPurchaseInvoices.createdAt))
      .limit(pageSize)
      .offset(offset);
    return pageResult(items, Number(totalRow?.n ?? 0), page, pageSize);
  }

  async getById(organizationId: string, id: string) {
    const [inv] = await this.db
      .select()
      .from(pharmacyPurchaseInvoices)
      .where(
        and(eq(pharmacyPurchaseInvoices.id, id), eq(pharmacyPurchaseInvoices.organizationId, organizationId)),
      )
      .limit(1);
    if (!inv) throw new NotFoundException("Purchase invoice not found");
    const lines = await this.db
      .select()
      .from(pharmacyPurchaseInvoiceLines)
      .where(eq(pharmacyPurchaseInvoiceLines.invoiceId, id));
    return { ...inv, lines };
  }

  async createFromGrn(
    organizationId: string,
    input: {
      grnId: string;
      invoiceNumber?: string;
      supplierInvoiceNumber?: string;
      invoiceDate?: string;
      dueDate?: string;
      notes?: string;
    },
    userId?: string,
  ) {
    const [grn] = await this.db
      .select()
      .from(pharmacyGrns)
      .where(and(eq(pharmacyGrns.id, input.grnId), eq(pharmacyGrns.organizationId, organizationId)))
      .limit(1);
    if (!grn) throw new NotFoundException("GRN not found");
    if (!grn.supplierId) throw new BadRequestException("GRN has no supplierId; cannot create invoice");

    const grnLines = await this.db.select().from(pharmacyGrnLines).where(eq(pharmacyGrnLines.grnId, grn.id));
    if (!grnLines.length) throw new BadRequestException("GRN has no lines");

    let subtotal = 0;
    for (const line of grnLines) subtotal += line.lineTotalPkr;

    const accountingNote =
      "Documentary match only. AP already posted at GRN via recordPurchaseFromPharmacyGrn (JV). No second AP entry on invoice post.";

    return this.numbering.withNumber(organizationId, "invoice", async (autoNumber) => {
      const [created] = await this.db
        .insert(pharmacyPurchaseInvoices)
        .values({
          organizationId,
          branchId: grn.branchId,
          supplierId: grn.supplierId!,
          grnId: grn.id,
          purchaseOrderId: grn.purchaseOrderId,
          invoiceNumber: input.invoiceNumber?.trim() || autoNumber,
          supplierInvoiceNumber: input.supplierInvoiceNumber ?? grn.supplierInvoiceNumber,
          invoiceDate: input.invoiceDate ?? grn.receivedDate,
          dueDate: input.dueDate ?? null,
          status: "draft",
          subtotalPkr: subtotal,
          totalPkr: subtotal,
          notes: input.notes ?? null,
          accountingNote,
          createdByUserId: userId ?? null,
        })
        .returning();
      if (!created) throw new BadRequestException("Failed to create purchase invoice");

      for (const line of grnLines) {
        await this.db.insert(pharmacyPurchaseInvoiceLines).values({
          invoiceId: created.id,
          medicineId: line.medicineId,
          grnLineId: line.id,
          quantity: line.quantity,
          unitCostPkr: line.unitCostPkr,
          lineTotalPkr: line.lineTotalPkr,
        });
      }
      return this.getById(organizationId, created.id);
    });
  }

  async post(organizationId: string, id: string) {
    const inv = await this.getById(organizationId, id);
    if (inv.status !== "draft") throw new BadRequestException(`Cannot post invoice in status ${inv.status}`);
    // Intentionally skip second JV — AP already at GRN. See accountingNote.
    await this.db
      .update(pharmacyPurchaseInvoices)
      .set({ status: "posted", postedAt: new Date() })
      .where(eq(pharmacyPurchaseInvoices.id, id));
    return this.getById(organizationId, id);
  }

  /** Simple PO vs GRN vs invoice total comparison. */
  async matchSummary(organizationId: string, invoiceId: string) {
    const inv = await this.getById(organizationId, invoiceId);
    let poTotal = 0;
    let grnTotal = 0;
    if (inv.purchaseOrderId) {
      const [po] = await this.db
        .select()
        .from(pharmacyPurchaseOrders)
        .where(eq(pharmacyPurchaseOrders.id, inv.purchaseOrderId))
        .limit(1);
      poTotal = po?.totalPkr ?? 0;
    }
    if (inv.grnId) {
      const [grn] = await this.db.select().from(pharmacyGrns).where(eq(pharmacyGrns.id, inv.grnId)).limit(1);
      grnTotal = grn?.totalPkr ?? 0;
    }
    return {
      invoiceId: inv.id,
      invoiceTotalPkr: inv.totalPkr,
      grnTotalPkr: grnTotal,
      poTotalPkr: poTotal,
      poVsGrnDiffPkr: grnTotal - poTotal,
      invoiceVsGrnDiffPkr: inv.totalPkr - grnTotal,
      matched: inv.totalPkr === grnTotal,
      accountingNote: inv.accountingNote,
    };
  }
}
