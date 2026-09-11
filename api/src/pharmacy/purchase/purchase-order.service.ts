import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CreatePharmacyPurchaseOrder } from "@platform/contracts";
import { and, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import {
  pharmacyPurchaseOrderLines,
  pharmacyPurchaseOrders,
  popsBranches,
  popsSuppliers,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { normalizePage, pageResult, type PageResult } from "../inventory/batch-stock.service";
import type { StockTx } from "../pharmacy-stock.engine";
import { PurchaseNumberingService } from "./purchase-numbering.service";

/** Statuses from which a GRN may be posted against a PO. */
export const PO_RECEIVABLE_STATUSES = new Set([
  "approved",
  "sent",
  "supplier_confirmed",
  "partial",
]);

export type PurchaseOrderFilters = {
  branchCode?: string;
  status?: string;
  supplierId?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
};

@Injectable()
export class PurchaseOrderService {
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

  /** Ordered qty = quantity + freeQuantity; pending = ordered - receivedQty. */
  linePending(line: { quantity: number; freeQuantity: number; receivedQty: number }) {
    const ordered = line.quantity + line.freeQuantity;
    return Math.max(0, ordered - line.receivedQty);
  }

  computePoReceiveStatus(
    lines: { quantity: number; freeQuantity: number; receivedQty: number }[],
  ): "partial" | "received" {
    const anyPending = lines.some((l) => this.linePending(l) > 0);
    const anyReceived = lines.some((l) => l.receivedQty > 0);
    if (!anyPending && anyReceived) return "received";
    if (anyPending && anyReceived) return "partial";
    // No receipts yet — callers should not set received/partial from empty receive.
    return anyPending ? "partial" : "received";
  }

  /**
   * After a GRN posts, recompute line receivedQty already applied by the caller,
   * then set PO status to partial (any pending > 0) or received (all pending <= 0).
   * Never marks received on the first partial receipt.
   */
  async refreshReceiveStatus(tx: StockTx, purchaseOrderId: string) {
    const lines = await tx
      .select()
      .from(pharmacyPurchaseOrderLines)
      .where(eq(pharmacyPurchaseOrderLines.purchaseOrderId, purchaseOrderId));
    if (!lines.length) return;
    const status = this.computePoReceiveStatus(lines);
    // Only move to partial/received; do not overwrite cancelled etc. if somehow called.
    const [po] = await tx
      .select({ status: pharmacyPurchaseOrders.status })
      .from(pharmacyPurchaseOrders)
      .where(eq(pharmacyPurchaseOrders.id, purchaseOrderId))
      .limit(1);
    if (!po) return;
    if (po.status === "cancelled") return;
    await tx
      .update(pharmacyPurchaseOrders)
      .set({ status })
      .where(eq(pharmacyPurchaseOrders.id, purchaseOrderId));
  }

  async list(
    organizationId: string,
    filters: PurchaseOrderFilters,
  ): Promise<PageResult<typeof pharmacyPurchaseOrders.$inferSelect>> {
    const { page, pageSize, offset } = normalizePage(filters.page, filters.pageSize);
    const clauses: SQL[] = [eq(pharmacyPurchaseOrders.organizationId, organizationId)];

    if (filters.branchCode?.trim()) {
      const branch = await this.resolveBranch(organizationId, filters.branchCode);
      clauses.push(eq(pharmacyPurchaseOrders.branchId, branch.id));
    }
    if (filters.status?.trim()) {
      clauses.push(eq(pharmacyPurchaseOrders.status, filters.status.trim()));
    }
    if (filters.supplierId?.trim()) {
      clauses.push(eq(pharmacyPurchaseOrders.supplierId, filters.supplierId.trim()));
    }
    if (filters.dateFrom?.trim()) {
      clauses.push(gte(pharmacyPurchaseOrders.orderDate, filters.dateFrom.trim()));
    }
    if (filters.dateTo?.trim()) {
      clauses.push(lte(pharmacyPurchaseOrders.orderDate, filters.dateTo.trim()));
    }
    if (filters.q?.trim()) {
      const q = `%${filters.q.trim()}%`;
      clauses.push(
        or(
          ilike(pharmacyPurchaseOrders.poNumber, q),
          ilike(pharmacyPurchaseOrders.notes, q),
          ilike(pharmacyPurchaseOrders.supplierReference, q),
        )!,
      );
    }

    const where = and(...clauses);
    const [totalRow] = await this.db
      .select({ n: count() })
      .from(pharmacyPurchaseOrders)
      .where(where);
    const items = await this.db
      .select()
      .from(pharmacyPurchaseOrders)
      .where(where)
      .orderBy(desc(pharmacyPurchaseOrders.createdAt))
      .limit(pageSize)
      .offset(offset);
    return pageResult(items, Number(totalRow?.n ?? 0), page, pageSize);
  }

  async getById(organizationId: string, id: string) {
    const [po] = await this.db
      .select()
      .from(pharmacyPurchaseOrders)
      .where(
        and(eq(pharmacyPurchaseOrders.id, id), eq(pharmacyPurchaseOrders.organizationId, organizationId)),
      )
      .limit(1);
    if (!po) throw new NotFoundException("Purchase order not found");
    const lines = await this.db
      .select()
      .from(pharmacyPurchaseOrderLines)
      .where(eq(pharmacyPurchaseOrderLines.purchaseOrderId, id));
    const enriched = lines.map((l) => {
      const ordered = l.quantity + l.freeQuantity;
      const pending = Math.max(0, ordered - l.receivedQty);
      return { ...l, orderedQty: ordered, pendingQty: pending };
    });
    return { ...po, lines: enriched };
  }

  async create(
    organizationId: string,
    input: CreatePharmacyPurchaseOrder & {
      warehouseId?: string;
      requisitionId?: string;
      buyerUserId?: string;
      paymentTerms?: string;
      idempotencyKey?: string;
      submit?: boolean;
    },
    userId?: string,
  ) {
    if (input.idempotencyKey?.trim()) {
      const [existing] = await this.db
        .select()
        .from(pharmacyPurchaseOrders)
        .where(
          and(
            eq(pharmacyPurchaseOrders.organizationId, organizationId),
            eq(pharmacyPurchaseOrders.idempotencyKey, input.idempotencyKey.trim()),
          ),
        )
        .limit(1);
      if (existing) return this.getById(organizationId, existing.id);
    }

    const branch = await this.resolveBranch(organizationId, input.branchCode);
    let subtotal = 0;
    for (const line of input.lines) {
      const qty = Math.round(line.quantity);
      const unitCost = Math.round(line.unitCostPkr ?? 0);
      const discount = Math.round((line as { discountPkr?: number }).discountPkr ?? 0);
      const tax = Math.round((line as { taxPkr?: number }).taxPkr ?? 0);
      subtotal += qty * unitCost - discount + tax;
    }
    const tax = Math.round(input.taxPkr ?? 0);
    const discount = Math.round(input.discountPkr ?? 0);
    const total = subtotal + tax - discount;
    const wantSubmit = Boolean(input.submit);
    if (wantSubmit && !input.supplierId) {
      throw new BadRequestException("supplierId is required to submit a purchase order");
    }

    return this.numbering.withNumber(organizationId, "order", async (poNumber) => {
      const [po] = await this.db
        .insert(pharmacyPurchaseOrders)
        .values({
          organizationId,
          branchId: branch.id,
          warehouseId: input.warehouseId ?? null,
          supplierId: input.supplierId ?? null,
          requisitionId: input.requisitionId ?? null,
          poNumber,
          status: wantSubmit ? "submitted" : "draft",
          orderDate: input.orderDate ?? new Date().toISOString().slice(0, 10),
          expectedDate: input.expectedDate ?? null,
          notes: input.notes ?? null,
          subtotalPkr: subtotal,
          taxPkr: tax,
          discountPkr: discount,
          totalPkr: total,
          createdByUserId: userId ?? null,
          buyerUserId: input.buyerUserId ?? userId ?? null,
          paymentTerms: input.paymentTerms ?? null,
          idempotencyKey: input.idempotencyKey?.trim() || null,
          submittedAt: wantSubmit ? new Date() : null,
          revision: 1,
        })
        .returning();
      if (!po) throw new BadRequestException("Failed to create purchase order");

      for (const line of input.lines) {
        const qty = Math.round(line.quantity);
        const unitCost = Math.round(line.unitCostPkr ?? 0);
        const lineDiscount = Math.round((line as { discountPkr?: number }).discountPkr ?? 0);
        const lineTax = Math.round((line as { taxPkr?: number }).taxPkr ?? 0);
        await this.db.insert(pharmacyPurchaseOrderLines).values({
          purchaseOrderId: po.id,
          medicineId: line.medicineId,
          quantity: qty,
          freeQuantity: Math.round(line.freeQuantity ?? 0),
          unitCostPkr: unitCost,
          discountPkr: lineDiscount,
          taxPkr: lineTax,
          lineTotalPkr: qty * unitCost - lineDiscount + lineTax,
          notes: (line as { notes?: string }).notes ?? null,
        });
      }
      return this.getById(organizationId, po.id);
    });
  }

  async updateDraft(
    organizationId: string,
    id: string,
    patch: {
      supplierId?: string | null;
      expectedDate?: string | null;
      notes?: string | null;
      paymentTerms?: string | null;
      warehouseId?: string | null;
      taxPkr?: number;
      discountPkr?: number;
      lines?: {
        medicineId: string;
        quantity: number;
        freeQuantity?: number;
        unitCostPkr?: number;
        discountPkr?: number;
        taxPkr?: number;
        notes?: string;
      }[];
    },
  ) {
    const po = await this.getById(organizationId, id);
    if (po.status !== "draft") {
      throw new BadRequestException("Only draft purchase orders can be edited; use revise for approved POs");
    }

    if (patch.lines?.length) {
      await this.db
        .delete(pharmacyPurchaseOrderLines)
        .where(eq(pharmacyPurchaseOrderLines.purchaseOrderId, id));
      let subtotal = 0;
      for (const line of patch.lines) {
        const qty = Math.round(line.quantity);
        const unitCost = Math.round(line.unitCostPkr ?? 0);
        const lineDiscount = Math.round(line.discountPkr ?? 0);
        const lineTax = Math.round(line.taxPkr ?? 0);
        subtotal += qty * unitCost - lineDiscount + lineTax;
        await this.db.insert(pharmacyPurchaseOrderLines).values({
          purchaseOrderId: id,
          medicineId: line.medicineId,
          quantity: qty,
          freeQuantity: Math.round(line.freeQuantity ?? 0),
          unitCostPkr: unitCost,
          discountPkr: lineDiscount,
          taxPkr: lineTax,
          lineTotalPkr: qty * unitCost - lineDiscount + lineTax,
          notes: line.notes ?? null,
        });
      }
      const tax = Math.round(patch.taxPkr ?? po.taxPkr);
      const discount = Math.round(patch.discountPkr ?? po.discountPkr);
      await this.db
        .update(pharmacyPurchaseOrders)
        .set({
          supplierId: patch.supplierId !== undefined ? patch.supplierId : po.supplierId,
          expectedDate: patch.expectedDate !== undefined ? patch.expectedDate : po.expectedDate,
          notes: patch.notes !== undefined ? patch.notes : po.notes,
          paymentTerms: patch.paymentTerms !== undefined ? patch.paymentTerms : po.paymentTerms,
          warehouseId: patch.warehouseId !== undefined ? patch.warehouseId : po.warehouseId,
          subtotalPkr: subtotal,
          taxPkr: tax,
          discountPkr: discount,
          totalPkr: subtotal + tax - discount,
        })
        .where(eq(pharmacyPurchaseOrders.id, id));
    } else {
      await this.db
        .update(pharmacyPurchaseOrders)
        .set({
          supplierId: patch.supplierId !== undefined ? patch.supplierId : po.supplierId,
          expectedDate: patch.expectedDate !== undefined ? patch.expectedDate : po.expectedDate,
          notes: patch.notes !== undefined ? patch.notes : po.notes,
          paymentTerms: patch.paymentTerms !== undefined ? patch.paymentTerms : po.paymentTerms,
          warehouseId: patch.warehouseId !== undefined ? patch.warehouseId : po.warehouseId,
          taxPkr: patch.taxPkr !== undefined ? Math.round(patch.taxPkr) : po.taxPkr,
          discountPkr: patch.discountPkr !== undefined ? Math.round(patch.discountPkr) : po.discountPkr,
          totalPkr:
            po.subtotalPkr +
            (patch.taxPkr !== undefined ? Math.round(patch.taxPkr) : po.taxPkr) -
            (patch.discountPkr !== undefined ? Math.round(patch.discountPkr) : po.discountPkr),
        })
        .where(eq(pharmacyPurchaseOrders.id, id));
    }
    return this.getById(organizationId, id);
  }

  async submit(organizationId: string, id: string) {
    const po = await this.getById(organizationId, id);
    if (po.status !== "draft") throw new BadRequestException(`Cannot submit PO in status ${po.status}`);
    if (!po.supplierId) throw new BadRequestException("supplierId is required before submit");
    if (!po.lines.length) throw new BadRequestException("PO has no lines");
    await this.db
      .update(pharmacyPurchaseOrders)
      .set({ status: "submitted", submittedAt: new Date() })
      .where(eq(pharmacyPurchaseOrders.id, id));
    return this.getById(organizationId, id);
  }

  async approve(organizationId: string, id: string) {
    const po = await this.getById(organizationId, id);
    if (po.status !== "draft" && po.status !== "submitted") {
      throw new BadRequestException(`Cannot approve PO in status ${po.status}`);
    }
    if (!po.supplierId) throw new BadRequestException("supplierId is required before approve");
    await this.db
      .update(pharmacyPurchaseOrders)
      .set({
        status: "approved",
        approvedAt: new Date(),
        submittedAt: po.submittedAt ?? new Date(),
      })
      .where(eq(pharmacyPurchaseOrders.id, id));
    return this.getById(organizationId, id);
  }

  async send(organizationId: string, id: string) {
    const po = await this.getById(organizationId, id);
    if (po.status !== "approved") {
      throw new BadRequestException(`Cannot send PO in status ${po.status}; approve first`);
    }
    await this.db
      .update(pharmacyPurchaseOrders)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(pharmacyPurchaseOrders.id, id));
    return this.getById(organizationId, id);
  }

  async confirm(
    organizationId: string,
    id: string,
    body: { confirmedDeliveryDate?: string; supplierReference?: string; confirmedQtyNotes?: string },
  ) {
    const po = await this.getById(organizationId, id);
    if (po.status !== "sent" && po.status !== "approved") {
      throw new BadRequestException(`Cannot confirm PO in status ${po.status}`);
    }
    await this.db
      .update(pharmacyPurchaseOrders)
      .set({
        status: "supplier_confirmed",
        confirmedAt: new Date(),
        confirmedDeliveryDate: body.confirmedDeliveryDate ?? null,
        supplierReference: body.supplierReference ?? po.supplierReference,
        confirmedQtyNotes: body.confirmedQtyNotes ?? null,
        sentAt: po.sentAt ?? new Date(),
      })
      .where(eq(pharmacyPurchaseOrders.id, id));
    return this.getById(organizationId, id);
  }

  async cancel(organizationId: string, id: string, reason?: string) {
    const po = await this.getById(organizationId, id);
    if (["received", "cancelled"].includes(po.status)) {
      throw new BadRequestException(`Cannot cancel PO in status ${po.status}`);
    }
    if (po.lines.some((l) => l.receivedQty > 0)) {
      throw new BadRequestException("Cannot cancel a PO that already has receipts; use returns");
    }
    await this.db
      .update(pharmacyPurchaseOrders)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        notes: reason ? `${po.notes ? po.notes + "\n" : ""}Cancelled: ${reason}` : po.notes,
      })
      .where(eq(pharmacyPurchaseOrders.id, id));
    return this.getById(organizationId, id);
  }

  /**
   * Approved (and later) POs are locked for line edits. Revision creates a new
   * draft PO linked via parentOrderId with bumped revision, copying lines
   * (optionally overridden). Original remains unchanged.
   */
  async revise(
    organizationId: string,
    id: string,
    body: {
      reason?: string;
      lines?: {
        medicineId: string;
        quantity: number;
        freeQuantity?: number;
        unitCostPkr?: number;
        discountPkr?: number;
        taxPkr?: number;
        notes?: string;
      }[];
    },
    userId?: string,
  ) {
    const parent = await this.getById(organizationId, id);
    if (["draft", "cancelled"].includes(parent.status)) {
      throw new BadRequestException("Revise is for approved/sent/confirmed POs; edit draft instead");
    }
    const sourceLines: {
      medicineId: string;
      quantity: number;
      freeQuantity?: number;
      unitCostPkr: number;
      discountPkr?: number;
      taxPkr?: number;
      notes?: string;
    }[] =
      body.lines?.length ?
        body.lines.map((l) => ({
          medicineId: l.medicineId,
          quantity: l.quantity,
          freeQuantity: l.freeQuantity,
          unitCostPkr: l.unitCostPkr ?? 0,
          discountPkr: l.discountPkr,
          taxPkr: l.taxPkr,
          notes: l.notes,
        }))
      : parent.lines.map((l) => ({
          medicineId: l.medicineId,
          quantity: l.quantity,
          freeQuantity: l.freeQuantity,
          unitCostPkr: l.unitCostPkr,
          discountPkr: l.discountPkr,
          taxPkr: l.taxPkr,
          notes: l.notes ?? undefined,
        }));

    return this.create(
      organizationId,
      {
        branchCode: (
          await this.db.select({ code: popsBranches.code }).from(popsBranches).where(eq(popsBranches.id, parent.branchId)).limit(1)
        )[0]!.code,
        supplierId: parent.supplierId ?? undefined,
        warehouseId: parent.warehouseId ?? undefined,
        expectedDate: parent.expectedDate ?? undefined,
        notes: [
          parent.notes,
          body.reason ? `Revision of ${parent.poNumber}: ${body.reason}` : `Revision of ${parent.poNumber}`,
        ]
          .filter(Boolean)
          .join("\n"),
        taxPkr: parent.taxPkr,
        discountPkr: parent.discountPkr,
        paymentTerms: parent.paymentTerms ?? undefined,
        lines: sourceLines,
      },
      userId,
    ).then(async (created) => {
      await this.db
        .update(pharmacyPurchaseOrders)
        .set({
          parentOrderId: parent.id,
          revision: parent.revision + 1,
        })
        .where(eq(pharmacyPurchaseOrders.id, created.id));
      return this.getById(organizationId, created.id);
    });
  }

  async assertReceivable(organizationId: string, purchaseOrderId: string, skipStatusCheck?: boolean) {
    const po = await this.getById(organizationId, purchaseOrderId);
    if (!skipStatusCheck && !PO_RECEIVABLE_STATUSES.has(po.status)) {
      throw new BadRequestException(
        `Cannot post GRN against PO in status ${po.status}; expected approved|sent|supplier_confirmed|partial`,
      );
    }
    return po;
  }

  async searchSuppliers(organizationId: string, q: string, branchCode?: string) {
    const clauses: SQL[] = [eq(popsSuppliers.organizationId, organizationId)];
    if (branchCode?.trim()) {
      const branch = await this.resolveBranch(organizationId, branchCode);
      clauses.push(eq(popsSuppliers.branchId, branch.id));
    }
    if (q.trim()) {
      const pattern = `%${q.trim()}%`;
      clauses.push(
        or(ilike(popsSuppliers.name, pattern), ilike(popsSuppliers.phone, pattern), ilike(popsSuppliers.email, pattern))!,
      );
    }
    return this.db
      .select({
        id: popsSuppliers.id,
        name: popsSuppliers.name,
        phone: popsSuppliers.phone,
        email: popsSuppliers.email,
        paymentTerms: popsSuppliers.paymentTerms,
        active: popsSuppliers.active,
      })
      .from(popsSuppliers)
      .where(and(...clauses))
      .orderBy(popsSuppliers.name)
      .limit(50);
  }

  async supplierSummary(organizationId: string, supplierId: string, branchCode?: string) {
    const [supplier] = await this.db
      .select()
      .from(popsSuppliers)
      .where(and(eq(popsSuppliers.id, supplierId), eq(popsSuppliers.organizationId, organizationId)))
      .limit(1);
    if (!supplier) throw new NotFoundException("Supplier not found");

    const clauses: SQL[] = [
      eq(pharmacyPurchaseOrders.organizationId, organizationId),
      eq(pharmacyPurchaseOrders.supplierId, supplierId),
    ];
    if (branchCode?.trim()) {
      const branch = await this.resolveBranch(organizationId, branchCode);
      clauses.push(eq(pharmacyPurchaseOrders.branchId, branch.id));
    }
    const [agg] = await this.db
      .select({
        orderCount: count(),
        totalPkr: sql<number>`coalesce(sum(${pharmacyPurchaseOrders.totalPkr}), 0)`,
      })
      .from(pharmacyPurchaseOrders)
      .where(and(...clauses));

    return {
      supplier,
      orderCount: Number(agg?.orderCount ?? 0),
      purchaseTotalPkr: Number(agg?.totalPkr ?? 0),
    };
  }
}
