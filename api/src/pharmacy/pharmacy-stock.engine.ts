import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  pharmacyMedicineBatches,
  pharmacyMedicines,
  pharmacyStockMovements,
  pharmacyWarehouses,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../drizzle/drizzle.tokens";

export type StockTx = Pick<PlatformPgDb, "select" | "insert" | "update" | "delete" | "execute">;

@Injectable()
export class PharmacyStockEngine {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  async ensureDefaultWarehouse(
    organizationId: string,
    branchId: string,
    tx: StockTx = this.db,
  ): Promise<{ id: string; code: string; name: string }> {
    const [existing] = await tx
      .select()
      .from(pharmacyWarehouses)
      .where(
        and(
          eq(pharmacyWarehouses.organizationId, organizationId),
          eq(pharmacyWarehouses.branchId, branchId),
          eq(pharmacyWarehouses.isDefault, true),
        ),
      )
      .limit(1);
    if (existing) return existing;

    const [anyWh] = await tx
      .select()
      .from(pharmacyWarehouses)
      .where(
        and(eq(pharmacyWarehouses.organizationId, organizationId), eq(pharmacyWarehouses.branchId, branchId)),
      )
      .limit(1);
    if (anyWh) {
      await tx
        .update(pharmacyWarehouses)
        .set({ isDefault: true })
        .where(eq(pharmacyWarehouses.id, anyWh.id));
      return anyWh;
    }

    const [created] = await tx
      .insert(pharmacyWarehouses)
      .values({
        organizationId,
        branchId,
        code: "MAIN",
        name: "Main Warehouse",
        isDefault: true,
        status: "active",
      })
      .returning();
    if (!created) throw new BadRequestException("Failed to create default warehouse");
    return created;
  }

  async recomputeMedicineStock(medicineId: string, tx: StockTx = this.db): Promise<number> {
    const [row] = await tx
      .select({
        total: sql<number>`coalesce(sum(${pharmacyMedicineBatches.quantity}), 0)`,
      })
      .from(pharmacyMedicineBatches)
      .where(eq(pharmacyMedicineBatches.medicineId, medicineId));
    const total = Number(row?.total ?? 0);
    await tx
      .update(pharmacyMedicines)
      .set({ currentStock: total })
      .where(eq(pharmacyMedicines.id, medicineId));
    return total;
  }

  private async logMovement(
    tx: StockTx,
    input: {
      organizationId: string;
      branchId: string;
      warehouseId?: string | null;
      medicineId: string;
      batchId?: string | null;
      movementType: string;
      quantityDelta: number;
      quantityAfter: number;
      referenceType?: string;
      referenceId?: string;
      notes?: string;
      createdByUserId?: string;
    },
  ) {
    await tx.insert(pharmacyStockMovements).values({
      organizationId: input.organizationId,
      branchId: input.branchId,
      warehouseId: input.warehouseId ?? null,
      medicineId: input.medicineId,
      batchId: input.batchId ?? null,
      movementType: input.movementType,
      quantityDelta: input.quantityDelta,
      quantityAfter: input.quantityAfter,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      notes: input.notes ?? null,
      createdByUserId: input.createdByUserId ?? null,
    });
  }

