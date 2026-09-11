import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  pharmacyAuditLogs,
  pharmacyMedicineBatches,
  pharmacyMedicines,
  pharmacyStockCountLines,
  pharmacyStockCounts,
  pharmacyWarehouses,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import type { StockTx } from "../pharmacy-stock.engine";
import { InventoryNumberingService } from "./inventory-numbering.service";
import { StockAdjustmentService, type AdjustmentLineInput } from "./stock-adjustment.service";
import { StockAvailabilityService } from "./stock-availability.service";

export type PageResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type CountStatus = "draft" | "counting" | "review" | "posted" | "cancelled";

const COUNT_STATUSES: CountStatus[] = ["draft", "counting", "review", "posted", "cancelled"];
const COUNT_TYPES = ["full", "cycle"] as const;
type CountType = (typeof COUNT_TYPES)[number];

/**
 * A generated sheet is capped so a mistyped scope cannot turn into a
 * multi-hour request that locks up a worker. Beyond this the operator is told
 * to narrow the scope and run several cycle counts instead.
 */
const MAX_COUNT_LINES = 5000;

export type CountScope = {
  companyId?: string;
  categoryId?: string;
  medicineIds?: string[];
  rackLocation?: string;
};

export type CountRow = {
  id: string;
  countNumber: string;
  status: string;
  countType: string;
  branchId: string;
  warehouseId: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  notes: string | null;
  scope: CountScope | null;
  lineCount: number;
  varianceQuantity: number;
  varianceValuePkr: number;
  adjustmentId: string | null;
  postedAt: Date | null;
  createdAt: Date;
};

export type CountLineDetail = {
  id: string;
  medicineId: string;
  medicineName: string;
  medicineSku: string;
  unit: string;
  batchId: string | null;
  batchNumber: string | null;
  expiryDate: string | null;
  systemQuantity: number;
  countedQuantity: number | null;
  varianceQuantity: number;
  varianceValuePkr: number;
  unitCostPkr: number;
  counted: boolean;
  notes: string | null;
};

export type CountDetail = CountRow & {
  countedLines: number;
  /** Never counted, therefore never posted — a skipped line is not a zero. */
  uncountedLines: number;
  varianceLines: number;
  lines: PageResult<CountLineDetail>;
};

export type CountFilters = {
  branchCode: string;
  status?: string;
  countType?: string;
  warehouseId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
};

/**
 * Physical and cycle stock counts.
 *
 * A count never touches stock by itself: posting a count generates a stock
 * adjustment document, and that adjustment is what moves the stock, so every
 * count variance ends up in the same audited ledger as a manual correction.
 */
