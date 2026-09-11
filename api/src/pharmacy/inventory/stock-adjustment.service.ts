import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, type SQL } from "drizzle-orm";
import {
  pharmacyAuditLogs,
  pharmacyMedicineBatches,
  pharmacyMedicines,
  pharmacyStockAdjustmentLines,
  pharmacyStockAdjustments,
  pharmacyWarehouses,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { PharmacyStockEngine, type StockTx } from "../pharmacy-stock.engine";
import { InventoryNumberingService } from "./inventory-numbering.service";
import { InventorySettingsService } from "./inventory-settings.service";
import { MOVEMENT_TYPES, type StockState } from "./stock-ledger.service";
import { StockAvailabilityService } from "./stock-availability.service";

export type PageResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export const ADJUSTMENT_TYPES = [
  "increase",
  "decrease",
  "damage",
  "expiry",
  "write_off",
  "quarantine",
  "release",
] as const;

export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

export type AdjustmentStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "posted"
  | "cancelled";

const ADJUSTMENT_STATUSES: AdjustmentStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "posted",
  "cancelled",
];

/**
 * What each adjustment type actually does to stock.
 *
 * `direction` is the sign of the effect on the AVAILABLE bucket and is what the
 * stored line quantity carries, so a report can sum line quantities without
 * knowing the document type. `targetState` is the bucket the units end up in.
 */
const TYPE_SEMANTICS: Record<
  AdjustmentType,
  { targetState: StockState; direction: 1 | -1; requiresBatch: boolean }
> = {
  increase: { targetState: "available", direction: 1, requiresBatch: false },
  decrease: { targetState: "available", direction: -1, requiresBatch: false },
  write_off: { targetState: "available", direction: -1, requiresBatch: false },
  damage: { targetState: "damaged", direction: -1, requiresBatch: true },
  expiry: { targetState: "blocked", direction: -1, requiresBatch: true },
  quarantine: { targetState: "quarantine", direction: -1, requiresBatch: true },
  release: { targetState: "available", direction: 1, requiresBatch: true },
};

export type AdjustmentRow = {
  id: string;
  adjustmentNumber: string;
  status: string;
  adjustmentType: string;
  branchId: string;
  warehouseId: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  reason: string;
  notes: string | null;
  rejectReason: string | null;
  totalQuantity: number;
  totalValuePkr: number;
  lineCount: number;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  postedAt: Date | null;
  createdAt: Date;
};

export type AdjustmentLineDetail = {
  id: string;
  medicineId: string;
  medicineName: string;
  medicineSku: string;
  unit: string;
  batchId: string | null;
  batchNumber: string | null;
  expiryDate: string | null;
  /** Signed: negative reduces available stock. */
  quantity: number;
  stockState: string;
  unitCostPkr: number;
  valuePkr: number;
  notes: string | null;
};

export type AdjustmentDetail = AdjustmentRow & {
  requiresApproval: boolean;
  lines: AdjustmentLineDetail[];
};

export type AdjustmentLineInput = {
  medicineId: string;
  batchId?: string | null;
  /** Always a positive magnitude; the document type decides the direction. */
  quantity: number;
  stockState?: string;
  notes?: string | null;
};

export type CreateAdjustmentInput = {
  branchCode: string;
  warehouseId: string;
  adjustmentType: string;
  reason: string;
  notes?: string;
  lines: AdjustmentLineInput[];
};

export type UpdateAdjustmentInput = {
  branchCode: string;
  warehouseId?: string;
  adjustmentType?: string;
  reason?: string;
  notes?: string;
  lines?: AdjustmentLineInput[];
};