  /**
   * FEFO deduct within a warehouse (or any warehouse for medicine if warehouse omitted).
   * Returns primary batch id used (first batch touched).
   */
  async deductFefo(
    tx: StockTx,
    input: {
      organizationId: string;
      branchId: string;
      medicineId: string;
      qty: number;
      warehouseId?: string;
      preferredBatchId?: string;
      referenceType?: string;
      referenceId?: string;
      createdByUserId?: string;
    },
  ): Promise<string | null> {
    if (input.qty <= 0) return null;

    const [med] = await tx
      .select()
      .from(pharmacyMedicines)
      .where(
        and(
          eq(pharmacyMedicines.id, input.medicineId),
          eq(pharmacyMedicines.organizationId, input.organizationId),
          eq(pharmacyMedicines.branchId, input.branchId),
        ),
      )
      .limit(1);
    if (!med) throw new NotFoundException("Medicine not found for this branch");
    if (med.currentStock < input.qty) {
      throw new BadRequestException(`Insufficient stock for ${med.name}`);
    }

    const warehouseId =
      input.warehouseId ??
      (await this.ensureDefaultWarehouse(input.organizationId, input.branchId, tx)).id;

    let usedBatchId: string | null = null;
    let remaining = input.qty;

    if (input.preferredBatchId) {
      const [batch] = await tx
        .select()
        .from(pharmacyMedicineBatches)
        .where(
          and(
            eq(pharmacyMedicineBatches.id, input.preferredBatchId),
            eq(pharmacyMedicineBatches.medicineId, input.medicineId),
            sql`${pharmacyMedicineBatches.quantity} > 0`,
          ),
        )
        .limit(1);
      if (!batch) throw new BadRequestException("Selected batch is unavailable");
      if (batch.quantity < input.qty) {
        throw new BadRequestException("Insufficient quantity in selected batch");
      }
      const after = batch.quantity - input.qty;
      await tx
        .update(pharmacyMedicineBatches)
        .set({ quantity: after })
        .where(eq(pharmacyMedicineBatches.id, batch.id));
      usedBatchId = batch.id;
      remaining = 0;
      await this.logMovement(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        warehouseId: batch.warehouseId ?? warehouseId,
        medicineId: input.medicineId,
        batchId: batch.id,
        movementType: "sale_out",
        quantityDelta: -input.qty,
        quantityAfter: after,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        createdByUserId: input.createdByUserId,
      });
    }

    if (remaining > 0) {
      const batches = await tx
        .select()
        .from(pharmacyMedicineBatches)
        .where(
          and(
            eq(pharmacyMedicineBatches.medicineId, input.medicineId),
            sql`${pharmacyMedicineBatches.quantity} > 0`,
            sql`(${pharmacyMedicineBatches.warehouseId} = ${warehouseId} OR ${pharmacyMedicineBatches.warehouseId} IS NULL)`,
          ),
        )
        .orderBy(asc(pharmacyMedicineBatches.expiryDate));

      for (const batch of batches) {
        if (remaining <= 0) break;
        const take = Math.min(batch.quantity, remaining);
        const after = batch.quantity - take;
        await tx
          .update(pharmacyMedicineBatches)
          .set({ quantity: after })
          .where(eq(pharmacyMedicineBatches.id, batch.id));
        if (!usedBatchId) usedBatchId = batch.id;
        remaining -= take;
        await this.logMovement(tx, {
          organizationId: input.organizationId,
          branchId: input.branchId,
          warehouseId: batch.warehouseId ?? warehouseId,
          medicineId: input.medicineId,
          batchId: batch.id,
          movementType: "sale_out",
          quantityDelta: -take,
          quantityAfter: after,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          createdByUserId: input.createdByUserId,
        });
      }
    }

    if (remaining > 0) {
      throw new BadRequestException(`Insufficient batch stock for medicine ${med.name}`);
    }