@Injectable()
export class StockCountService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly availability: StockAvailabilityService,
    private readonly adjustments: StockAdjustmentService,
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

  private normalizeCountType(raw: string | undefined): CountType {
    const value = (raw ?? "cycle").trim().toLowerCase();
    if (!(COUNT_TYPES as readonly string[]).includes(value)) {
      throw new BadRequestException(`countType must be one of: ${COUNT_TYPES.join(", ")}`);
    }
    return value as CountType;
  }

  private parseScope(raw: string | null): CountScope | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as CountScope;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  private assertStatus(current: string, allowed: CountStatus[], action: string) {
    if (!(allowed as string[]).includes(current)) {
      throw new ConflictException(
        `Cannot ${action} a stock count that is '${current}'. Allowed statuses: ${allowed.join(", ")}.`,
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
      entityType: "pharmacy_stock_count",
      entityId: input.entityId,
      oldValueJson: input.oldValue === undefined ? null : JSON.stringify(input.oldValue),
      newValueJson: input.newValue === undefined ? null : JSON.stringify(input.newValue),
      reason: input.reason ?? null,
    });
  }

  private async loadHeader(organizationId: string, countId: string, branchId: string, tx: StockTx = this.db) {
    const [row] = await tx
      .select()
      .from(pharmacyStockCounts)
      .where(
        and(
          eq(pharmacyStockCounts.id, countId),
          eq(pharmacyStockCounts.organizationId, organizationId),
          eq(pharmacyStockCounts.branchId, branchId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException("Stock count not found");
    return row;
  }

  /** Row-locked read so a retried post serialises behind the first one. */
  private async lockHeader(organizationId: string, countId: string, branchId: string, tx: StockTx) {
    const [row] = await tx
      .select()
      .from(pharmacyStockCounts)
      .where(
        and(
          eq(pharmacyStockCounts.id, countId),
          eq(pharmacyStockCounts.organizationId, organizationId),
          eq(pharmacyStockCounts.branchId, branchId),
        ),
      )
      .limit(1)
      .for("update");
    if (!row) throw new NotFoundException("Stock count not found");
    return row;
  }

  private async lineStats(tx: StockTx, countId: string) {
    const [row] = await tx
      .select({
        lineCount: count(),
        countedLines: sql<number>`coalesce(sum(case when ${pharmacyStockCountLines.counted} then 1 else 0 end), 0)`,
        varianceLines: sql<number>`coalesce(sum(case when ${pharmacyStockCountLines.counted} and ${pharmacyStockCountLines.varianceQuantity} <> 0 then 1 else 0 end), 0)`,
        varianceQuantity: sql<number>`coalesce(sum(case when ${pharmacyStockCountLines.counted} then ${pharmacyStockCountLines.varianceQuantity} else 0 end), 0)`,
        varianceValuePkr: sql<number>`coalesce(sum(case when ${pharmacyStockCountLines.counted} then ${pharmacyStockCountLines.varianceQuantity} * ${pharmacyStockCountLines.unitCostPkr} else 0 end), 0)`,
      })
      .from(pharmacyStockCountLines)
      .where(eq(pharmacyStockCountLines.countId, countId));

    const lineCount = Number(row?.lineCount ?? 0);
    const countedLines = Number(row?.countedLines ?? 0);
    return {
      lineCount,
      countedLines,
      uncountedLines: Math.max(0, lineCount - countedLines),
      varianceLines: Number(row?.varianceLines ?? 0),
      varianceQuantity: Number(row?.varianceQuantity ?? 0),
      varianceValuePkr: Number(row?.varianceValuePkr ?? 0),
    };
  }

  // ─── Reads ─────────────────────────────────────────────────────────────────

  async listCounts(organizationId: string, filters: CountFilters): Promise<PageResult<CountRow>> {
    const branch = await this.availability.resolveBranch(organizationId, filters.branchCode);
    const { page, pageSize, offset } = this.normalizePage(filters.page, filters.pageSize);

    const clauses: SQL[] = [
      eq(pharmacyStockCounts.organizationId, organizationId),
      eq(pharmacyStockCounts.branchId, branch.id),
    ];
    if (filters.status) {
      const status = filters.status.trim().toLowerCase();
      if (!(COUNT_STATUSES as string[]).includes(status)) {
        throw new BadRequestException(`status must be one of: ${COUNT_STATUSES.join(", ")}`);
      }
      clauses.push(eq(pharmacyStockCounts.status, status));
    }
    if (filters.countType) clauses.push(eq(pharmacyStockCounts.countType, this.normalizeCountType(filters.countType)));
    if (filters.warehouseId) {
      const warehouse = await this.availability.resolveWarehouse(organizationId, branch.id, filters.warehouseId);
      if (warehouse) clauses.push(eq(pharmacyStockCounts.warehouseId, warehouse.id));
    }
    if (filters.q?.trim()) {
      const term = `%${filters.q.trim()}%`;
      const search = or(ilike(pharmacyStockCounts.countNumber, term), ilike(pharmacyStockCounts.notes, term));
      if (search) clauses.push(search);
    }
    const where = and(...clauses);

    const [totalRow] = await this.db.select({ n: count() }).from(pharmacyStockCounts).where(where);
    const total = Number(totalRow?.n ?? 0);

    const rows = await this.db
      .select({
        id: pharmacyStockCounts.id,
        countNumber: pharmacyStockCounts.countNumber,
        status: pharmacyStockCounts.status,
        countType: pharmacyStockCounts.countType,
        branchId: pharmacyStockCounts.branchId,
        warehouseId: pharmacyStockCounts.warehouseId,
        warehouseCode: pharmacyWarehouses.code,
        warehouseName: pharmacyWarehouses.name,
        notes: pharmacyStockCounts.notes,
        scopeJson: pharmacyStockCounts.scopeJson,
        lineCount: pharmacyStockCounts.lineCount,
        varianceQuantity: pharmacyStockCounts.varianceQuantity,
        varianceValuePkr: pharmacyStockCounts.varianceValuePkr,
        adjustmentId: pharmacyStockCounts.adjustmentId,
        postedAt: pharmacyStockCounts.postedAt,
        createdAt: pharmacyStockCounts.createdAt,
      })
      .from(pharmacyStockCounts)
      .leftJoin(pharmacyWarehouses, eq(pharmacyWarehouses.id, pharmacyStockCounts.warehouseId))
      .where(where)
      .orderBy(desc(pharmacyStockCounts.createdAt))
      .limit(pageSize)
      .offset(offset);

    const items: CountRow[] = rows.map(({ scopeJson, ...row }) => ({ ...row, scope: this.parseScope(scopeJson) }));
    return this.pageResult(items, total, page, pageSize);
  }

  async getCount(
    organizationId: string,
    countId: string,
    filters: { branchCode: string; page?: number; pageSize?: number; onlyVariance?: boolean },
  ): Promise<CountDetail> {
    const branch = await this.availability.resolveBranch(organizationId, filters.branchCode);
    return this.buildDetail(organizationId, countId, branch.id, filters);
  }

  private async buildDetail(
    organizationId: string,
    countId: string,
    branchId: string,
    filters: { page?: number; pageSize?: number; onlyVariance?: boolean } = {},
  ): Promise<CountDetail> {
    const header = await this.loadHeader(organizationId, countId, branchId);
    const { page, pageSize, offset } = this.normalizePage(filters.page, filters.pageSize);

    const [warehouse] = await this.db
      .select({ code: pharmacyWarehouses.code, name: pharmacyWarehouses.name })
      .from(pharmacyWarehouses)
      .where(eq(pharmacyWarehouses.id, header.warehouseId))
      .limit(1);

    const lineClauses: SQL[] = [eq(pharmacyStockCountLines.countId, countId)];
    if (filters.onlyVariance) {
      lineClauses.push(eq(pharmacyStockCountLines.counted, true));
      lineClauses.push(sql`${pharmacyStockCountLines.varianceQuantity} <> 0`);
    }
    const lineWhere = and(...lineClauses);

    const [lineTotalRow] = await this.db
      .select({ n: count() })
      .from(pharmacyStockCountLines)
      .where(lineWhere);

    const lineRows = await this.db
      .select({
        id: pharmacyStockCountLines.id,
        medicineId: pharmacyStockCountLines.medicineId,
        medicineName: pharmacyMedicines.name,
        medicineSku: pharmacyMedicines.sku,
        unit: pharmacyMedicines.unit,
        batchId: pharmacyStockCountLines.batchId,
        batchNumber: pharmacyStockCountLines.batchNumber,
        expiryDate: pharmacyStockCountLines.expiryDate,
        systemQuantity: pharmacyStockCountLines.systemQuantity,
        countedQuantity: pharmacyStockCountLines.countedQuantity,
        varianceQuantity: pharmacyStockCountLines.varianceQuantity,
        unitCostPkr: pharmacyStockCountLines.unitCostPkr,
        counted: pharmacyStockCountLines.counted,
        notes: pharmacyStockCountLines.notes,
      })
      .from(pharmacyStockCountLines)
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyStockCountLines.medicineId))
      .where(lineWhere)
      .orderBy(asc(pharmacyMedicines.name), asc(pharmacyStockCountLines.expiryDate))
      .limit(pageSize)
      .offset(offset);

    const lines: CountLineDetail[] = lineRows.map((row) => ({
      ...row,
      varianceValuePkr: row.varianceQuantity * row.unitCostPkr,
    }));

    const stats = await this.lineStats(this.db, countId);

    return {
      id: header.id,
      countNumber: header.countNumber,
      status: header.status,
      countType: header.countType,
      branchId: header.branchId,
      warehouseId: header.warehouseId,
      warehouseCode: warehouse?.code ?? null,
      warehouseName: warehouse?.name ?? null,
      notes: header.notes,
      scope: this.parseScope(header.scopeJson),
      lineCount: header.lineCount,
      varianceQuantity: header.varianceQuantity,
      varianceValuePkr: header.varianceValuePkr,
      adjustmentId: header.adjustmentId,
      postedAt: header.postedAt,
      createdAt: header.createdAt,
      countedLines: stats.countedLines,
      uncountedLines: stats.uncountedLines,
      varianceLines: stats.varianceLines,
      lines: this.pageResult(lines, Number(lineTotalRow?.n ?? 0), page, pageSize),
    };
  }

  // ─── Writes ────────────────────────────────────────────────────────────────

  /**
   * Generates the count sheet by snapshotting the current batch quantities in
   * scope: one line per (medicine, batch). Batches sitting at zero are left out
   * — they carry no stock to verify and would bury the real lines.
   */
  async createCount(
    organizationId: string,
    input: {
      branchCode: string;
      warehouseId: string;
      countType?: string;
      notes?: string;
      scope?: CountScope;
    },
    userId?: string,
  ): Promise<CountDetail> {
    const branch = await this.availability.resolveBranch(organizationId, input.branchCode);
    if (!input.warehouseId) throw new BadRequestException("warehouseId is required");
    const warehouse = await this.availability.resolveWarehouse(organizationId, branch.id, input.warehouseId);
    if (!warehouse) throw new NotFoundException("Warehouse not found for this branch");

    const countType = this.normalizeCountType(input.countType);
    const scope = countType === "cycle" ? (input.scope ?? null) : null;

    const clauses: SQL[] = [
      eq(pharmacyMedicines.organizationId, organizationId),
      eq(pharmacyMedicines.branchId, branch.id),
      // Legacy batches carry a NULL warehouse and belong to the whole branch.
      sql`(${pharmacyMedicineBatches.warehouseId} = ${warehouse.id} OR ${pharmacyMedicineBatches.warehouseId} IS NULL)`,
      sql`${pharmacyMedicineBatches.quantity} <> 0`,
    ];
    if (scope?.companyId) clauses.push(eq(pharmacyMedicines.companyId, scope.companyId));
    if (scope?.categoryId) clauses.push(eq(pharmacyMedicines.categoryId, scope.categoryId));
    if (scope?.medicineIds?.length) clauses.push(inArray(pharmacyMedicines.id, scope.medicineIds));
    if (scope?.rackLocation?.trim()) {
      clauses.push(ilike(pharmacyMedicines.rackLocation, `%${scope.rackLocation.trim()}%`));
    }

    const candidates = await this.db
      .select({
        medicineId: pharmacyMedicines.id,
        medicineName: pharmacyMedicines.name,
        costPricePkr: pharmacyMedicines.costPricePkr,
        purchasePricePkr: pharmacyMedicines.purchasePricePkr,
        batchId: pharmacyMedicineBatches.id,
        batchNumber: pharmacyMedicineBatches.batchNumber,
        expiryDate: pharmacyMedicineBatches.expiryDate,
        quantity: pharmacyMedicineBatches.quantity,
        purchaseRatePkr: pharmacyMedicineBatches.purchaseRatePkr,
      })
      .from(pharmacyMedicineBatches)
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyMedicineBatches.medicineId))
      .where(and(...clauses))
      .orderBy(asc(pharmacyMedicines.name), asc(pharmacyMedicineBatches.expiryDate))
      .limit(MAX_COUNT_LINES + 1);

    if (candidates.length > MAX_COUNT_LINES) {
      throw new BadRequestException(
        `This scope produces more than ${MAX_COUNT_LINES} count lines. Narrow it by company, category, rack or medicine and run several cycle counts.`,
      );
    }
    if (!candidates.length) {
      throw new BadRequestException("No stock matches this scope, so there is nothing to count");
    }

    const countId = await this.numbering.withNumber(organizationId, "count", async (countNumber) =>
      this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(pharmacyStockCounts)
          .values({
            organizationId,
            branchId: branch.id,
            warehouseId: warehouse.id,
            countNumber,
            countType,
            status: "counting",
            scopeJson: scope ? JSON.stringify(scope) : null,
            notes: input.notes?.trim() || null,
            lineCount: candidates.length,
            createdByUserId: userId ?? null,
          })
          .returning();
        if (!created) throw new BadRequestException("Failed to create stock count");

        await tx.insert(pharmacyStockCountLines).values(
          candidates.map((row) => ({
            countId: created.id,
            medicineId: row.medicineId,
            batchId: row.batchId,
            batchNumber: row.batchNumber,
            expiryDate: row.expiryDate,
            systemQuantity: row.quantity,
            unitCostPkr: row.purchaseRatePkr || row.costPricePkr || row.purchasePricePkr || 0,
          })),
        );

        await this.writeAudit(tx, {
          organizationId,
          branchId: branch.id,
          userId,
          action: "stock_count.create",
          entityId: created.id,
          newValue: { countNumber, countType, warehouseId: warehouse.id, lineCount: candidates.length, scope },
        });
        return created.id;
      }),
    );

    return this.buildDetail(organizationId, countId, branch.id);
  }

  async recordCount(
    organizationId: string,
    countId: string,
    input: { branchCode: string; lines: { lineId: string; countedQuantity: number; notes?: string }[] },
    userId?: string,
  ): Promise<CountDetail> {
    const branch = await this.availability.resolveBranch(organizationId, input.branchCode);
    const entries = input.lines ?? [];
    if (!entries.length) throw new BadRequestException("At least one counted line is required");

    await this.db.transaction(async (tx) => {
      const header = await this.lockHeader(organizationId, countId, branch.id, tx);
      this.assertStatus(header.status, ["draft", "counting", "review"], "record counts against");

      const lineIds = entries.map((e) => e.lineId);
      const existing = await tx
        .select({
          id: pharmacyStockCountLines.id,
          systemQuantity: pharmacyStockCountLines.systemQuantity,
        })
        .from(pharmacyStockCountLines)
        .where(
          and(
            eq(pharmacyStockCountLines.countId, countId),
            inArray(pharmacyStockCountLines.id, lineIds),
          ),
        );
      const byId = new Map(existing.map((l) => [l.id, l]));

      for (const entry of entries) {
        const line = byId.get(entry.lineId);
        if (!line) throw new BadRequestException(`Line ${entry.lineId} does not belong to this count`);
        const counted = Math.floor(Number(entry.countedQuantity));
        if (!Number.isFinite(counted) || counted < 0) {
          throw new BadRequestException("countedQuantity must be zero or a positive whole number");
        }
        await tx
          .update(pharmacyStockCountLines)
          .set({
            countedQuantity: counted,
            counted: true,
            varianceQuantity: counted - line.systemQuantity,
            notes: entry.notes?.trim() || null,
          })
          .where(eq(pharmacyStockCountLines.id, entry.lineId));
      }

      const stats = await this.lineStats(tx, countId);
      await tx
        .update(pharmacyStockCounts)
        .set({
          status: stats.countedLines > 0 ? "review" : header.status,
          varianceQuantity: stats.varianceQuantity,
          varianceValuePkr: stats.varianceValuePkr,
        })
        .where(eq(pharmacyStockCounts.id, countId));

      await this.writeAudit(tx, {
        organizationId,
        branchId: branch.id,
        userId,
        action: "stock_count.record",
        entityId: countId,
        oldValue: { status: header.status },
        newValue: {
          status: stats.countedLines > 0 ? "review" : header.status,
          recordedLines: entries.length,
          countedLines: stats.countedLines,
          uncountedLines: stats.uncountedLines,
          varianceQuantity: stats.varianceQuantity,
          varianceValuePkr: stats.varianceValuePkr,
        },
      });
    });

    return this.buildDetail(organizationId, countId, branch.id);
  }

  /**
   * Posts the variance.
   *
   * Adjustment posting semantics are driven by the document type, so a count
   * that found both surpluses and shortages produces TWO adjustments: one
   * `increase` and one `decrease`. Both quote the count number in their reason,
   * which is a searchable field on the adjustment list, and both ids are
   * recorded in the audit trail. The count header can only hold one id, so it
   * keeps the higher-value document.
   *
   * Uncounted lines are excluded outright: a line nobody counted is unknown,
   * not zero, and must never be written off automatically.
   */
  async postCount(
    organizationId: string,
    countId: string,
    input: { branchCode: string; reason?: string },
    userId?: string,
  ): Promise<{ count: CountDetail; adjustmentId: string | null }> {
    const branch = await this.availability.resolveBranch(organizationId, input.branchCode);

    const primaryAdjustmentId = await this.db.transaction(async (tx) => {
      const header = await this.lockHeader(organizationId, countId, branch.id, tx);
      this.assertStatus(header.status, ["counting", "review"], "post");

      const lines = await tx
        .select({
          id: pharmacyStockCountLines.id,
          medicineId: pharmacyStockCountLines.medicineId,
          batchId: pharmacyStockCountLines.batchId,
          varianceQuantity: pharmacyStockCountLines.varianceQuantity,
          counted: pharmacyStockCountLines.counted,
        })
        .from(pharmacyStockCountLines)
        .where(eq(pharmacyStockCountLines.countId, countId));

      const varianceLines = lines.filter((l) => l.counted && l.varianceQuantity !== 0);
      const untracked = varianceLines.filter((l) => !l.batchId);
      if (untracked.length) {
        throw new BadRequestException(
          `${untracked.length} counted line(s) lost their batch reference and cannot be posted. Regenerate the count sheet.`,
        );
      }

      const reason = input.reason?.trim() || `Stock count ${header.countNumber} variance`;
      const surpluses: AdjustmentLineInput[] = varianceLines
        .filter((l) => l.varianceQuantity > 0)
        .map((l) => ({ medicineId: l.medicineId, batchId: l.batchId, quantity: l.varianceQuantity }));
      const shortages: AdjustmentLineInput[] = varianceLines
        .filter((l) => l.varianceQuantity < 0)
        .map((l) => ({ medicineId: l.medicineId, batchId: l.batchId, quantity: -l.varianceQuantity }));

      const created: { id: string; adjustmentNumber: string; totalValuePkr: number }[] = [];
      if (surpluses.length) {
        created.push(
          await this.adjustments.createPostedAdjustmentWithin(
            tx,
            {
              organizationId,
              branchId: branch.id,
              warehouseId: header.warehouseId,
              adjustmentType: "increase",
              reason,
              notes: `Surplus found by stock count ${header.countNumber}`,
              lines: surpluses,
            },
            userId,
          ),
        );
      }
      if (shortages.length) {
        created.push(
          await this.adjustments.createPostedAdjustmentWithin(
            tx,
            {
              organizationId,
              branchId: branch.id,
              warehouseId: header.warehouseId,
              adjustmentType: "decrease",
              reason,
              notes: `Shortage found by stock count ${header.countNumber}`,
              lines: shortages,
            },
            userId,
          ),
        );
      }

      const primary =
        created.length > 1
          ? created.reduce((a, b) => (Math.abs(b.totalValuePkr) > Math.abs(a.totalValuePkr) ? b : a))
          : (created[0] ?? null);

      const stats = await this.lineStats(tx, countId);
      await tx
        .update(pharmacyStockCounts)
        .set({
          status: "posted",
          postedAt: new Date(),
          postedByUserId: userId ?? null,
          adjustmentId: primary?.id ?? null,
          varianceQuantity: stats.varianceQuantity,
          varianceValuePkr: stats.varianceValuePkr,
        })
        .where(eq(pharmacyStockCounts.id, countId));

      await this.writeAudit(tx, {
        organizationId,
        branchId: branch.id,
        userId,
        action: "stock_count.post",
        entityId: countId,
        oldValue: { status: header.status },
        newValue: {
          status: "posted",
          adjustmentIds: created.map((c) => c.id),
          adjustmentNumbers: created.map((c) => c.adjustmentNumber),
          varianceLines: varianceLines.length,
          uncountedLines: stats.uncountedLines,
          varianceQuantity: stats.varianceQuantity,
          varianceValuePkr: stats.varianceValuePkr,
        },
        reason,
      });

      return primary?.id ?? null;
    });

    return {
      count: await this.buildDetail(organizationId, countId, branch.id),
      adjustmentId: primaryAdjustmentId,
    };
  }

  async cancelCount(
    organizationId: string,
    countId: string,
    input: { branchCode: string; reason: string },
    userId?: string,
  ): Promise<CountDetail> {
    const branch = await this.availability.resolveBranch(organizationId, input.branchCode);
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException("A cancellation reason is required");

    await this.db.transaction(async (tx) => {
      const header = await this.lockHeader(organizationId, countId, branch.id, tx);
      this.assertStatus(header.status, ["draft", "counting", "review"], "cancel");

      await tx
        .update(pharmacyStockCounts)
        .set({ status: "cancelled" })
        .where(eq(pharmacyStockCounts.id, countId));

      await this.writeAudit(tx, {
        organizationId,
        branchId: branch.id,
        userId,
        action: "stock_count.cancel",
        entityId: countId,
        oldValue: { status: header.status },
        newValue: { status: "cancelled" },
        reason,
      });
    });

    return this.buildDetail(organizationId, countId, branch.id);
  }
}
