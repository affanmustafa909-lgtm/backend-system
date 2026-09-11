import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  pharmacyAuditLogs,
  pharmacyMedicineBatches,
  pharmacyMedicines,
  pharmacyStockTransferLines,
  pharmacyStockTransfers,
  pharmacyWarehouses,
  popsBranches,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { PharmacyStockEngine, type StockTx } from "../pharmacy-stock.engine";
import { InventoryNumberingService } from "./inventory-numbering.service";
import { MOVEMENT_TYPES } from "./stock-ledger.service";
import { StockAvailabilityService } from "./stock-availability.service";

export type PageResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type TransferStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "dispatched"
  | "received"
  | "completed"
  | "cancelled";

const TRANSFER_STATUSES: TransferStatus[] = [
  "draft",
  "submitted",
  "approved",
  "dispatched",
  "received",
  "completed",
  "cancelled",
];

export type TransferRow = {
  id: string;
  transferNumber: string;
  status: string;
  transferDate: string | null;
  branchId: string;
  fromWarehouseId: string;
  fromWarehouseCode: string | null;
  fromWarehouseName: string | null;
  toWarehouseId: string;
  toWarehouseCode: string | null;
  toWarehouseName: string | null;
  toBranchId: string | null;
  reason: string | null;
  notes: string | null;
  cancelReason: string | null;
  lineCount: number;
  totalQuantity: number;
  totalReceivedQuantity: number;
  totalShortage: number;
  totalValuePkr: number;
  submittedAt: Date | null;
  approvedAt: Date | null;
  dispatchedAt: Date | null;
  receivedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
};

export type TransferLineDetail = {
  id: string;
  medicineId: string;
  medicineName: string;
  medicineSku: string;
  unit: string;
  batchId: string | null;
  batchNumber: string | null;
  expiryDate: string | null;
  quantity: number;
  receivedQuantity: number;
  /** quantity - receivedQuantity. A shortage is always reported, never written off. */
  shortage: number;
  unitCostPkr: number;
  valuePkr: number;
  destinationBatchId: string | null;
  destinationBatchNumber: string | null;
  notes: string | null;
};

export type TransferDetail = TransferRow & {
  fromBranch: { id: string; code: string; name: string };
  toBranch: { id: string; code: string; name: string };
  lines: TransferLineDetail[];
};

export type TransferLineInput = {
  medicineId: string;
  batchId?: string;
  quantity: number;
  notes?: string;
};

export type CreateTransferInput = {
  branchCode: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  toBranchId?: string;
  transferDate?: string;
  reason?: string;
  notes?: string;
  lines: TransferLineInput[];
};

export type UpdateTransferInput = {
  branchCode: string;
  fromWarehouseId?: string;
  toWarehouseId?: string;
  toBranchId?: string;
  transferDate?: string;
  reason?: string;
  notes?: string;
  lines?: TransferLineInput[];
};