export type AdjustmentFilters = {
  branchCode: string;
  status?: string;
  adjustmentType?: string;
  warehouseId?: string;
  q?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

/** A line after validation and costing, ready to be written to the document. */
type PricedLine = {
  medicineId: string;
  batchId: string | null;
  /** Signed quantity as stored on the line. */
  quantity: number;
  magnitude: number;
  stockState: StockState;
  unitCostPkr: number;
  valuePkr: number;
  notes: string | null;
};

type StoredLine = typeof pharmacyStockAdjustmentLines.$inferSelect;

/**
 * Stock adjustments. Stock is never silently modified: every change is a
 * numbered document with a mandatory reason, an approval trail and a ledger
 * entry per line.
 */
@Injectable()
export class StockAdjustmentService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly engine: PharmacyStockEngine,
    private readonly availability: StockAvailabilityService,
    private readonly settings: InventorySettingsService,
    private readonly numbering: InventoryNumberingService,
  ) {}

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private normalizePage(page?: number, pageSize?: number) {
    const p = Math.max(1, Math.floor(Number(page) || 1));
    const ps = Math.min(100, Math.max(1, Math.floor(Number(pageSize) || 25)));
    return { page: p, pageSize: ps, offset: (p - 1) * ps };
  }

  private pageResult<T>(items: T[], total: number, page: number, pageSize: number): PageResult<T> {
    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  private normalizeType(raw: string | undefined): AdjustmentType {
    const value = (raw ?? "").trim().toLowerCase();
    if (!(ADJUSTMENT_TYPES as readonly string[]).includes(value)) {
      throw new BadRequestException(`adjustmentType must be one of: ${ADJUSTMENT_TYPES.join(", ")}`);
    }
    return value as AdjustmentType;
  }

  private requireReason(raw: string | undefined | null): string {
    const reason = raw?.trim();
    if (!reason) throw new BadRequestException("A reason is required: stock is never adjusted without one");
    return reason;
  }

  private assertStatus(current: string, allowed: AdjustmentStatus[], action: string) {
    if (!(allowed as string[]).includes(current)) {
      throw new ConflictException(
        `Cannot ${action} an adjustment that is '${current}'. Allowed statuses: ${allowed.join(", ")}.`,
      );
    }
  }

  private async writeAudit(
    tx: StockTx,
    input: {
      organizationId: string;
      branchId: string;
      userId?: string | null;
      action: string;
      entityId: string;
      oldValue?: unknown;
      newValue?: unknown;
      reason?: string | null;
    },
  ) {
    await tx.insert(pharmacyAuditLogs).values({
      organizationId: input.organizationId,
      branchId: input.branchId,
      userId: input.userId ?? null,
      action: input.action,
      entityType: "pharmacy_stock_adjustment",
      entityId: input.entityId,
      oldValueJson: input.oldValue === undefined ? null : JSON.stringify(input.oldValue),
      newValueJson: input.newValue === undefined ? null : JSON.stringify(input.newValue),
      reason: input.reason ?? null,
    });
  }

  private async loadHeader(organizationId: string, adjustmentId: string, branchId: string, tx: StockTx = this.db) {
    const [row] = await tx
      .select()
      .from(pharmacyStockAdjustments)
      .where(
        and(
          eq(pharmacyStockAdjustments.id, adjustmentId),
          eq(pharmacyStockAdjustments.organizationId, organizationId),
          eq(pharmacyStockAdjustments.branchId, branchId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException("Stock adjustment not found");
    return row;
  }

  /** Row-locked read. Every posting path goes through this so a retry serialises. */
  private async lockHeader(organizationId: string, adjustmentId: string, branchId: string, tx: StockTx) {
    const [row] = await tx
      .select()
      .from(pharmacyStockAdjustments)
      .where(
        and(
          eq(pharmacyStockAdjustments.id, adjustmentId),
          eq(pharmacyStockAdjustments.organizationId, organizationId),
          eq(pharmacyStockAdjustments.branchId, branchId),
        ),
      )
      .limit(1)
      .for("update");
    if (!row) throw new NotFoundException("Stock adjustment not found");
    return row;
  }

  /**
   * Validates, costs and signs every line.
   *
   * Unit cost falls back batch purchase rate → medicine cost price → medicine
   * purchase price → 0, and is frozen onto the line so the document's value
   * cannot drift when prices change later.
   */
  private async priceLines(
    tx: StockTx,
    organizationId: string,
    branchId: string,
    warehouseId: string,
    adjustmentType: AdjustmentType,
    lines: AdjustmentLineInput[] | undefined,
  ): Promise<PricedLine[]> {
    const raw = lines ?? [];
    if (!raw.length) throw new BadRequestException("At least one adjustment line is required");

    const semantics = TYPE_SEMANTICS[adjustmentType];

    const parsed = raw.map((line, index) => {
      if (!line?.medicineId) throw new BadRequestException(`Line ${index + 1}: medicineId is required`);
      const magnitude = Math.floor(Number(line.quantity));
      if (!Number.isFinite(magnitude) || magnitude <= 0) {
        throw new BadRequestException(`Line ${index + 1}: quantity must be a positive whole number`);
      }
      const batchId = line.batchId ?? null;
      if (semantics.requiresBatch && !batchId) {
        throw new BadRequestException(
          `Line ${index + 1}: a batch must be selected for a '${adjustmentType}' adjustment`,
        );
      }
      if (line.stockState && line.stockState !== semantics.targetState) {
        throw new BadRequestException(
          `Line ${index + 1}: a '${adjustmentType}' adjustment always moves stock to '${semantics.targetState}'`,
        );
      }
      return { medicineId: line.medicineId, batchId, magnitude, notes: line.notes?.trim() || null };
    });

    const medicineIds = Array.from(new Set(parsed.map((l) => l.medicineId)));
    const medicines = await tx
      .select({
        id: pharmacyMedicines.id,
        name: pharmacyMedicines.name,
        sku: pharmacyMedicines.sku,
        costPricePkr: pharmacyMedicines.costPricePkr,
        purchasePricePkr: pharmacyMedicines.purchasePricePkr,
        batchTrackingEnabled: pharmacyMedicines.batchTrackingEnabled,
      })
      .from(pharmacyMedicines)
      .where(
        and(
          eq(pharmacyMedicines.organizationId, organizationId),
          eq(pharmacyMedicines.branchId, branchId),
          inArray(pharmacyMedicines.id, medicineIds),
        ),
      );
    const medicineById = new Map(medicines.map((m) => [m.id, m]));
    const missing = medicineIds.filter((id) => !medicineById.has(id));
    if (missing.length) {
      throw new NotFoundException(`Medicine not found in this branch: ${missing.join(", ")}`);
    }

    const batchIds = Array.from(new Set(parsed.map((l) => l.batchId).filter((id): id is string => Boolean(id))));
    const batches = batchIds.length
      ? await tx
          .select({
            id: pharmacyMedicineBatches.id,
            medicineId: pharmacyMedicineBatches.medicineId,
            warehouseId: pharmacyMedicineBatches.warehouseId,
            purchaseRatePkr: pharmacyMedicineBatches.purchaseRatePkr,
          })
          .from(pharmacyMedicineBatches)
          .where(inArray(pharmacyMedicineBatches.id, batchIds))
      : [];
    const batchById = new Map(batches.map((b) => [b.id, b]));

    return parsed.map((line) => {
      const medicine = medicineById.get(line.medicineId);
      if (!medicine) throw new NotFoundException(`Medicine not found: ${line.medicineId}`);

      let unitCostPkr = 0;
      if (line.batchId) {
        const batch = batchById.get(line.batchId);
        if (!batch) throw new NotFoundException(`Batch not found: ${line.batchId}`);
        if (batch.medicineId !== line.medicineId) {
          throw new BadRequestException("Selected batch does not belong to the selected medicine");
        }
        // Legacy batches with a NULL warehouse belong to the whole branch.
        if (batch.warehouseId && batch.warehouseId !== warehouseId) {
          throw new BadRequestException("Selected batch is not stored in the selected warehouse");
        }
        unitCostPkr = batch.purchaseRatePkr;
      }
      if (!unitCostPkr) unitCostPkr = medicine.costPricePkr || medicine.purchasePricePkr || 0;

      // An increase without a batch can only be honoured for medicines that are
      // not batch tracked; inventing a batch for a tracked medicine would
      // destroy traceability.
      if (adjustmentType === "increase" && !line.batchId && medicine.batchTrackingEnabled) {
        throw new BadRequestException(
          `${medicine.name} (${medicine.sku}) is batch tracked: select the batch the stock is being added to`,
        );
      }

      return {
        medicineId: line.medicineId,
        batchId: line.batchId,
        quantity: semantics.direction * line.magnitude,
        magnitude: line.magnitude,
        stockState: semantics.targetState,
        unitCostPkr,
        valuePkr: line.magnitude * unitCostPkr,
        notes: line.notes,
      };
    });
  }

  private totalsFor(lines: PricedLine[]) {
    return {
      totalQuantity: lines.reduce((sum, l) => sum + l.quantity, 0),
      /** Absolute value of the movement — what the approval threshold compares against. */
      totalValuePkr: lines.reduce((sum, l) => sum + l.valuePkr, 0),
    };
  }

  private async replaceLines(tx: StockTx, adjustmentId: string, lines: PricedLine[]) {
    await tx
      .delete(pharmacyStockAdjustmentLines)
      .where(eq(pharmacyStockAdjustmentLines.adjustmentId, adjustmentId));
    return tx
      .insert(pharmacyStockAdjustmentLines)
      .values(
        lines.map((line) => ({
          adjustmentId,
          medicineId: line.medicineId,
          batchId: line.batchId,
          quantity: line.quantity,
          stockState: line.stockState,
          unitCostPkr: line.unitCostPkr,
          valuePkr: line.valuePkr,
          notes: line.notes,
        })),
      )
      .returning();
  }

  /**
   * Whether this document needs a human approval before it can touch stock.
   *
   * Approval is skipped when the branch policy does not require it, or when a
   * positive threshold is configured and the document's absolute value stays at
   * or below it. Anything else must be approved by a second person.
   */
  private async needsApproval(organizationId: string, branchId: string, totalValuePkr: number) {
    const settings = await this.settings.getSettings(organizationId, branchId);
    if (!settings.requireAdjustmentApproval) return false;
    const threshold = settings.adjustmentApprovalThreshold;
    if (threshold > 0 && Math.abs(totalValuePkr) <= threshold) return false;
    return true;
  }

  // ─── Posting ───────────────────────────────────────────────────────────────

  /**
   * Applies every line to stock. This is the only place adjustment semantics
   * live, so the draft → approve path and the stock-count path behave alike.
   */
  private async applyLines(
    tx: StockTx,
    context: {
      organizationId: string;
      branchId: string;
      warehouseId: string;
      adjustmentId: string;
      adjustmentType: AdjustmentType;
      userId?: string;
    },
    lines: StoredLine[],
  ) {
    if (!lines.length) throw new BadRequestException("Cannot post an adjustment with no lines");

    const medicineIds = Array.from(new Set(lines.map((l) => l.medicineId)));
    const medicines = await tx
      .select({
        id: pharmacyMedicines.id,
        name: pharmacyMedicines.name,
        batchTrackingEnabled: pharmacyMedicines.batchTrackingEnabled,
      })
      .from(pharmacyMedicines)
      .where(inArray(pharmacyMedicines.id, medicineIds));
    const medicineById = new Map(medicines.map((m) => [m.id, m]));

    const base = {
      organizationId: context.organizationId,
      branchId: context.branchId,
      referenceType: "stock_adjustment",
      referenceId: context.adjustmentId,
      createdByUserId: context.userId,
    };

    for (const line of lines) {
      const qty = Math.abs(line.quantity);
      if (qty <= 0) continue;
      const idempotencyKey = `adjustment:${context.adjustmentId}:${line.id}`;
      const semantics = TYPE_SEMANTICS[context.adjustmentType];
      if (semantics.requiresBatch && !line.batchId) {
        throw new BadRequestException(
          `A batch is required for a '${context.adjustmentType}' adjustment line`,
        );
      }

      switch (context.adjustmentType) {
        case "increase": {
          const medicine = medicineById.get(line.medicineId);
          if (!line.batchId && medicine?.batchTrackingEnabled) {
            throw new BadRequestException(
              `${medicine.name} is batch tracked: select the batch the stock is being added to`,
            );
          }
          await this.engine.restoreBatch(tx, {
            ...base,
            medicineId: line.medicineId,
            batchId: line.batchId,
            qty,
            warehouseId: context.warehouseId,
            movementType: MOVEMENT_TYPES.ADJUSTMENT_IN,
            unitCostPkr: line.unitCostPkr,
            idempotencyKey,
          });
          break;
        }
        case "decrease":
        case "write_off": {
          // `deductFefo` stamps the key it is given on every allocation row and
          // the ledger is unique on (organization_id, idempotency_key), so the
          // key is only safe when the line resolves to a single batch. The
          // FOR UPDATE status guard is what prevents a double post otherwise.
          const singleBatch = line.batchId ? await this.batchCovers(tx, line.batchId, qty) : false;
          await this.engine.deductFefo(tx, {
            ...base,
            medicineId: line.medicineId,
            qty,
            warehouseId: context.warehouseId,
            preferredBatchId: line.batchId ?? undefined,
            movementType: MOVEMENT_TYPES.ADJUSTMENT_OUT,
            idempotencyKey: singleBatch ? idempotencyKey : null,
          });
          break;
        }
        case "damage": {
          await this.engine.moveBetweenStates(tx, {
            ...base,
            medicineId: line.medicineId,
            batchId: line.batchId as string,
            from: "available",
            to: "damaged",
            qty,
            warehouseId: context.warehouseId,
            movementType: MOVEMENT_TYPES.DAMAGE,
            unitCostPkr: line.unitCostPkr,
          });
          break;
        }
        case "expiry": {
          // Expired stock is never destroyed automatically. This is the explicit
          // authorised action that moves it into the blocked bucket, where it
          // stays visible and valued until it is physically written off.
          await this.engine.moveBetweenStates(tx, {
            ...base,
            medicineId: line.medicineId,
            batchId: line.batchId as string,
            from: "available",
            to: "blocked",
            qty,
            warehouseId: context.warehouseId,
            movementType: MOVEMENT_TYPES.EXPIRY,
            unitCostPkr: line.unitCostPkr,
          });
          break;
        }
        case "quarantine": {
          await this.engine.moveBetweenStates(tx, {
            ...base,
            medicineId: line.medicineId,
            batchId: line.batchId as string,
            from: "available",
            to: "quarantine",
            qty,
            warehouseId: context.warehouseId,
            movementType: MOVEMENT_TYPES.ADJUSTMENT_OUT,
            unitCostPkr: line.unitCostPkr,
          });
          break;
        }
        case "release": {
          await this.engine.moveBetweenStates(tx, {
            ...base,
            medicineId: line.medicineId,
            batchId: line.batchId as string,
            from: "quarantine",
            to: "available",
            qty,
            warehouseId: context.warehouseId,
            movementType: MOVEMENT_TYPES.ADJUSTMENT_IN,
            unitCostPkr: line.unitCostPkr,
          });
          break;
        }
      }
    }
  }

  private async batchCovers(tx: StockTx, batchId: string, quantity: number) {
    const [batch] = await tx
      .select({ quantity: pharmacyMedicineBatches.quantity })
      .from(pharmacyMedicineBatches)
      .where(eq(pharmacyMedicineBatches.id, batchId))
      .limit(1);
    return Boolean(batch && batch.quantity >= quantity);
  }

  /** Posts a locked, non-posted header and stamps the totals onto it. */
  private async postDocument(
    tx: StockTx,
    header: typeof pharmacyStockAdjustments.$inferSelect,
    userId?: string,
  ) {
    const lines = await tx
      .select()
      .from(pharmacyStockAdjustmentLines)
      .where(eq(pharmacyStockAdjustmentLines.adjustmentId, header.id));

    await this.applyLines(
      tx,
      {
        organizationId: header.organizationId,
        branchId: header.branchId,
        warehouseId: header.warehouseId,
        adjustmentId: header.id,
        adjustmentType: this.normalizeType(header.adjustmentType),
        userId,
      },
      lines,
    );

    const totalQuantity = lines.reduce((sum, l) => sum + l.quantity, 0);
    const totalValuePkr = lines.reduce((sum, l) => sum + Math.abs(l.valuePkr), 0);

    await tx
      .update(pharmacyStockAdjustments)
      .set({ status: "posted", postedAt: new Date(), totalQuantity, totalValuePkr })
      .where(eq(pharmacyStockAdjustments.id, header.id));

    return { totalQuantity, totalValuePkr, lineCount: lines.length };
  }

  /**
   * Creates an already-approved adjustment and posts it inside the caller's
   * transaction. StockCountService uses this so a count, the adjustment it
   * generates and the resulting stock movements all commit or roll back
   * together.
   *
   * The numbering retry loop cannot be used here: a unique violation would
   * abort the caller's transaction, so the number is taken once and the caller
   * retries the whole operation if it loses the race.
   */
  async createPostedAdjustmentWithin(
    tx: StockTx,
    input: {
      organizationId: string;
      branchId: string;
      warehouseId: string;
      adjustmentType: AdjustmentType;
      reason: string;
      notes?: string | null;
      lines: AdjustmentLineInput[];
    },
    userId?: string,
  ): Promise<{ id: string; adjustmentNumber: string; totalQuantity: number; totalValuePkr: number }> {
    const adjustmentType = this.normalizeType(input.adjustmentType);
    const reason = this.requireReason(input.reason);
    const priced = await this.priceLines(
      tx,
      input.organizationId,
      input.branchId,
      input.warehouseId,
      adjustmentType,
      input.lines,
    );
    const totals = this.totalsFor(priced);
    const adjustmentNumber = await this.numbering.next(input.organizationId, "adjustment", 0, tx);
    const now = new Date();

    const [created] = await tx
      .insert(pharmacyStockAdjustments)
      .values({
        organizationId: input.organizationId,
        branchId: input.branchId,
        warehouseId: input.warehouseId,
        adjustmentNumber,
        adjustmentType,
        status: "posted",
        reason,
        notes: input.notes?.trim() || null,
        totalQuantity: totals.totalQuantity,
        totalValuePkr: totals.totalValuePkr,
        createdByUserId: userId ?? null,
        approvedByUserId: userId ?? null,
        approvedAt: now,
        postedAt: now,
      })
      .returning();
    if (!created) throw new BadRequestException("Failed to create stock adjustment");

    const storedLines = await this.replaceLines(tx, created.id, priced);
    await this.applyLines(
      tx,
      {
        organizationId: input.organizationId,
        branchId: input.branchId,
        warehouseId: input.warehouseId,
        adjustmentId: created.id,
        adjustmentType,
        userId,
      },
      storedLines,
    );

    await this.writeAudit(tx, {
      organizationId: input.organizationId,
      branchId: input.branchId,
      userId,
      action: "stock_adjustment.post",
      entityId: created.id,
      newValue: {
        adjustmentNumber,
        adjustmentType,
        status: "posted",
        ...totals,
        lineCount: priced.length,
      },
      reason,
    });

    return { id: created.id, adjustmentNumber, ...totals };
  }

  // ─── Reads ─────────────────────────────────────────────────────────────────

  async listAdjustments(
    organizationId: string,
    filters: AdjustmentFilters,
  ): Promise<PageResult<AdjustmentRow>> {
    const branch = await this.availability.resolveBranch(organizationId, filters.branchCode);
    const { page, pageSize, offset } = this.normalizePage(filters.page, filters.pageSize);

    const clauses: SQL[] = [
      eq(pharmacyStockAdjustments.organizationId, organizationId),
      eq(pharmacyStockAdjustments.branchId, branch.id),
    ];
    if (filters.status) {
      const status = filters.status.trim().toLowerCase();
      if (!(ADJUSTMENT_STATUSES as string[]).includes(status)) {
        throw new BadRequestException(`status must be one of: ${ADJUSTMENT_STATUSES.join(", ")}`);
      }
      clauses.push(eq(pharmacyStockAdjustments.status, status));
    }
    if (filters.adjustmentType) {
      clauses.push(eq(pharmacyStockAdjustments.adjustmentType, this.normalizeType(filters.adjustmentType)));
    }
    if (filters.warehouseId) {
      const warehouse = await this.availability.resolveWarehouse(organizationId, branch.id, filters.warehouseId);
      if (warehouse) clauses.push(eq(pharmacyStockAdjustments.warehouseId, warehouse.id));
    }
    if (filters.from) clauses.push(gte(pharmacyStockAdjustments.createdAt, new Date(`${filters.from}T00:00:00.000Z`)));
    if (filters.to) clauses.push(lte(pharmacyStockAdjustments.createdAt, new Date(`${filters.to}T23:59:59.999Z`)));
    if (filters.q?.trim()) {
      const term = `%${filters.q.trim()}%`;
      const search = or(
        ilike(pharmacyStockAdjustments.adjustmentNumber, term),
        ilike(pharmacyStockAdjustments.reason, term),
        ilike(pharmacyStockAdjustments.notes, term),
      );
      if (search) clauses.push(search);
    }
    const where = and(...clauses);

    const [totalRow] = await this.db.select({ n: count() }).from(pharmacyStockAdjustments).where(where);
    const total = Number(totalRow?.n ?? 0);

    const headers = await this.db
      .select({
        id: pharmacyStockAdjustments.id,
        adjustmentNumber: pharmacyStockAdjustments.adjustmentNumber,
        status: pharmacyStockAdjustments.status,
        adjustmentType: pharmacyStockAdjustments.adjustmentType,
        branchId: pharmacyStockAdjustments.branchId,
        warehouseId: pharmacyStockAdjustments.warehouseId,
        warehouseCode: pharmacyWarehouses.code,
        warehouseName: pharmacyWarehouses.name,
        reason: pharmacyStockAdjustments.reason,
        notes: pharmacyStockAdjustments.notes,
        rejectReason: pharmacyStockAdjustments.rejectReason,
        totalQuantity: pharmacyStockAdjustments.totalQuantity,
        totalValuePkr: pharmacyStockAdjustments.totalValuePkr,
        approvedAt: pharmacyStockAdjustments.approvedAt,
        rejectedAt: pharmacyStockAdjustments.rejectedAt,
        postedAt: pharmacyStockAdjustments.postedAt,
        createdAt: pharmacyStockAdjustments.createdAt,
      })
      .from(pharmacyStockAdjustments)
      .leftJoin(pharmacyWarehouses, eq(pharmacyWarehouses.id, pharmacyStockAdjustments.warehouseId))
      .where(where)
      .orderBy(desc(pharmacyStockAdjustments.createdAt))
      .limit(pageSize)
      .offset(offset);

    const lineCounts = await this.lineCounts(headers.map((h) => h.id));
    const items: AdjustmentRow[] = headers.map((h) => ({ ...h, lineCount: lineCounts.get(h.id) ?? 0 }));
    return this.pageResult(items, total, page, pageSize);
  }

  private async lineCounts(adjustmentIds: string[]) {
    const map = new Map<string, number>();
    if (!adjustmentIds.length) return map;
    const rows = await this.db
      .select({ adjustmentId: pharmacyStockAdjustmentLines.adjustmentId, n: count() })
      .from(pharmacyStockAdjustmentLines)
      .where(inArray(pharmacyStockAdjustmentLines.adjustmentId, adjustmentIds))
      .groupBy(pharmacyStockAdjustmentLines.adjustmentId);
    for (const row of rows) map.set(row.adjustmentId, Number(row.n ?? 0));
    return map;
  }

  async getAdjustment(
    organizationId: string,
    adjustmentId: string,
    branchCode: string,
  ): Promise<AdjustmentDetail> {
    const branch = await this.availability.resolveBranch(organizationId, branchCode);
    return this.buildDetail(organizationId, adjustmentId, branch.id);
  }

  private async buildDetail(
    organizationId: string,
    adjustmentId: string,
    branchId: string,
  ): Promise<AdjustmentDetail> {
    const header = await this.loadHeader(organizationId, adjustmentId, branchId);

    const [warehouse] = await this.db
      .select({ code: pharmacyWarehouses.code, name: pharmacyWarehouses.name })
      .from(pharmacyWarehouses)
      .where(eq(pharmacyWarehouses.id, header.warehouseId))
      .limit(1);

    const lineRows = await this.db
      .select({
        id: pharmacyStockAdjustmentLines.id,
        medicineId: pharmacyStockAdjustmentLines.medicineId,
        medicineName: pharmacyMedicines.name,
        medicineSku: pharmacyMedicines.sku,
        unit: pharmacyMedicines.unit,
        batchId: pharmacyStockAdjustmentLines.batchId,
        batchNumber: pharmacyMedicineBatches.batchNumber,
        expiryDate: pharmacyMedicineBatches.expiryDate,
        quantity: pharmacyStockAdjustmentLines.quantity,
        stockState: pharmacyStockAdjustmentLines.stockState,
        unitCostPkr: pharmacyStockAdjustmentLines.unitCostPkr,
        valuePkr: pharmacyStockAdjustmentLines.valuePkr,
        notes: pharmacyStockAdjustmentLines.notes,
      })
      .from(pharmacyStockAdjustmentLines)
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyStockAdjustmentLines.medicineId))
      .leftJoin(pharmacyMedicineBatches, eq(pharmacyMedicineBatches.id, pharmacyStockAdjustmentLines.batchId))
      .where(eq(pharmacyStockAdjustmentLines.adjustmentId, adjustmentId))
      .orderBy(asc(pharmacyMedicines.name));

    const totalValuePkr = lineRows.reduce((sum, l) => sum + Math.abs(l.valuePkr), 0);
    const requiresApproval =
      header.status === "posted" || header.status === "rejected"
        ? false
        : await this.needsApproval(organizationId, branchId, totalValuePkr);

    return {
      id: header.id,
      adjustmentNumber: header.adjustmentNumber,
      status: header.status,
      adjustmentType: header.adjustmentType,
      branchId: header.branchId,
      warehouseId: header.warehouseId,
      warehouseCode: warehouse?.code ?? null,
      warehouseName: warehouse?.name ?? null,
      reason: header.reason,
      notes: header.notes,
      rejectReason: header.rejectReason,
      totalQuantity: header.totalQuantity,
      totalValuePkr: header.totalValuePkr,
      lineCount: lineRows.length,
      approvedAt: header.approvedAt,
      rejectedAt: header.rejectedAt,
      postedAt: header.postedAt,
      createdAt: header.createdAt,
      requiresApproval,
      lines: lineRows,
    };
  }

  // ─── Writes ────────────────────────────────────────────────────────────────

  async createAdjustment(
    organizationId: string,
    input: CreateAdjustmentInput,
    userId?: string,
  ): Promise<AdjustmentDetail> {
    const branch = await this.availability.resolveBranch(organizationId, input.branchCode);
    if (!input.warehouseId) throw new BadRequestException("warehouseId is required");
    const warehouse = await this.availability.resolveWarehouse(organizationId, branch.id, input.warehouseId);
    if (!warehouse) throw new NotFoundException("Warehouse not found for this branch");

    const adjustmentType = this.normalizeType(input.adjustmentType);
    const reason = this.requireReason(input.reason);
    const priced = await this.priceLines(
      this.db,
      organizationId,
      branch.id,
      warehouse.id,
      adjustmentType,
      input.lines,
    );
    const totals = this.totalsFor(priced);

    const adjustmentId = await this.numbering.withNumber(organizationId, "adjustment", async (adjustmentNumber) =>
      this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(pharmacyStockAdjustments)
          .values({
            organizationId,
            branchId: branch.id,
            warehouseId: warehouse.id,
            adjustmentNumber,
            adjustmentType,
            status: "draft",
            reason,
            notes: input.notes?.trim() || null,
            totalQuantity: totals.totalQuantity,
            totalValuePkr: totals.totalValuePkr,
            createdByUserId: userId ?? null,
          })
          .returning();
        if (!created) throw new BadRequestException("Failed to create stock adjustment");

        await this.replaceLines(tx, created.id, priced);
        await this.writeAudit(tx, {
          organizationId,
          branchId: branch.id,
          userId,
          action: "stock_adjustment.create",
          entityId: created.id,
          newValue: { adjustmentNumber, adjustmentType, status: "draft", ...totals, lineCount: priced.length },
          reason,
        });
        return created.id;
      }),
    );

    return this.buildDetail(organizationId, adjustmentId, branch.id);
  }

  async updateAdjustment(
    organizationId: string,
    adjustmentId: string,
    input: UpdateAdjustmentInput,
    userId?: string,
  ): Promise<AdjustmentDetail> {
    const branch = await this.availability.resolveBranch(organizationId, input.branchCode);
    const existing = await this.loadHeader(organizationId, adjustmentId, branch.id);
    this.assertStatus(existing.status, ["draft"], "edit");

    const warehouseId = input.warehouseId ?? existing.warehouseId;
    const warehouse = await this.availability.resolveWarehouse(organizationId, branch.id, warehouseId);
    if (!warehouse) throw new NotFoundException("Warehouse not found for this branch");

    const adjustmentType = input.adjustmentType
      ? this.normalizeType(input.adjustmentType)
      : this.normalizeType(existing.adjustmentType);
    const reason = input.reason !== undefined ? this.requireReason(input.reason) : existing.reason;

    // Changing the type re-signs every line, so the lines are always re-priced
    // when either the type or the lines change.
    const shouldRepriceLines = input.lines !== undefined || adjustmentType !== existing.adjustmentType;
    let priced: PricedLine[] | null = null;
    if (shouldRepriceLines) {
      const source =
        input.lines ??
        (
          await this.db
            .select()
            .from(pharmacyStockAdjustmentLines)
            .where(eq(pharmacyStockAdjustmentLines.adjustmentId, adjustmentId))
        ).map((line) => ({
          medicineId: line.medicineId,
          batchId: line.batchId,
          quantity: Math.abs(line.quantity),
          notes: line.notes,
        }));
      priced = await this.priceLines(
        this.db,
        organizationId,
        branch.id,
        warehouse.id,
        adjustmentType,
        source,
      );
    }

    await this.db.transaction(async (tx) => {
      const locked = await this.lockHeader(organizationId, adjustmentId, branch.id, tx);
      this.assertStatus(locked.status, ["draft"], "edit");

      const totals = priced
        ? this.totalsFor(priced)
        : { totalQuantity: locked.totalQuantity, totalValuePkr: locked.totalValuePkr };

      await tx
        .update(pharmacyStockAdjustments)
        .set({
          warehouseId: warehouse.id,
          adjustmentType,
          reason,
          notes: input.notes !== undefined ? input.notes?.trim() || null : locked.notes,
          totalQuantity: totals.totalQuantity,
          totalValuePkr: totals.totalValuePkr,
        })
        .where(eq(pharmacyStockAdjustments.id, adjustmentId));

      if (priced) await this.replaceLines(tx, adjustmentId, priced);

      await this.writeAudit(tx, {
        organizationId,
        branchId: branch.id,
        userId,
        action: "stock_adjustment.update",
        entityId: adjustmentId,
        oldValue: {
          adjustmentType: locked.adjustmentType,
          warehouseId: locked.warehouseId,
          reason: locked.reason,
          totalQuantity: locked.totalQuantity,
          totalValuePkr: locked.totalValuePkr,
        },
        newValue: { adjustmentType, warehouseId: warehouse.id, reason, ...totals },
      });
    });

    return this.buildDetail(organizationId, adjustmentId, branch.id);
  }

  /**
   * Submits the document. Low-value adjustments (or branches that do not
   * require approval) post straight away; everything else waits for approval.
   */
  async submitAdjustment(
    organizationId: string,
    adjustmentId: string,
    branchCode: string,
    userId?: string,
  ): Promise<AdjustmentDetail> {
    const branch = await this.availability.resolveBranch(organizationId, branchCode);

    await this.db.transaction(async (tx) => {
      const header = await this.lockHeader(organizationId, adjustmentId, branch.id, tx);
      this.assertStatus(header.status, ["draft"], "submit");

      const lines = await tx
        .select()
        .from(pharmacyStockAdjustmentLines)
        .where(eq(pharmacyStockAdjustmentLines.adjustmentId, adjustmentId));
      if (!lines.length) throw new BadRequestException("Cannot submit an adjustment with no lines");

      const totalValuePkr = lines.reduce((sum, l) => sum + Math.abs(l.valuePkr), 0);
      const requiresApproval = await this.needsApproval(organizationId, branch.id, totalValuePkr);

      if (requiresApproval) {
        await tx
          .update(pharmacyStockAdjustments)
          .set({ status: "pending_approval" })
          .where(eq(pharmacyStockAdjustments.id, adjustmentId));
        await this.writeAudit(tx, {
          organizationId,
          branchId: branch.id,
          userId,
          action: "stock_adjustment.submit",
          entityId: adjustmentId,
          oldValue: { status: header.status },
          newValue: { status: "pending_approval", totalValuePkr },
          reason: header.reason,
        });
        return;
      }

      const posted = await this.postDocument(tx, header, userId);
      await this.writeAudit(tx, {
        organizationId,
        branchId: branch.id,
        userId,
        action: "stock_adjustment.post",
        entityId: adjustmentId,
        oldValue: { status: header.status },
        newValue: { status: "posted", ...posted, approvalSkipped: true },
        reason: header.reason,
      });
    });

    return this.buildDetail(organizationId, adjustmentId, branch.id);
  }

  /** Approves and posts in one step: an approved adjustment always hits stock. */
  async approveAdjustment(
    organizationId: string,
    adjustmentId: string,
    branchCode: string,
    userId?: string,
  ): Promise<AdjustmentDetail> {
    const branch = await this.availability.resolveBranch(organizationId, branchCode);

    await this.db.transaction(async (tx) => {
      const header = await this.lockHeader(organizationId, adjustmentId, branch.id, tx);
      // Replay guard: an already-posted document conflicts instead of posting twice.
      this.assertStatus(header.status, ["pending_approval", "approved"], "approve");

      await tx
        .update(pharmacyStockAdjustments)
        .set({ status: "approved", approvedAt: new Date(), approvedByUserId: userId ?? null })
        .where(eq(pharmacyStockAdjustments.id, adjustmentId));

      const posted = await this.postDocument(tx, header, userId);
      await this.writeAudit(tx, {
        organizationId,
        branchId: branch.id,
        userId,
        action: "stock_adjustment.approve",
        entityId: adjustmentId,
        oldValue: { status: header.status },
        newValue: { status: "posted", ...posted },
        reason: header.reason,
      });
    });

    return this.buildDetail(organizationId, adjustmentId, branch.id);
  }

  async rejectAdjustment(
    organizationId: string,
    adjustmentId: string,
    input: { branchCode: string; reason: string },
    userId?: string,
  ): Promise<AdjustmentDetail> {
    const branch = await this.availability.resolveBranch(organizationId, input.branchCode);
    const reason = this.requireReason(input.reason);

    await this.db.transaction(async (tx) => {
      const header = await this.lockHeader(organizationId, adjustmentId, branch.id, tx);
      this.assertStatus(header.status, ["draft", "pending_approval"], "reject");

      await tx
        .update(pharmacyStockAdjustments)
        .set({
          status: "rejected",
          rejectedAt: new Date(),
          rejectedByUserId: userId ?? null,
          rejectReason: reason,
        })
        .where(eq(pharmacyStockAdjustments.id, adjustmentId));

      await this.writeAudit(tx, {
        organizationId,
        branchId: branch.id,
        userId,
        action: "stock_adjustment.reject",
        entityId: adjustmentId,
        oldValue: { status: header.status },
        newValue: { status: "rejected" },
        reason,
      });
    });

    return this.buildDetail(organizationId, adjustmentId, branch.id);
  }
}
