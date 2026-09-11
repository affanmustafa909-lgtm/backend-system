import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import {
  pharmacyMedicineBatches,
  pharmacyMedicines,
  pharmacyStockReservations,
  pharmacyWarehouses,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../drizzle/drizzle.tokens";
import { FefoService } from "./inventory/fefo.service";
import { InventorySettingsService } from "./inventory/inventory-settings.service";
import {
  MOVEMENT_TYPES,
  StockLedgerService,
  type StockState,
} from "./inventory/stock-ledger.service";

export type StockTx = Pick<PlatformPgDb, "select" | "insert" | "update" | "delete" | "execute">;

/**
 * Fallback mapping so pre-Phase-4 callers that pass only a `referenceType`
 * still produce a correctly typed ledger entry. Before Phase 4 every deduction
 * was logged as `sale_out`, which mislabelled purchase returns and transfers.
 */
const DEDUCT_TYPE_BY_REFERENCE: Record<string, string> = {
  sale: MOVEMENT_TYPES.SALE,
  dist_invoice: MOVEMENT_TYPES.SALE,
  prescription: MOVEMENT_TYPES.SALE,
  purchase_return: MOVEMENT_TYPES.PURCHASE_RETURN,
  transfer: MOVEMENT_TYPES.TRANSFER_OUT,
  stock_transfer: MOVEMENT_TYPES.TRANSFER_OUT,
  adjustment: MOVEMENT_TYPES.ADJUSTMENT_OUT,
  stock_count: MOVEMENT_TYPES.STOCK_COUNT,
  damage: MOVEMENT_TYPES.DAMAGE,
  expiry: MOVEMENT_TYPES.EXPIRY,
};

const RESTORE_TYPE_BY_REFERENCE: Record<string, string> = {
  sale_return: MOVEMENT_TYPES.SALES_RETURN,
  wholesale_return: MOVEMENT_TYPES.SALES_RETURN,
  transfer: MOVEMENT_TYPES.TRANSFER_IN,
  stock_transfer: MOVEMENT_TYPES.TRANSFER_IN,
  adjustment: MOVEMENT_TYPES.ADJUSTMENT_IN,
  stock_count: MOVEMENT_TYPES.STOCK_COUNT,
  opening_stock: MOVEMENT_TYPES.OPENING_STOCK,
};

/** The buckets a batch quantity can sit in. `available` is the `quantity` column. */
const STATE_COLUMN: Record<Exclude<StockState, "available">, "reservedQuantity" | "damagedQuantity" | "quarantineQuantity" | "blockedQuantity"> = {
  reserved: "reservedQuantity",
  damaged: "damagedQuantity",
  quarantine: "quarantineQuantity",
  blocked: "blockedQuantity",
};

@Injectable()
export class PharmacyStockEngine {
  private readonly logger = new Logger(PharmacyStockEngine.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly fefo: FefoService,
    private readonly ledger: StockLedgerService,
    private readonly settings: InventorySettingsService,
  ) {}

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

  /**
   * Refreshes the `pharmacy_medicines.currentStock` cache.
   *
   * `currentStock` is a denormalised cache of the AVAILABLE bucket
   * (`SUM(batches.quantity)`), kept for backward compatibility with existing
   * screens and reports. It is not the source of truth — batch rows are.
   * Accurate sellable stock comes from StockAvailabilityService, which also
   * excludes expired and on-hold batches.
   */
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
      stockState?: StockState;
      unitCostPkr?: number;
      referenceType?: string;
      referenceId?: string;
      idempotencyKey?: string | null;
      notes?: string;
      createdByUserId?: string;
    },
  ) {
    await this.ledger.append(tx, {
      organizationId: input.organizationId,
      branchId: input.branchId,
      warehouseId: input.warehouseId ?? null,
      medicineId: input.medicineId,
      batchId: input.batchId ?? null,
      movementType: input.movementType,
      quantityDelta: input.quantityDelta,
      quantityAfter: input.quantityAfter,
      stockState: input.stockState ?? "available",
      unitCostPkr: input.unitCostPkr ?? 0,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      notes: input.notes ?? null,
      createdByUserId: input.createdByUserId ?? null,
    });
  }

  /**
   * FEFO deduct from the AVAILABLE bucket.
   *
   * Phase 4 hardening, all backward compatible with existing callers:
   *  - expired and on-hold batches are excluded (policy `blockExpiredSale`)
   *  - candidate rows are locked `FOR UPDATE`, so concurrent sales cannot oversell
   *  - the ledger records the real movement type instead of always `sale_out`
   *  - a preferred batch may now cover the line partially, with FEFO taking the rest
   *  - the negative-stock policy decides what happens on a shortfall (default: block)
   *
   * Returns the primary batch id used, matching the previous contract.
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
      /** Canonical ledger type. Derived from referenceType when omitted. */
      movementType?: string;
      idempotencyKey?: string | null;
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

    const warehouseId =
      input.warehouseId ??
      (await this.ensureDefaultWarehouse(input.organizationId, input.branchId, tx)).id;

    const settings = await this.settings.getSettings(input.organizationId, input.branchId);
    const movementType =
      input.movementType ??
      DEDUCT_TYPE_BY_REFERENCE[(input.referenceType ?? "").toLowerCase()] ??
      MOVEMENT_TYPES.SALE;

    const plan = await this.fefo.plan(
      {
        organizationId: input.organizationId,
        branchId: input.branchId,
        medicineId: input.medicineId,
        qty: input.qty,
        warehouseId,
        preferredBatchId: input.preferredBatchId ?? null,
        allowExpired: !settings.blockExpiredSale,
        lock: true,
      },
      tx,
    );

    if (plan.shortfall > 0 && settings.negativeStockPolicy === "block") {
      // Explain *why* rather than just "insufficient stock": the most common
      // real cause is that the only remaining batches are expired or on hold.
      const skipped = plan.excluded.length
        ? ` Unavailable: ${plan.excluded
            .map((e) => `${e.batchNumber} (${e.reason}, ${e.quantity})`)
            .join("; ")}.`
        : "";
      throw new BadRequestException(
        `Insufficient available stock for ${med.name}. Short by ${plan.shortfall} ${med.unit}.${skipped}`,
      );
    }

    let usedBatchId: string | null = null;

    for (const [index, alloc] of plan.allocations.entries()) {
      const after = await this.applyBatchDelta(tx, alloc.batchId, "available", -alloc.quantity);
      if (!usedBatchId) usedBatchId = alloc.batchId;
      await this.logMovement(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        warehouseId: alloc.warehouseId ?? warehouseId,
        medicineId: input.medicineId,
        batchId: alloc.batchId,
        movementType,
        quantityDelta: -alloc.quantity,
        quantityAfter: after,
        unitCostPkr: alloc.unitCostPkr,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        // One deduction can span several batches, so the caller's key is
        // suffixed per allocation — a bare key would collide with itself
        // against the unique (organization_id, idempotency_key) index.
        idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}#${index}` : null,
        notes: alloc.overridden ? "FEFO overridden: operator selected this batch" : undefined,
        createdByUserId: input.createdByUserId,
      });
    }

    // Policy allows going short. The remainder is driven negative against the
    // FEFO-nearest batch and flagged in the ledger so it is never invisible.
    if (plan.shortfall > 0) {
      const target = plan.allocations[0]?.batchId ?? null;
      if (!target) {
        throw new BadRequestException(
          `No batch exists for ${med.name}; cannot record negative stock without a batch.`,
        );
      }
      if (settings.negativeStockPolicy === "warn") {
        // `allow` goes short silently; `warn` must leave a trace an operator can
        // find without reading the ledger, so it is raised to the server log too.
        this.logger.warn(
          `Negative stock: ${med.name} (${med.sku}) short by ${plan.shortfall} ${med.unit} ` +
            `on ${input.referenceType ?? "unknown"} ${input.referenceId ?? "-"}, warehouse ${warehouseId}`,
        );
      }
      const after = await this.applyBatchDelta(tx, target, "available", -plan.shortfall);
      await this.logMovement(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        warehouseId,
        medicineId: input.medicineId,
        batchId: target,
        movementType,
        quantityDelta: -plan.shortfall,
        quantityAfter: after,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}#short` : null,
        notes: `Negative stock permitted by policy (${settings.negativeStockPolicy}); short by ${plan.shortfall}`,
        createdByUserId: input.createdByUserId,
      });
      if (!usedBatchId) usedBatchId = target;
    }

    await this.recomputeMedicineStock(input.medicineId, tx);
    return usedBatchId;
  }

  /**
   * Applies a signed delta to one bucket of one batch and returns the new value.
   * The row is locked first so concurrent writers serialise.
   */
  private async applyBatchDelta(
    tx: StockTx,
    batchId: string,
    state: StockState,
    delta: number,
  ): Promise<number> {
    const [batch] = await tx
      .select()
      .from(pharmacyMedicineBatches)
      .where(eq(pharmacyMedicineBatches.id, batchId))
      .limit(1)
      .for("update");
    if (!batch) throw new NotFoundException("Batch not found");

    if (state === "available") {
      const after = batch.quantity + delta;
      await tx
        .update(pharmacyMedicineBatches)
        .set({ quantity: after })
        .where(eq(pharmacyMedicineBatches.id, batchId));
      return after;
    }

    const after = (batch[STATE_COLUMN[state]] ?? 0) + delta;
    if (after < 0) {
      throw new BadRequestException(`Cannot reduce ${state} quantity below zero on batch ${batch.batchNumber}`);
    }
    const patch =
      state === "reserved"
        ? { reservedQuantity: after }
        : state === "damaged"
          ? { damagedQuantity: after }
          : state === "quarantine"
            ? { quarantineQuantity: after }
            : { blockedQuantity: after };
    await tx
      .update(pharmacyMedicineBatches)
      .set(patch)
      .where(eq(pharmacyMedicineBatches.id, batchId));
    return after;
  }

  /**
   * Moves quantity between two states of the same batch (for example available →
   * damaged). Physical stock is unchanged; only its classification moves, and
   * both legs are written to the ledger.
   */
  async moveBetweenStates(
    tx: StockTx,
    input: {
      organizationId: string;
      branchId: string;
      medicineId: string;
      batchId: string;
      from: StockState;
      to: StockState;
      qty: number;
      warehouseId?: string | null;
      movementType: string;
      unitCostPkr?: number;
      referenceType?: string;
      referenceId?: string;
      notes?: string;
      createdByUserId?: string;
    },
  ): Promise<void> {
    const qty = Math.floor(input.qty);
    if (qty <= 0) throw new BadRequestException("Quantity must be positive");
    if (input.from === input.to) throw new BadRequestException("Source and target state must differ");

    const afterFrom = await this.applyBatchDelta(tx, input.batchId, input.from, -qty);
    if (input.from === "available" && afterFrom < 0) {
      throw new BadRequestException("Insufficient available quantity in batch");
    }
    const afterTo = await this.applyBatchDelta(tx, input.batchId, input.to, qty);

    await this.logMovement(tx, {
      organizationId: input.organizationId,
      branchId: input.branchId,
      warehouseId: input.warehouseId,
      medicineId: input.medicineId,
      batchId: input.batchId,
      movementType: input.movementType,
      quantityDelta: -qty,
      quantityAfter: afterFrom,
      stockState: input.from,
      unitCostPkr: input.unitCostPkr,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      notes: input.notes ?? `Moved ${qty} from ${input.from} to ${input.to}`,
      createdByUserId: input.createdByUserId,
    });
    await this.logMovement(tx, {
      organizationId: input.organizationId,
      branchId: input.branchId,
      warehouseId: input.warehouseId,
      medicineId: input.medicineId,
      batchId: input.batchId,
      movementType: input.movementType,
      quantityDelta: qty,
      quantityAfter: afterTo,
      stockState: input.to,
      unitCostPkr: input.unitCostPkr,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      notes: input.notes ?? `Moved ${qty} from ${input.from} to ${input.to}`,
      createdByUserId: input.createdByUserId,
    });

    await this.recomputeMedicineStock(input.medicineId, tx);
  }

  /**
   * Holds stock for a document. Reserved units stay physically present but stop
   * being sellable, so the same units can never be promised to two orders.
   */
  async reserve(
    tx: StockTx,
    input: {
      organizationId: string;
      branchId: string;
      medicineId: string;
      qty: number;
      warehouseId?: string;
      preferredBatchId?: string;
      referenceType: string;
      referenceId: string;
      expiresAt?: Date | null;
      createdByUserId?: string;
    },
  ): Promise<{ reserved: number; shortfall: number }> {
    const qty = Math.floor(input.qty);
    if (qty <= 0) return { reserved: 0, shortfall: 0 };

    const warehouseId =
      input.warehouseId ??
      (await this.ensureDefaultWarehouse(input.organizationId, input.branchId, tx)).id;
    const settings = await this.settings.getSettings(input.organizationId, input.branchId);

    const plan = await this.fefo.plan(
      {
        organizationId: input.organizationId,
        branchId: input.branchId,
        medicineId: input.medicineId,
        qty,
        warehouseId,
        preferredBatchId: input.preferredBatchId ?? null,
        allowExpired: !settings.blockExpiredSale,
        lock: true,
      },
      tx,
    );

    if (plan.shortfall > 0 && settings.negativeStockPolicy === "block") {
      throw new BadRequestException(`Cannot reserve ${qty}: short by ${plan.shortfall}`);
    }

    for (const alloc of plan.allocations) {
      await this.applyBatchDelta(tx, alloc.batchId, "available", -alloc.quantity);
      const afterReserved = await this.applyBatchDelta(tx, alloc.batchId, "reserved", alloc.quantity);
      await tx.insert(pharmacyStockReservations).values({
        organizationId: input.organizationId,
        branchId: input.branchId,
        warehouseId: alloc.warehouseId ?? warehouseId,
        medicineId: input.medicineId,
        batchId: alloc.batchId,
        quantity: alloc.quantity,
        status: "active",
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        expiresAt: input.expiresAt ?? null,
        createdByUserId: input.createdByUserId ?? null,
      });
      await this.logMovement(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        warehouseId: alloc.warehouseId ?? warehouseId,
        medicineId: input.medicineId,
        batchId: alloc.batchId,
        movementType: MOVEMENT_TYPES.RESERVATION,
        quantityDelta: alloc.quantity,
        quantityAfter: afterReserved,
        stockState: "reserved",
        unitCostPkr: alloc.unitCostPkr,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        createdByUserId: input.createdByUserId,
      });
    }

    await this.recomputeMedicineStock(input.medicineId, tx);
    return { reserved: plan.allocated, shortfall: plan.shortfall };
  }

  /**
   * Releases active reservations for a document reference, returning the units
   * to the available bucket. Idempotent: releasing twice is a no-op.
   */
  async releaseReservations(
    tx: StockTx,
    input: {
      organizationId: string;
      branchId: string;
      referenceType: string;
      referenceId: string;
      /** `consumed` when the document shipped, `released` when it was cancelled. */
      outcome?: "released" | "consumed";
      createdByUserId?: string;
    },
  ): Promise<number> {
    const rows = await tx
      .select()
      .from(pharmacyStockReservations)
      .where(
        and(
          eq(pharmacyStockReservations.organizationId, input.organizationId),
          eq(pharmacyStockReservations.branchId, input.branchId),
          eq(pharmacyStockReservations.referenceType, input.referenceType),
          eq(pharmacyStockReservations.referenceId, input.referenceId),
          eq(pharmacyStockReservations.status, "active"),
        ),
      );
    if (!rows.length) return 0;

    const outcome = input.outcome ?? "released";
    const touched = new Set<string>();

    for (const row of rows) {
      if (!row.batchId) continue;
      const afterReserved = await this.applyBatchDelta(tx, row.batchId, "reserved", -row.quantity);
      // `released` puts the units back on the shelf. `consumed` means the
      // physical deduction is handled by the shipping document instead.
      const afterAvailable =
        outcome === "released"
          ? await this.applyBatchDelta(tx, row.batchId, "available", row.quantity)
          : afterReserved;

      await tx
        .update(pharmacyStockReservations)
        .set({ status: outcome, releasedAt: new Date() })
        .where(eq(pharmacyStockReservations.id, row.id));

      await this.logMovement(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        warehouseId: row.warehouseId,
        medicineId: row.medicineId,
        batchId: row.batchId,
        movementType: MOVEMENT_TYPES.RELEASE,
        quantityDelta: outcome === "released" ? row.quantity : -row.quantity,
        quantityAfter: outcome === "released" ? afterAvailable : afterReserved,
        stockState: outcome === "released" ? "available" : "reserved",
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        notes: `Reservation ${outcome}`,
        createdByUserId: input.createdByUserId,
      });
      touched.add(row.medicineId);
    }

    for (const medicineId of touched) {
      await this.recomputeMedicineStock(medicineId, tx);
    }
    return rows.length;
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
      unitCostPkr?: number;
      idempotencyKey?: string | null;
      createdByUserId?: string;
    },
  ): Promise<void> {
    if (input.qty <= 0) return;
    const warehouseId =
      input.warehouseId ??
      (await this.ensureDefaultWarehouse(input.organizationId, input.branchId, tx)).id;

    const movementType =
      input.movementType ??
      RESTORE_TYPE_BY_REFERENCE[(input.referenceType ?? "").toLowerCase()] ??
      MOVEMENT_TYPES.SALES_RETURN;

    if (input.batchId) {
      const [batch] = await tx
        .select()
        .from(pharmacyMedicineBatches)
        .where(eq(pharmacyMedicineBatches.id, input.batchId))
        .limit(1);
      if (!batch) throw new NotFoundException("Batch not found for restore");
      const after = await this.applyBatchDelta(tx, batch.id, "available", input.qty);
      await this.logMovement(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        warehouseId: batch.warehouseId ?? warehouseId,
        medicineId: input.medicineId,
        batchId: batch.id,
        movementType,
        quantityDelta: input.qty,
        quantityAfter: after,
        unitCostPkr: input.unitCostPkr ?? batch.purchaseRatePkr ?? 0,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        idempotencyKey: input.idempotencyKey ?? null,
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
        movementType,
        quantityDelta: input.qty,
        quantityAfter: input.qty,
        unitCostPkr: input.unitCostPkr ?? 0,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        idempotencyKey: input.idempotencyKey ?? null,
        notes: "Batch could not be identified on the source document; synthetic batch created",
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
      supplierId?: string | null;
      grnId?: string | null;
      referenceType?: string;
      referenceId?: string;
      movementType?: string;
      idempotencyKey?: string | null;
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
          supplierId: input.supplierId ?? existing.supplierId,
          grnId: input.grnId ?? existing.grnId,
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
          supplierId: input.supplierId ?? null,
          grnId: input.grnId ?? null,
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
      movementType: input.movementType ?? MOVEMENT_TYPES.GRN,
      quantityDelta: qty,
      quantityAfter: after,
      unitCostPkr: input.purchaseRatePkr ?? 0,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey ?? null,
      createdByUserId: input.createdByUserId,
    });
    await this.recomputeMedicineStock(input.medicineId, tx);
    return batchId;
  }
}