export type TransferFilters = {
  branchCode: string;
  status?: string;
  fromWarehouseId?: string;
  toWarehouseId?: string;
  q?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

type NormalizedLine = {
  medicineId: string;
  batchId: string | null;
  quantity: number;
  notes: string | null;
};

const fromWarehouse = alias(pharmacyWarehouses, "from_warehouse");
const toWarehouse = alias(pharmacyWarehouses, "to_warehouse");
const destinationBatch = alias(pharmacyMedicineBatches, "destination_batch");

/**
 * Stock transfers between warehouses (and optionally between branches).
 *
 * State machine, enforced on every call:
 *   draft → submitted → approved → dispatched → received → completed
 * `cancelled` is reachable from draft, submitted and approved only: once stock
 * has physically left the source warehouse the document must be received (with
 * a shortage if necessary), never cancelled.
 */
@Injectable()
export class StockTransferService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly engine: PharmacyStockEngine,
    private readonly availability: StockAvailabilityService,
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
      entityType: "pharmacy_stock_transfer",
      entityId: input.entityId,
      oldValueJson: input.oldValue === undefined ? null : JSON.stringify(input.oldValue),
      newValueJson: input.newValue === undefined ? null : JSON.stringify(input.newValue),
      reason: input.reason ?? null,
    });
  }

  private assertStatus(current: string, allowed: TransferStatus[], action: string) {
    if (!(allowed as string[]).includes(current)) {
      throw new ConflictException(
        `Cannot ${action} a transfer that is '${current}'. Allowed statuses: ${allowed.join(", ")}.`,
      );
    }
  }

  private async resolveBranchById(organizationId: string, branchId: string) {
    const [branch] = await this.db
      .select({ id: popsBranches.id, code: popsBranches.code, name: popsBranches.name })
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.id, branchId)))
      .limit(1);
    if (!branch) throw new NotFoundException("Destination branch not found");
    return branch;
  }

  /** Loads the header, scoped to the caller's organisation and branch. */
  private async loadHeader(organizationId: string, transferId: string, branchId: string, tx: StockTx = this.db) {
    const [row] = await tx
      .select()
      .from(pharmacyStockTransfers)
      .where(
        and(
          eq(pharmacyStockTransfers.id, transferId),
          eq(pharmacyStockTransfers.organizationId, organizationId),
          eq(pharmacyStockTransfers.branchId, branchId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException("Stock transfer not found");
    return row;
  }

  /**
   * Same as `loadHeader` but takes a row lock. Every stock-mutating transition
   * reads through this so two concurrent dispatches serialise and the loser
   * sees the already-advanced status instead of deducting a second time.
   */
  private async lockHeader(organizationId: string, transferId: string, branchId: string, tx: StockTx) {
    const [row] = await tx
      .select()
      .from(pharmacyStockTransfers)
      .where(
        and(
          eq(pharmacyStockTransfers.id, transferId),
          eq(pharmacyStockTransfers.organizationId, organizationId),
          eq(pharmacyStockTransfers.branchId, branchId),
        ),
      )
      .limit(1)
      .for("update");
    if (!row) throw new NotFoundException("Stock transfer not found");
    return row;
  }

  private async normalizeLines(
    organizationId: string,
    branchId: string,
    warehouseId: string,
    lines: TransferLineInput[] | undefined,
  ): Promise<NormalizedLine[]> {
    const raw = lines ?? [];
    if (!raw.length) throw new BadRequestException("At least one transfer line is required");

    const normalized: NormalizedLine[] = raw.map((line, index) => {
      if (!line?.medicineId) throw new BadRequestException(`Line ${index + 1}: medicineId is required`);
      const quantity = Math.floor(Number(line.quantity));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException(`Line ${index + 1}: quantity must be a positive whole number`);
      }
      return {
        medicineId: line.medicineId,
        batchId: line.batchId ?? null,
        quantity,
        notes: line.notes?.trim() || null,
      };
    });

    const medicineIds = Array.from(new Set(normalized.map((l) => l.medicineId)));
    const medicines = await this.db
      .select({ id: pharmacyMedicines.id })
      .from(pharmacyMedicines)
      .where(
        and(
          eq(pharmacyMedicines.organizationId, organizationId),
          eq(pharmacyMedicines.branchId, branchId),
          inArray(pharmacyMedicines.id, medicineIds),
        ),
      );
    const known = new Set(medicines.map((m) => m.id));
    const missing = medicineIds.filter((id) => !known.has(id));
    if (missing.length) {
      throw new NotFoundException(`Medicine not found in this branch: ${missing.join(", ")}`);
    }

    const batchIds = Array.from(
      new Set(normalized.map((l) => l.batchId).filter((id): id is string => Boolean(id))),
    );
    if (batchIds.length) {
      const batches = await this.db
        .select({
          id: pharmacyMedicineBatches.id,
          medicineId: pharmacyMedicineBatches.medicineId,
          warehouseId: pharmacyMedicineBatches.warehouseId,
        })
        .from(pharmacyMedicineBatches)
        .where(inArray(pharmacyMedicineBatches.id, batchIds));
      const byId = new Map(batches.map((b) => [b.id, b]));
      for (const line of normalized) {
        if (!line.batchId) continue;
        const batch = byId.get(line.batchId);
        if (!batch) throw new NotFoundException(`Batch not found: ${line.batchId}`);
        if (batch.medicineId !== line.medicineId) {
          throw new BadRequestException("Selected batch does not belong to the selected medicine");
        }
        // Legacy batches carry a NULL warehouse and stay visible to every
        // warehouse in the branch; anything else must match the source.
        if (batch.warehouseId && batch.warehouseId !== warehouseId) {
          throw new BadRequestException("Selected batch is not stored in the source warehouse");
        }
      }
    }

    return normalized;
  }

  /**
   * Availability gate used on create, submit and dispatch. Requirements are
   * aggregated per medicine so two lines of the same medicine cannot each pass
   * a check that they jointly fail.
   */
  private async assertAvailability(
    organizationId: string,
    branchId: string,
    warehouseId: string,
    lines: { medicineId: string; quantity: number }[],
    action: string,
  ) {
    const required = new Map<string, number>();
    for (const line of lines) {
      required.set(line.medicineId, (required.get(line.medicineId) ?? 0) + line.quantity);
    }
    const stock = await this.availability.getAvailability({
      organizationId,
      branchId,
      medicineIds: Array.from(required.keys()),
      warehouseId,
    });
    const byId = new Map(stock.map((s) => [s.medicineId, s]));

    const problems: string[] = [];
    for (const [medicineId, quantity] of required) {
      const info = byId.get(medicineId);
      if (!info) {
        problems.push(`Medicine ${medicineId} is not available in this branch`);
        continue;
      }
      if (info.availableQty < quantity) {
        problems.push(
          `${info.name} (${info.sku}): requested ${quantity} ${info.unit}, available ${info.availableQty}`,
        );
      }
    }
    if (problems.length) {
      throw new BadRequestException(`Cannot ${action}: insufficient available stock. ${problems.join("; ")}`);
    }
  }

  /**
   * Medicines are branch-scoped, so an inter-branch transfer has to land on the
   * destination branch's own medicine record. It is matched by SKU; if the
   * destination branch does not stock the item the transfer is refused rather
   * than silently creating stock against the source branch's medicine.
   */
  private async resolveDestinationMedicine(
    tx: StockTx,
    organizationId: string,
    sourceBranchId: string,
    destinationBranchId: string,
    medicineId: string,
  ): Promise<string> {
    if (sourceBranchId === destinationBranchId) return medicineId;

    const [source] = await tx
      .select({ sku: pharmacyMedicines.sku, name: pharmacyMedicines.name })
      .from(pharmacyMedicines)
      .where(eq(pharmacyMedicines.id, medicineId))
      .limit(1);
    if (!source) throw new NotFoundException("Medicine not found");

    const [target] = await tx
      .select({ id: pharmacyMedicines.id })
      .from(pharmacyMedicines)
      .where(
        and(
          eq(pharmacyMedicines.organizationId, organizationId),
          eq(pharmacyMedicines.branchId, destinationBranchId),
          eq(pharmacyMedicines.sku, source.sku),
        ),
      )
      .limit(1);
    if (!target) {
      throw new BadRequestException(
        `${source.name} (${source.sku}) does not exist in the destination branch. Create it there before receiving this transfer.`,
      );
    }
    return target.id;
  }

  private async replaceLines(tx: StockTx, transferId: string, lines: NormalizedLine[]) {
    await tx.delete(pharmacyStockTransferLines).where(eq(pharmacyStockTransferLines.transferId, transferId));
    await tx.insert(pharmacyStockTransferLines).values(
      lines.map((line) => ({
        transferId,
        medicineId: line.medicineId,
        batchId: line.batchId,
        quantity: line.quantity,
        notes: line.notes,
      })),
    );
  }

  // ─── Reads ─────────────────────────────────────────────────────────────────

  async listTransfers(organizationId: string, filters: TransferFilters): Promise<PageResult<TransferRow>> {
    const branch = await this.availability.resolveBranch(organizationId, filters.branchCode);
    const { page, pageSize, offset } = this.normalizePage(filters.page, filters.pageSize);

    const clauses: SQL[] = [
      eq(pharmacyStockTransfers.organizationId, organizationId),
      eq(pharmacyStockTransfers.branchId, branch.id),
    ];
    if (filters.status) {
      const status = filters.status.trim().toLowerCase();
      if (!(TRANSFER_STATUSES as string[]).includes(status)) {
        throw new BadRequestException(`status must be one of: ${TRANSFER_STATUSES.join(", ")}`);
      }
      clauses.push(eq(pharmacyStockTransfers.status, status));
    }
    if (filters.fromWarehouseId) clauses.push(eq(pharmacyStockTransfers.fromWarehouseId, filters.fromWarehouseId));
    if (filters.toWarehouseId) clauses.push(eq(pharmacyStockTransfers.toWarehouseId, filters.toWarehouseId));
    if (filters.from) clauses.push(gte(pharmacyStockTransfers.createdAt, new Date(`${filters.from}T00:00:00.000Z`)));
    if (filters.to) clauses.push(lte(pharmacyStockTransfers.createdAt, new Date(`${filters.to}T23:59:59.999Z`)));
    if (filters.q?.trim()) {
      const term = `%${filters.q.trim()}%`;
      const search = or(
        ilike(pharmacyStockTransfers.transferNumber, term),
        ilike(pharmacyStockTransfers.reason, term),
        ilike(pharmacyStockTransfers.notes, term),
      );
      if (search) clauses.push(search);
    }
    const where = and(...clauses);

    const [totalRow] = await this.db
      .select({ n: count() })
      .from(pharmacyStockTransfers)
      .where(where);
    const total = Number(totalRow?.n ?? 0);

    const headers = await this.db
      .select({
        id: pharmacyStockTransfers.id,
        transferNumber: pharmacyStockTransfers.transferNumber,
        status: pharmacyStockTransfers.status,
        transferDate: pharmacyStockTransfers.transferDate,
        branchId: pharmacyStockTransfers.branchId,
        fromWarehouseId: pharmacyStockTransfers.fromWarehouseId,
        fromWarehouseCode: fromWarehouse.code,
        fromWarehouseName: fromWarehouse.name,
        toWarehouseId: pharmacyStockTransfers.toWarehouseId,
        toWarehouseCode: toWarehouse.code,
        toWarehouseName: toWarehouse.name,
        toBranchId: pharmacyStockTransfers.toBranchId,
        reason: pharmacyStockTransfers.reason,
        notes: pharmacyStockTransfers.notes,
        cancelReason: pharmacyStockTransfers.cancelReason,
        submittedAt: pharmacyStockTransfers.submittedAt,
        approvedAt: pharmacyStockTransfers.approvedAt,
        dispatchedAt: pharmacyStockTransfers.dispatchedAt,
        receivedAt: pharmacyStockTransfers.receivedAt,
        completedAt: pharmacyStockTransfers.completedAt,
        cancelledAt: pharmacyStockTransfers.cancelledAt,
        createdAt: pharmacyStockTransfers.createdAt,
      })
      .from(pharmacyStockTransfers)
      .leftJoin(fromWarehouse, eq(fromWarehouse.id, pharmacyStockTransfers.fromWarehouseId))
      .leftJoin(toWarehouse, eq(toWarehouse.id, pharmacyStockTransfers.toWarehouseId))
      .where(where)
      .orderBy(desc(pharmacyStockTransfers.createdAt))
      .limit(pageSize)
      .offset(offset);

    const totals = await this.lineTotals(headers.map((h) => h.id));
    const items = headers.map((h) => ({ ...h, ...(totals.get(h.id) ?? this.emptyTotals()) }));
    return this.pageResult(items, total, page, pageSize);
  }

  private emptyTotals() {
    return { lineCount: 0, totalQuantity: 0, totalReceivedQuantity: 0, totalShortage: 0, totalValuePkr: 0 };
  }

  private async lineTotals(transferIds: string[]) {
    const map = new Map<string, ReturnType<StockTransferService["emptyTotals"]>>();
    if (!transferIds.length) return map;
    const rows = await this.db
      .select({
        transferId: pharmacyStockTransferLines.transferId,
        lineCount: count(),
        totalQuantity: sql<number>`coalesce(sum(${pharmacyStockTransferLines.quantity}), 0)`,
        totalReceivedQuantity: sql<number>`coalesce(sum(${pharmacyStockTransferLines.receivedQuantity}), 0)`,
        totalValuePkr: sql<number>`coalesce(sum(${pharmacyStockTransferLines.quantity} * ${pharmacyStockTransferLines.unitCostPkr}), 0)`,
      })
      .from(pharmacyStockTransferLines)
      .where(inArray(pharmacyStockTransferLines.transferId, transferIds))
      .groupBy(pharmacyStockTransferLines.transferId);

    for (const row of rows) {
      const totalQuantity = Number(row.totalQuantity ?? 0);
      const totalReceivedQuantity = Number(row.totalReceivedQuantity ?? 0);
      map.set(row.transferId, {
        lineCount: Number(row.lineCount ?? 0),
        totalQuantity,
        totalReceivedQuantity,
        totalShortage: Math.max(0, totalQuantity - totalReceivedQuantity),
        totalValuePkr: Number(row.totalValuePkr ?? 0),
      });
    }
    return map;
  }

  async getTransfer(organizationId: string, transferId: string, branchCode: string): Promise<TransferDetail> {
    const branch = await this.availability.resolveBranch(organizationId, branchCode);
    return this.buildDetail(organizationId, transferId, branch.id);
  }

  private async buildDetail(
    organizationId: string,
    transferId: string,
    branchId: string,
  ): Promise<TransferDetail> {
    const header = await this.loadHeader(organizationId, transferId, branchId);

    const warehouses = await this.db
      .select({ id: pharmacyWarehouses.id, code: pharmacyWarehouses.code, name: pharmacyWarehouses.name })
      .from(pharmacyWarehouses)
      .where(inArray(pharmacyWarehouses.id, [header.fromWarehouseId, header.toWarehouseId]));
    const warehouseById = new Map(warehouses.map((w) => [w.id, w]));

    const fromBranch = await this.resolveBranchById(organizationId, header.branchId);
    const toBranch = header.toBranchId
      ? await this.resolveBranchById(organizationId, header.toBranchId)
      : fromBranch;

    const lineRows = await this.db
      .select({
        id: pharmacyStockTransferLines.id,
        medicineId: pharmacyStockTransferLines.medicineId,
        medicineName: pharmacyMedicines.name,
        medicineSku: pharmacyMedicines.sku,
        unit: pharmacyMedicines.unit,
        batchId: pharmacyStockTransferLines.batchId,
        snapshotBatchNumber: pharmacyStockTransferLines.batchNumber,
        snapshotExpiryDate: pharmacyStockTransferLines.expiryDate,
        liveBatchNumber: pharmacyMedicineBatches.batchNumber,
        liveExpiryDate: pharmacyMedicineBatches.expiryDate,
        quantity: pharmacyStockTransferLines.quantity,
        receivedQuantity: pharmacyStockTransferLines.receivedQuantity,
        unitCostPkr: pharmacyStockTransferLines.unitCostPkr,
        destinationBatchId: pharmacyStockTransferLines.destinationBatchId,
        destinationBatchNumber: destinationBatch.batchNumber,
        notes: pharmacyStockTransferLines.notes,
      })
      .from(pharmacyStockTransferLines)
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyStockTransferLines.medicineId))
      .leftJoin(pharmacyMedicineBatches, eq(pharmacyMedicineBatches.id, pharmacyStockTransferLines.batchId))
      .leftJoin(destinationBatch, eq(destinationBatch.id, pharmacyStockTransferLines.destinationBatchId))
      .where(eq(pharmacyStockTransferLines.transferId, transferId))
      .orderBy(asc(pharmacyMedicines.name));

    const lines: TransferLineDetail[] = lineRows.map((row) => ({
      id: row.id,
      medicineId: row.medicineId,
      medicineName: row.medicineName,
      medicineSku: row.medicineSku,
      unit: row.unit,
      batchId: row.batchId,
      batchNumber: row.snapshotBatchNumber ?? row.liveBatchNumber,
      expiryDate: row.snapshotExpiryDate ?? row.liveExpiryDate,
      quantity: row.quantity,
      receivedQuantity: row.receivedQuantity,
      shortage: Math.max(0, row.quantity - row.receivedQuantity),
      unitCostPkr: row.unitCostPkr,
      valuePkr: row.quantity * row.unitCostPkr,
      destinationBatchId: row.destinationBatchId,
      destinationBatchNumber: row.destinationBatchNumber,
      notes: row.notes,
    }));

    const totalQuantity = lines.reduce((sum, l) => sum + l.quantity, 0);
    const totalReceivedQuantity = lines.reduce((sum, l) => sum + l.receivedQuantity, 0);

    return {
      id: header.id,
      transferNumber: header.transferNumber,
      status: header.status,
      transferDate: header.transferDate,
      branchId: header.branchId,
      fromWarehouseId: header.fromWarehouseId,
      fromWarehouseCode: warehouseById.get(header.fromWarehouseId)?.code ?? null,
      fromWarehouseName: warehouseById.get(header.fromWarehouseId)?.name ?? null,
      toWarehouseId: header.toWarehouseId,
      toWarehouseCode: warehouseById.get(header.toWarehouseId)?.code ?? null,
      toWarehouseName: warehouseById.get(header.toWarehouseId)?.name ?? null,
      toBranchId: header.toBranchId,
      reason: header.reason,
      notes: header.notes,
      cancelReason: header.cancelReason,
      lineCount: lines.length,
      totalQuantity,
      totalReceivedQuantity,
      totalShortage: lines.reduce((sum, l) => sum + l.shortage, 0),
      totalValuePkr: lines.reduce((sum, l) => sum + l.valuePkr, 0),
      submittedAt: header.submittedAt,
      approvedAt: header.approvedAt,
      dispatchedAt: header.dispatchedAt,
      receivedAt: header.receivedAt,
      completedAt: header.completedAt,
      cancelledAt: header.cancelledAt,
      createdAt: header.createdAt,
      fromBranch,
      toBranch,
      lines,
    };
  }

  // ─── Writes ────────────────────────────────────────────────────────────────

  async createTransfer(
    organizationId: string,
    input: CreateTransferInput,
    userId?: string,
  ): Promise<TransferDetail> {
    const branch = await this.availability.resolveBranch(organizationId, input.branchCode);

    if (!input.fromWarehouseId || !input.toWarehouseId) {
      throw new BadRequestException("fromWarehouseId and toWarehouseId are required");
    }
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw new BadRequestException("Source and destination warehouse must differ");
    }

    const source = await this.availability.resolveWarehouse(organizationId, branch.id, input.fromWarehouseId);
    if (!source) throw new NotFoundException("Source warehouse not found for this branch");
    const destinationBranch = input.toBranchId
      ? await this.resolveBranchById(organizationId, input.toBranchId)
      : branch;
    const destination = await this.availability.resolveWarehouse(
      organizationId,
      destinationBranch.id,
      input.toWarehouseId,
    );
    if (!destination) throw new NotFoundException("Destination warehouse not found for the destination branch");

    const lines = await this.normalizeLines(organizationId, branch.id, source.id, input.lines);
    await this.assertAvailability(organizationId, branch.id, source.id, lines, "create this transfer");

    const transferId = await this.numbering.withNumber(organizationId, "transfer", async (transferNumber) =>
      this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(pharmacyStockTransfers)
          .values({
            organizationId,
            branchId: branch.id,
            transferNumber,
            fromWarehouseId: source.id,
            toWarehouseId: destination.id,
            toBranchId: input.toBranchId ?? null,
            status: "draft",
            transferDate: input.transferDate ?? new Date().toISOString().slice(0, 10),
            reason: input.reason?.trim() || null,
            notes: input.notes?.trim() || null,
            createdByUserId: userId ?? null,
          })
          .returning();
        if (!created) throw new BadRequestException("Failed to create stock transfer");

        await this.replaceLines(tx, created.id, lines);
        await this.writeAudit(tx, {
          organizationId,
          branchId: branch.id,
          userId,
          action: "stock_transfer.create",
          entityId: created.id,
          newValue: { transferNumber, status: "draft", lineCount: lines.length },
          reason: input.reason?.trim() || null,
        });
        return created.id;
      }),
    );

    return this.buildDetail(organizationId, transferId, branch.id);
  }

  async updateTransfer(
    organizationId: string,
    transferId: string,
    input: UpdateTransferInput,
    userId?: string,
  ): Promise<TransferDetail> {
    const branch = await this.availability.resolveBranch(organizationId, input.branchCode);
    const existing = await this.loadHeader(organizationId, transferId, branch.id);
    this.assertStatus(existing.status, ["draft"], "edit");

    const fromWarehouseId = input.fromWarehouseId ?? existing.fromWarehouseId;
    const toWarehouseId = input.toWarehouseId ?? existing.toWarehouseId;
    if (fromWarehouseId === toWarehouseId) {
      throw new BadRequestException("Source and destination warehouse must differ");
    }
    const source = await this.availability.resolveWarehouse(organizationId, branch.id, fromWarehouseId);
    if (!source) throw new NotFoundException("Source warehouse not found for this branch");

    const toBranchId = input.toBranchId !== undefined ? input.toBranchId || null : existing.toBranchId;
    const destinationBranch = toBranchId ? await this.resolveBranchById(organizationId, toBranchId) : branch;
    const destination = await this.availability.resolveWarehouse(
      organizationId,
      destinationBranch.id,
      toWarehouseId,
    );
    if (!destination) throw new NotFoundException("Destination warehouse not found for the destination branch");

    const lines =
      input.lines !== undefined
        ? await this.normalizeLines(organizationId, branch.id, source.id, input.lines)
        : null;
    if (lines) await this.assertAvailability(organizationId, branch.id, source.id, lines, "update this transfer");

    await this.db.transaction(async (tx) => {
      const locked = await this.lockHeader(organizationId, transferId, branch.id, tx);
      this.assertStatus(locked.status, ["draft"], "edit");

      await tx
        .update(pharmacyStockTransfers)
        .set({
          fromWarehouseId: source.id,
          toWarehouseId: destination.id,
          toBranchId,
          transferDate: input.transferDate ?? locked.transferDate,
          reason: input.reason !== undefined ? input.reason?.trim() || null : locked.reason,
          notes: input.notes !== undefined ? input.notes?.trim() || null : locked.notes,
        })
        .where(eq(pharmacyStockTransfers.id, transferId));

      if (lines) await this.replaceLines(tx, transferId, lines);

      await this.writeAudit(tx, {
        organizationId,
        branchId: branch.id,
        userId,
        action: "stock_transfer.update",
        entityId: transferId,
        oldValue: {
          fromWarehouseId: locked.fromWarehouseId,
          toWarehouseId: locked.toWarehouseId,
          toBranchId: locked.toBranchId,
          reason: locked.reason,
        },
        newValue: {
          fromWarehouseId: source.id,
          toWarehouseId: destination.id,
          toBranchId,
          reason: input.reason !== undefined ? input.reason?.trim() || null : locked.reason,
          lineCount: lines?.length ?? null,
        },
      });
    });

    return this.buildDetail(organizationId, transferId, branch.id);
  }

  async submitTransfer(
    organizationId: string,
    transferId: string,
    branchCode: string,
    userId?: string,
  ): Promise<TransferDetail> {
    const branch = await this.availability.resolveBranch(organizationId, branchCode);

    await this.db.transaction(async (tx) => {
      const header = await this.lockHeader(organizationId, transferId, branch.id, tx);
      this.assertStatus(header.status, ["draft"], "submit");

      const lines = await tx
        .select({
          medicineId: pharmacyStockTransferLines.medicineId,
          quantity: pharmacyStockTransferLines.quantity,
        })
        .from(pharmacyStockTransferLines)
        .where(eq(pharmacyStockTransferLines.transferId, transferId));
      if (!lines.length) throw new BadRequestException("Cannot submit a transfer with no lines");
      await this.assertAvailability(organizationId, branch.id, header.fromWarehouseId, lines, "submit this transfer");

      await tx
        .update(pharmacyStockTransfers)
        .set({ status: "submitted", submittedAt: new Date(), submittedByUserId: userId ?? null })
        .where(eq(pharmacyStockTransfers.id, transferId));

      await this.writeAudit(tx, {
        organizationId,
        branchId: branch.id,
        userId,
        action: "stock_transfer.submit",
        entityId: transferId,
        oldValue: { status: header.status },
        newValue: { status: "submitted" },
      });
    });

    return this.buildDetail(organizationId, transferId, branch.id);
  }

  async approveTransfer(
    organizationId: string,
    transferId: string,
    branchCode: string,
    userId?: string,
  ): Promise<TransferDetail> {
    const branch = await this.availability.resolveBranch(organizationId, branchCode);

    await this.db.transaction(async (tx) => {
      const header = await this.lockHeader(organizationId, transferId, branch.id, tx);
      this.assertStatus(header.status, ["submitted"], "approve");

      await tx
        .update(pharmacyStockTransfers)
        .set({ status: "approved", approvedAt: new Date(), approvedByUserId: userId ?? null })
        .where(eq(pharmacyStockTransfers.id, transferId));

      await this.writeAudit(tx, {
        organizationId,
        branchId: branch.id,
        userId,
        action: "stock_transfer.approve",
        entityId: transferId,
        oldValue: { status: header.status },
        newValue: { status: "approved" },
      });
    });

    return this.buildDetail(organizationId, transferId, branch.id);
  }

  /**
   * Deducts the stock from the source warehouse and snapshots the batch identity
   * onto each line so the destination batch can be recreated faithfully.
   */
  async dispatchTransfer(
    organizationId: string,
    transferId: string,
    branchCode: string,
    userId?: string,
  ): Promise<TransferDetail> {
    const branch = await this.availability.resolveBranch(organizationId, branchCode);

    await this.db.transaction(async (tx) => {
      const header = await this.lockHeader(organizationId, transferId, branch.id, tx);
      // Replay guard: the locked status is the authority. A retried dispatch
      // lands here and raises a conflict instead of deducting a second time.
      this.assertStatus(header.status, ["approved"], "dispatch");

      const lines = await tx
        .select()
        .from(pharmacyStockTransferLines)
        .where(eq(pharmacyStockTransferLines.transferId, transferId));
      if (!lines.length) throw new BadRequestException("Cannot dispatch a transfer with no lines");

      // Stock may have moved between approval and dispatch, so availability is
      // re-checked against the live numbers before anything is deducted.
      await this.assertAvailability(
        organizationId,
        branch.id,
        header.fromWarehouseId,
        lines.map((l) => ({ medicineId: l.medicineId, quantity: l.quantity })),
        "dispatch this transfer",
      );

      for (const line of lines) {
        // `pharmacy_stock_movements` is unique on (organization_id, idempotency_key)
        // and `deductFefo` stamps the same key on every allocation row it writes,
        // so the key is only supplied when the line is guaranteed to resolve to a
        // single batch. Multi-batch lines rely on the FOR UPDATE status guard above.
        const singleBatch = line.batchId
          ? await this.batchCoversLine(tx, line.batchId, line.quantity)
          : false;

        const usedBatchId = await this.engine.deductFefo(tx, {
          organizationId,
          branchId: branch.id,
          medicineId: line.medicineId,
          qty: line.quantity,
          warehouseId: header.fromWarehouseId,
          preferredBatchId: line.batchId ?? undefined,
          referenceType: "stock_transfer",
          referenceId: transferId,
          movementType: MOVEMENT_TYPES.TRANSFER_OUT,
          idempotencyKey: singleBatch ? `transfer:${transferId}:dispatch:${line.id}` : null,
          createdByUserId: userId,
        });
        if (!usedBatchId) {
          throw new BadRequestException("Dispatch failed: no batch could be allocated for a transfer line");
        }

        // Snapshot limitation: `deductFefo` returns only the primary batch it
        // consumed. When a line spans several batches the destination is
        // rebuilt as one batch carrying the primary batch's number, expiry and
        // cost — the ledger still records each source batch individually.
        const [batch] = await tx
          .select({
            batchNumber: pharmacyMedicineBatches.batchNumber,
            expiryDate: pharmacyMedicineBatches.expiryDate,
            purchaseRatePkr: pharmacyMedicineBatches.purchaseRatePkr,
          })
          .from(pharmacyMedicineBatches)
          .where(eq(pharmacyMedicineBatches.id, usedBatchId))
          .limit(1);

        await tx
          .update(pharmacyStockTransferLines)
          .set({
            batchId: usedBatchId,
            batchNumber: batch?.batchNumber ?? line.batchNumber,
            expiryDate: batch?.expiryDate ?? line.expiryDate,
            unitCostPkr: batch?.purchaseRatePkr ?? line.unitCostPkr,
          })
          .where(eq(pharmacyStockTransferLines.id, line.id));
      }

      await tx
        .update(pharmacyStockTransfers)
        .set({ status: "dispatched", dispatchedAt: new Date(), dispatchedByUserId: userId ?? null })
        .where(eq(pharmacyStockTransfers.id, transferId));

      await this.writeAudit(tx, {
        organizationId,
        branchId: branch.id,
        userId,
        action: "stock_transfer.dispatch",
        entityId: transferId,
        oldValue: { status: header.status },
        newValue: {
          status: "dispatched",
          fromWarehouseId: header.fromWarehouseId,
          lines: lines.map((l) => ({ lineId: l.id, medicineId: l.medicineId, quantity: l.quantity })),
        },
      });
    });

    return this.buildDetail(organizationId, transferId, branch.id);
  }

  private async batchCoversLine(tx: StockTx, batchId: string, quantity: number) {
    const [batch] = await tx
      .select({ quantity: pharmacyMedicineBatches.quantity })
      .from(pharmacyMedicineBatches)
      .where(eq(pharmacyMedicineBatches.id, batchId))
      .limit(1);
    return Boolean(batch && batch.quantity >= quantity);
  }

  /**
   * Receives stock at the destination warehouse.
   *
   * `receivedQuantity` is the running total for the line, not a delta, so a
   * second call can top up an earlier partial receipt. Partial receipts leave
   * the document in `received`; the shortage stays visible on the line and is
   * never written off silently.
   */
  async receiveTransfer(
    organizationId: string,
    transferId: string,
    input: { branchCode: string; lines?: { lineId: string; receivedQuantity: number }[] },
    userId?: string,
  ): Promise<TransferDetail> {
    const branch = await this.availability.resolveBranch(organizationId, input.branchCode);

    await this.db.transaction(async (tx) => {
      const header = await this.lockHeader(organizationId, transferId, branch.id, tx);
      this.assertStatus(header.status, ["dispatched", "received"], "receive");

      const lines = await tx
        .select()
        .from(pharmacyStockTransferLines)
        .where(eq(pharmacyStockTransferLines.transferId, transferId));
      if (!lines.length) throw new BadRequestException("Cannot receive a transfer with no lines");

      const requested = new Map<string, number>();
      if (input.lines?.length) {
        const known = new Set(lines.map((l) => l.id));
        for (const entry of input.lines) {
          if (!known.has(entry.lineId)) {
            throw new BadRequestException(`Line ${entry.lineId} does not belong to this transfer`);
          }
          const qty = Math.floor(Number(entry.receivedQuantity));
          if (!Number.isFinite(qty) || qty < 0) {
            throw new BadRequestException("receivedQuantity must be zero or a positive whole number");
          }
          requested.set(entry.lineId, qty);
        }
      }

      const destinationBranchId = header.toBranchId ?? header.branchId;
      const targets = new Map<string, number>();

      for (const line of lines) {
        // With no payload every line is taken as fully received, which is the
        // common "everything arrived" case. With a payload, listed lines get the
        // stated total and unlisted lines keep whatever they already had.
        const target = input.lines?.length
          ? (requested.get(line.id) ?? line.receivedQuantity)
          : line.quantity;
        if (target > line.quantity) {
          throw new BadRequestException(
            `Received quantity ${target} exceeds the dispatched quantity ${line.quantity} on one of the lines`,
          );
        }
        if (target < line.receivedQuantity) {
          throw new BadRequestException(
            "Received quantity cannot be lowered; raise an adjustment to correct stock that was received in error",
          );
        }
        targets.set(line.id, target);

        const delta = target - line.receivedQuantity;
        if (delta <= 0) continue;

        if (!line.batchNumber || !line.expiryDate) {
          throw new BadRequestException(
            "Transfer line is missing its dispatch batch snapshot; it cannot be received",
          );
        }

        const destinationMedicineId = await this.resolveDestinationMedicine(
          tx,
          organizationId,
          header.branchId,
          destinationBranchId,
          line.medicineId,
        );

        const destinationBatchId = await this.engine.receiveBatch(tx, {
          organizationId,
          branchId: destinationBranchId,
          warehouseId: header.toWarehouseId,
          medicineId: destinationMedicineId,
          batchNumber: line.batchNumber,
          expiryDate: line.expiryDate,
          quantity: delta,
          purchaseRatePkr: line.unitCostPkr,
          referenceType: "stock_transfer",
          referenceId: transferId,
          movementType: MOVEMENT_TYPES.TRANSFER_IN,
          // The ledger is unique on (organization_id, idempotency_key), so a
          // top-up receipt has to carry its own key. The running total makes it
          // distinct while still rejecting a replay of the same receipt.
          idempotencyKey:
            line.receivedQuantity === 0
              ? `transfer:${transferId}:receive:${line.id}`
              : `transfer:${transferId}:receive:${line.id}:${target}`,
          createdByUserId: userId,
        });

        await tx
          .update(pharmacyStockTransferLines)
          .set({ receivedQuantity: target, destinationBatchId })
          .where(eq(pharmacyStockTransferLines.id, line.id));
      }

      const totalOrdered = lines.reduce((sum, l) => sum + l.quantity, 0);
      const totalReceived = lines.reduce((sum, l) => sum + (targets.get(l.id) ?? l.receivedQuantity), 0);
      const fullyReceived = totalReceived >= totalOrdered;
      const now = new Date();

      await tx
        .update(pharmacyStockTransfers)
        .set({
          status: fullyReceived ? "completed" : "received",
          receivedAt: now,
          receivedByUserId: userId ?? null,
          completedAt: fullyReceived ? now : null,
        })
        .where(eq(pharmacyStockTransfers.id, transferId));

      await this.writeAudit(tx, {
        organizationId,
        branchId: branch.id,
        userId,
        action: "stock_transfer.receive",
        entityId: transferId,
        oldValue: { status: header.status },
        newValue: {
          status: fullyReceived ? "completed" : "received",
          totalOrdered,
          totalReceived,
          shortage: Math.max(0, totalOrdered - totalReceived),
        },
        reason: fullyReceived ? null : "Partial receipt: shortage recorded on the transfer lines",
      });
    });

    return this.buildDetail(organizationId, transferId, branch.id);
  }

  async cancelTransfer(
    organizationId: string,
    transferId: string,
    input: { branchCode: string; reason: string },
    userId?: string,
  ): Promise<TransferDetail> {
    const branch = await this.availability.resolveBranch(organizationId, input.branchCode);
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException("A cancellation reason is required");

    await this.db.transaction(async (tx) => {
      const header = await this.lockHeader(organizationId, transferId, branch.id, tx);
      // Once dispatched the stock has physically left the source warehouse, so
      // the document must be received (with a shortage) rather than cancelled.
      this.assertStatus(header.status, ["draft", "submitted", "approved"], "cancel");

      await tx
        .update(pharmacyStockTransfers)
        .set({
          status: "cancelled",
          cancelledAt: new Date(),
          cancelledByUserId: userId ?? null,
          cancelReason: reason,
        })
        .where(eq(pharmacyStockTransfers.id, transferId));

      await this.writeAudit(tx, {
        organizationId,
        branchId: branch.id,
        userId,
        action: "stock_transfer.cancel",
        entityId: transferId,
        oldValue: { status: header.status },
        newValue: { status: "cancelled" },
        reason,
      });
    });

    return this.buildDetail(organizationId, transferId, branch.id);
  }
}