    await this.recomputeMedicineStock(input.medicineId, tx);
    return usedBatchId;
  }

  async restoreBatch(
    tx: StockTx,
    input: {
      organizationId: string;
      branchId: string;
      medicineId: string;
      batchId: string | null | undefined;
      qty: number;
      warehouseId?: string;
      referenceType?: string;
      referenceId?: string;
      movementType?: string;
      createdByUserId?: string;
    },
  ): Promise<void> {
    if (input.qty <= 0) return;
    const warehouseId =
      input.warehouseId ??
      (await this.ensureDefaultWarehouse(input.organizationId, input.branchId, tx)).id;

    if (input.batchId) {
      const [batch] = await tx
        .select()
        .from(pharmacyMedicineBatches)
        .where(eq(pharmacyMedicineBatches.id, input.batchId))
        .limit(1);
      if (!batch) throw new NotFoundException("Batch not found for restore");
      const after = batch.quantity + input.qty;
      await tx
        .update(pharmacyMedicineBatches)
        .set({ quantity: after })
        .where(eq(pharmacyMedicineBatches.id, batch.id));
      await this.logMovement(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        warehouseId: batch.warehouseId ?? warehouseId,
        medicineId: input.medicineId,
        batchId: batch.id,
        movementType: input.movementType ?? "return_in",
        quantityDelta: input.qty,
        quantityAfter: after,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        createdByUserId: input.createdByUserId,
      });
    } else {
      const [created] = await tx
        .insert(pharmacyMedicineBatches)
        .values({
          medicineId: input.medicineId,
          warehouseId,
          batchNumber: `RESTORE-${Date.now().toString().slice(-6)}`,
          expiryDate: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
          quantity: input.qty,
        })
        .returning();
      await this.logMovement(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        warehouseId,
        medicineId: input.medicineId,
        batchId: created?.id,
        movementType: input.movementType ?? "return_in",
        quantityDelta: input.qty,
        quantityAfter: input.qty,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        createdByUserId: input.createdByUserId,
      });
    }

    await this.recomputeMedicineStock(input.medicineId, tx);
  }

  async receiveBatch(
    tx: StockTx,
    input: {
      organizationId: string;
      branchId: string;
      warehouseId: string;
      medicineId: string;
      batchNumber: string;
      expiryDate: string;
      manufacturingDate?: string | null;
      quantity: number;
      freeQuantity?: number;
      purchaseRatePkr?: number;
      saleRatePkr?: number;
      referenceType?: string;
      referenceId?: string;
      createdByUserId?: string;
    },
  ): Promise<string> {
    const qty = input.quantity + (input.freeQuantity ?? 0);
    if (qty <= 0) throw new BadRequestException("Receive quantity must be positive");

    const [existing] = await tx
      .select()
      .from(pharmacyMedicineBatches)
      .where(
        and(
          eq(pharmacyMedicineBatches.medicineId, input.medicineId),
          eq(pharmacyMedicineBatches.batchNumber, input.batchNumber),
          sql`(${pharmacyMedicineBatches.warehouseId} = ${input.warehouseId} OR ${pharmacyMedicineBatches.warehouseId} IS NULL)`,
        ),
      )
      .limit(1);

    let batchId: string;
    let after: number;
    if (existing) {
      after = existing.quantity + qty;
      await tx
        .update(pharmacyMedicineBatches)
        .set({
          quantity: after,
          warehouseId: existing.warehouseId ?? input.warehouseId,
          freeQuantity: (existing.freeQuantity ?? 0) + (input.freeQuantity ?? 0),
          purchaseRatePkr: input.purchaseRatePkr ?? existing.purchaseRatePkr,
          saleRatePkr: input.saleRatePkr ?? existing.saleRatePkr,
        })
        .where(eq(pharmacyMedicineBatches.id, existing.id));
      batchId = existing.id;
    } else {
      const [created] = await tx
        .insert(pharmacyMedicineBatches)
        .values({
          medicineId: input.medicineId,
          warehouseId: input.warehouseId,
          batchNumber: input.batchNumber,
          manufacturingDate: input.manufacturingDate ?? null,
          expiryDate: input.expiryDate,
          quantity: qty,
          freeQuantity: input.freeQuantity ?? 0,
          purchaseRatePkr: input.purchaseRatePkr ?? 0,
          saleRatePkr: input.saleRatePkr ?? 0,
        })
        .returning();
      if (!created) throw new BadRequestException("Failed to create batch");
      batchId = created.id;
      after = qty;
    }

    await this.logMovement(tx, {
      organizationId: input.organizationId,
      branchId: input.branchId,
      warehouseId: input.warehouseId,
      medicineId: input.medicineId,
      batchId,
      movementType: "grn_in",
      quantityDelta: qty,
      quantityAfter: after,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      createdByUserId: input.createdByUserId,
    });
    await this.recomputeMedicineStock(input.medicineId, tx);
    return batchId;
  }
}
