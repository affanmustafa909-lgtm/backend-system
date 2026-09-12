import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, count, desc, eq, type SQL } from "drizzle-orm";
import {
  pharmacyMedicines,
  pharmacyPurchaseRequisitionLines,
  pharmacyPurchaseRequisitions,
  pharmacyWarehouses,
  popsBranches,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { normalizePage, pageResult, type PageResult } from "../inventory/batch-stock.service";
import { InventoryService } from "../inventory/inventory.service";
import { PurchaseNumberingService } from "./purchase-numbering.service";
import { PurchaseOrderService } from "./purchase-order.service";

export type RequisitionLineInput = {
  medicineId: string;
  requestedQty: number;
  suggestedQty?: number;
  preferredSupplierId?: string;
  lastPurchasePricePkr?: number | null;
  notes?: string;
};

@Injectable()
export class PurchaseRequisitionService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly numbering: PurchaseNumberingService,
    private readonly inventory: InventoryService,
    private readonly orders: PurchaseOrderService,
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
    filters: { branchCode?: string; status?: string; page?: number; pageSize?: number },
  ): Promise<PageResult<typeof pharmacyPurchaseRequisitions.$inferSelect>> {
    const { page, pageSize, offset } = normalizePage(filters.page, filters.pageSize);
    const clauses: SQL[] = [eq(pharmacyPurchaseRequisitions.organizationId, organizationId)];
    if (filters.branchCode?.trim()) {
      const branch = await this.resolveBranch(organizationId, filters.branchCode);
      clauses.push(eq(pharmacyPurchaseRequisitions.branchId, branch.id));
    }
    if (filters.status?.trim()) {
      clauses.push(eq(pharmacyPurchaseRequisitions.status, filters.status.trim()));
    }
    const where = and(...clauses);
    const [totalRow] = await this.db
      .select({ n: count() })
      .from(pharmacyPurchaseRequisitions)
      .where(where);
    const items = await this.db
      .select()
      .from(pharmacyPurchaseRequisitions)
      .where(where)
      .orderBy(desc(pharmacyPurchaseRequisitions.createdAt))
      .limit(pageSize)
      .offset(offset);
    return pageResult(items, Number(totalRow?.n ?? 0), page, pageSize);
  }

  async getById(organizationId: string, id: string) {
    const [req] = await this.db
      .select()
      .from(pharmacyPurchaseRequisitions)
      .where(
        and(
          eq(pharmacyPurchaseRequisitions.id, id),
          eq(pharmacyPurchaseRequisitions.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!req) throw new NotFoundException("Purchase requisition not found");
    const lines = await this.db
      .select({
        id: pharmacyPurchaseRequisitionLines.id,
        requisitionId: pharmacyPurchaseRequisitionLines.requisitionId,
        medicineId: pharmacyPurchaseRequisitionLines.medicineId,
        requestedQty: pharmacyPurchaseRequisitionLines.requestedQty,
        suggestedQty: pharmacyPurchaseRequisitionLines.suggestedQty,
        convertedQty: pharmacyPurchaseRequisitionLines.convertedQty,
        preferredSupplierId: pharmacyPurchaseRequisitionLines.preferredSupplierId,
        lastPurchasePricePkr: pharmacyPurchaseRequisitionLines.lastPurchasePricePkr,
        notes: pharmacyPurchaseRequisitionLines.notes,
        medicineName: pharmacyMedicines.name,
        medicineSku: pharmacyMedicines.sku,
      })
      .from(pharmacyPurchaseRequisitionLines)
      .leftJoin(pharmacyMedicines, eq(pharmacyPurchaseRequisitionLines.medicineId, pharmacyMedicines.id))
      .where(eq(pharmacyPurchaseRequisitionLines.requisitionId, id));
    return { ...req, lines };
  }

  async create(
    organizationId: string,
    input: {
      branchCode: string;
      warehouseId?: string;
      priority?: string;
      preferredSupplierId?: string;
      requiredDate?: string;
      notes?: string;
      lines: RequisitionLineInput[];
    },
    userId?: string,
  ) {
    if (!input.lines?.length) throw new BadRequestException("lines are required");
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    if (input.warehouseId) {
      const [wh] = await this.db
        .select()
        .from(pharmacyWarehouses)
        .where(eq(pharmacyWarehouses.id, input.warehouseId))
        .limit(1);
      if (!wh) throw new BadRequestException("Warehouse not found");
    }

    return this.numbering.withNumber(organizationId, "requisition", async (reqNumber) => {
      const [created] = await this.db
        .insert(pharmacyPurchaseRequisitions)
        .values({
          organizationId,
          branchId: branch.id,
          warehouseId: input.warehouseId ?? null,
          reqNumber,
          status: "draft",
          priority: input.priority ?? "normal",
          preferredSupplierId: input.preferredSupplierId ?? null,
          requestedByUserId: userId ?? null,
          requiredDate: input.requiredDate ?? null,
          notes: input.notes ?? null,
        })
        .returning();
      if (!created) throw new BadRequestException("Failed to create requisition");

      for (const line of input.lines) {
        await this.db.insert(pharmacyPurchaseRequisitionLines).values({
          requisitionId: created.id,
          medicineId: line.medicineId,
          requestedQty: Math.round(line.requestedQty),
          suggestedQty: Math.round(line.suggestedQty ?? line.requestedQty),
          preferredSupplierId: line.preferredSupplierId ?? input.preferredSupplierId ?? null,
          lastPurchasePricePkr:
            line.lastPurchasePricePkr === undefined || line.lastPurchasePricePkr === null
              ? null
              : Math.round(line.lastPurchasePricePkr),
          notes: line.notes ?? null,
        });
      }
      return this.getById(organizationId, created.id);
    });
  }

  async updateDraft(
    organizationId: string,
    id: string,
    patch: {
      priority?: string;
      preferredSupplierId?: string | null;
      requiredDate?: string | null;
      notes?: string | null;
      warehouseId?: string | null;
      lines?: RequisitionLineInput[];
    },
  ) {
    const req = await this.getById(organizationId, id);
    if (req.status !== "draft") throw new BadRequestException("Only draft requisitions can be updated");

    await this.db
      .update(pharmacyPurchaseRequisitions)
      .set({
        priority: patch.priority ?? req.priority,
        preferredSupplierId:
          patch.preferredSupplierId !== undefined ? patch.preferredSupplierId : req.preferredSupplierId,
        requiredDate: patch.requiredDate !== undefined ? patch.requiredDate : req.requiredDate,
        notes: patch.notes !== undefined ? patch.notes : req.notes,
        warehouseId: patch.warehouseId !== undefined ? patch.warehouseId : req.warehouseId,
        updatedAt: new Date(),
      })
      .where(eq(pharmacyPurchaseRequisitions.id, id));

    if (patch.lines?.length) {
      await this.db
        .delete(pharmacyPurchaseRequisitionLines)
        .where(eq(pharmacyPurchaseRequisitionLines.requisitionId, id));
      for (const line of patch.lines) {
        await this.db.insert(pharmacyPurchaseRequisitionLines).values({
          requisitionId: id,
          medicineId: line.medicineId,
          requestedQty: Math.round(line.requestedQty),
          suggestedQty: Math.round(line.suggestedQty ?? line.requestedQty),
          preferredSupplierId: line.preferredSupplierId ?? null,
          lastPurchasePricePkr:
            line.lastPurchasePricePkr === undefined || line.lastPurchasePricePkr === null
              ? null
              : Math.round(line.lastPurchasePricePkr),
          notes: line.notes ?? null,
        });
      }
    }
    return this.getById(organizationId, id);
  }

  async submit(organizationId: string, id: string) {
    const req = await this.getById(organizationId, id);
    if (req.status !== "draft") throw new BadRequestException(`Cannot submit in status ${req.status}`);
    if (!req.lines.length) throw new BadRequestException("Requisition has no lines");
    await this.db
      .update(pharmacyPurchaseRequisitions)
      .set({ status: "submitted", updatedAt: new Date() })
      .where(eq(pharmacyPurchaseRequisitions.id, id));
    return this.getById(organizationId, id);
  }

  async approve(organizationId: string, id: string, userId?: string) {
    const req = await this.getById(organizationId, id);
    if (req.status !== "submitted" && req.status !== "draft") {
      throw new BadRequestException(`Cannot approve in status ${req.status}`);
    }
    await this.db
      .update(pharmacyPurchaseRequisitions)
      .set({
        status: "approved",
        approvedByUserId: userId ?? null,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(pharmacyPurchaseRequisitions.id, id));
    return this.getById(organizationId, id);
  }

  async reject(organizationId: string, id: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException("reject reason is required");
    const req = await this.getById(organizationId, id);
    if (req.status !== "submitted" && req.status !== "draft") {
      throw new BadRequestException(`Cannot reject in status ${req.status}`);
    }
    await this.db
      .update(pharmacyPurchaseRequisitions)
      .set({
        status: "rejected",
        rejectReason: reason.trim(),
        updatedAt: new Date(),
      })
      .where(eq(pharmacyPurchaseRequisitions.id, id));
    return this.getById(organizationId, id);
  }

  async cancel(organizationId: string, id: string) {
    const req = await this.getById(organizationId, id);
    if (["converted", "cancelled"].includes(req.status)) {
      throw new BadRequestException(`Cannot cancel in status ${req.status}`);
    }
    await this.db
      .update(pharmacyPurchaseRequisitions)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(pharmacyPurchaseRequisitions.id, id));
    return this.getById(organizationId, id);
  }

  /**
   * Create a draft PO from remaining (requested - converted) qty on an approved requisition.
   */
  async convertToPo(
    organizationId: string,
    requisitionId: string,
    body: {
      supplierId: string;
      warehouseId?: string;
      branchCode?: string;
      expectedDate?: string;
      notes?: string;
      paymentTerms?: string;
    },
    userId?: string,
  ) {
    const req = await this.getById(organizationId, requisitionId);
    if (req.status !== "approved" && req.status !== "partially_converted") {
      throw new BadRequestException(`Cannot convert requisition in status ${req.status}`);
    }
    if (!body.supplierId) throw new BadRequestException("supplierId is required");

    const remaining = req.lines
      .map((l) => ({
        ...l,
        remainingQty: Math.max(0, l.requestedQty - l.convertedQty),
      }))
      .filter((l) => l.remainingQty > 0);
    if (!remaining.length) throw new BadRequestException("No remaining quantity to convert");

    const [branch] = await this.db
      .select()
      .from(popsBranches)
      .where(eq(popsBranches.id, req.branchId))
      .limit(1);
    if (!branch) throw new NotFoundException("Branch not found");

    const po = await this.orders.create(
      organizationId,
      {
        branchCode: body.branchCode?.trim() || branch.code,
        supplierId: body.supplierId,
        warehouseId: body.warehouseId ?? req.warehouseId ?? undefined,
        requisitionId: req.id,
        expectedDate: body.expectedDate ?? req.requiredDate ?? undefined,
        notes: body.notes ?? `From requisition ${req.reqNumber}`,
        paymentTerms: body.paymentTerms,
        lines: remaining.map((l) => ({
          medicineId: l.medicineId,
          quantity: l.remainingQty,
          unitCostPkr: l.lastPurchasePricePkr ?? 0,
        })),
      },
      userId,
    );

    for (const line of remaining) {
      await this.db
        .update(pharmacyPurchaseRequisitionLines)
        .set({ convertedQty: line.convertedQty + line.remainingQty })
        .where(eq(pharmacyPurchaseRequisitionLines.id, line.id));
    }

    const refreshed = await this.getById(organizationId, requisitionId);
    const stillOpen = refreshed.lines.some((l) => l.convertedQty < l.requestedQty);
    await this.db
      .update(pharmacyPurchaseRequisitions)
      .set({
        status: stillOpen ? "partially_converted" : "converted",
        updatedAt: new Date(),
      })
      .where(eq(pharmacyPurchaseRequisitions.id, requisitionId));

    return { purchaseOrder: po, requisition: await this.getById(organizationId, requisitionId) };
  }

  /**
   * Draft requisition from Phase 4 InventoryService.reorderSuggestions — no duplicate math.
   */
  async fromReorder(
    organizationId: string,
    input: {
      branchCode: string;
      warehouseId?: string;
      medicineIds?: string[];
      preferredSupplierId?: string;
      notes?: string;
    },
    userId?: string,
  ) {
    const suggestions = await this.inventory.reorderSuggestions(organizationId, {
      branchCode: input.branchCode,
      warehouseId: input.warehouseId,
      page: 1,
      pageSize: 500,
    });

    let rows = suggestions.items;
    if (input.medicineIds?.length) {
      const allow = new Set(input.medicineIds);
      rows = rows.filter((r) => allow.has(r.medicineId));
    }
    if (!rows.length) {
      throw new BadRequestException("No reorder suggestions matched; nothing to requisition");
    }

    return this.create(
      organizationId,
      {
        branchCode: input.branchCode,
        warehouseId: input.warehouseId,
        preferredSupplierId: input.preferredSupplierId,
        notes: input.notes ?? `From reorder suggestions (${suggestions.formula})`,
        lines: rows.map((r) => ({
          medicineId: r.medicineId,
          requestedQty: Math.max(1, Math.round(Number(r.suggestedQty) || 1)),
          suggestedQty: Math.max(1, Math.round(Number(r.suggestedQty) || 1)),
        })),
      },
      userId,
    );
  }
}
