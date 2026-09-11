import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import {
  pharmacyAuditLogs,
  pharmacyCompanies,
  pharmacyDistInvoiceLines,
  pharmacyDistInvoices,
  pharmacyGrns,
  pharmacyMedicineBatches,
  pharmacyMedicines,
  pharmacyStockReservations,
  pharmacyTradeCustomers,
  pharmacyWarehouses,
  popsSuppliers,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { DEFAULT_INVENTORY_SETTINGS, InventorySettingsService } from "./inventory-settings.service";
import { StockAvailabilityService } from "./stock-availability.service";
import { StockLedgerService } from "./stock-ledger.service";

export type PageResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function normalizePage(page?: number, pageSize?: number, max = 100) {
  const p = Math.max(1, Math.floor(Number(page) || 1));
  const ps = Math.min(max, Math.max(1, Math.floor(Number(pageSize) || 25)));
  return { page: p, pageSize: ps, offset: (p - 1) * ps };
}

export function pageResult<T>(items: T[], total: number, page: number, pageSize: number): PageResult<T> {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Computed from expiry date, hold flag and quantity. Never stored on the row. */
export type BatchDerivedStatus = "expired" | "hold" | "depleted" | "near_expiry" | "active";

export type BatchRow = {
  id: string;
  medicineId: string;
  medicineName: string;
  medicineSku: string;
  companyName: string | null;
  batchNumber: string;
  manufacturingDate: string | null;
  expiryDate: string;
  warehouseId: string | null;
  warehouseName: string | null;
  quantity: number;
  reservedQuantity: number;
  damagedQuantity: number;
  quarantineQuantity: number;
  blockedQuantity: number;
  physicalQty: number;
  purchaseRatePkr: number;
  saleRatePkr: number;
  valuePkr: number;
  status: string;
  holdReason: string | null;
  derivedStatus: BatchDerivedStatus;
  daysToExpiry: number;
  createdAt: Date;
};

export type BatchReservationRow = {
  id: string;
  referenceType: string;
  referenceId: string;
  quantity: number;
  status: string;
  expiresAt: Date | null;
  createdAt: Date;
};

export type BatchSoldToCustomer = {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  customerId: string | null;
  customerName: string | null;
  quantity: number;
};

export type BatchTraceability = {
  supplierId: string | null;
  supplierName: string | null;
  grnId: string | null;
  grnNumber: string | null;
  receivedAt: Date;
  soldToCustomers: BatchSoldToCustomer[];
};

type LedgerPage = Awaited<ReturnType<StockLedgerService["listMovements"]>>;

export type BatchDetail = BatchRow & {
  movements: LedgerPage["items"];
  reservations: BatchReservationRow[];
  traceability: BatchTraceability;
};

export type ExpiryBucket = {
  label: string;
  fromDays: number;
  /** null on the final open-ended bucket (">180 days"). */
  toDays: number | null;
  batchCount: number;
  quantity: number;
  valuePkr: number;
};

export type ExpiryBucketsResult = {
  buckets: ExpiryBucket[];
  expired: { batchCount: number; quantity: number; valuePkr: number };
  totalNearExpiryValuePkr: number;
};

export type BatchListFilters = {
  branchCode: string;
  warehouseId?: string;
  medicineId?: string;
  companyId?: string;
  q?: string;
  /** active | hold | expired | near_expiry | zero | all */
  status?: string;
  expiringInDays?: number;
  page?: number;
  pageSize?: number;
  sort?: string;
};

const BATCH_SORTS = ["expiry_asc", "expiry_desc", "qty_desc", "medicine_asc", "created_desc"] as const;

/** Manual hold flags an operator may set. Anything else is rejected. */
const HOLD_STATUSES = ["active", "blocked", "quarantine", "recalled"];

@Injectable()
export class BatchStockService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly availability: StockAvailabilityService,
    private readonly settings: InventorySettingsService,
    private readonly ledger: StockLedgerService,
  ) {}

  private physicalExpr() {
    return sql<number>`(
      ${pharmacyMedicineBatches.quantity}
      + ${pharmacyMedicineBatches.reservedQuantity}
      + ${pharmacyMedicineBatches.damagedQuantity}
      + ${pharmacyMedicineBatches.quarantineQuantity}
      + ${pharmacyMedicineBatches.blockedQuantity}
    )`;
  }

  private batchSelect() {
    return {
      id: pharmacyMedicineBatches.id,
      medicineId: pharmacyMedicineBatches.medicineId,
      medicineName: pharmacyMedicines.name,
      medicineSku: pharmacyMedicines.sku,
      companyName: pharmacyCompanies.name,
      batchNumber: pharmacyMedicineBatches.batchNumber,
      manufacturingDate: pharmacyMedicineBatches.manufacturingDate,
      expiryDate: pharmacyMedicineBatches.expiryDate,
      warehouseId: pharmacyMedicineBatches.warehouseId,
      warehouseName: pharmacyWarehouses.name,
      quantity: pharmacyMedicineBatches.quantity,
      reservedQuantity: pharmacyMedicineBatches.reservedQuantity,
      damagedQuantity: pharmacyMedicineBatches.damagedQuantity,
      quarantineQuantity: pharmacyMedicineBatches.quarantineQuantity,
      blockedQuantity: pharmacyMedicineBatches.blockedQuantity,
      physicalQty: this.physicalExpr(),
      purchaseRatePkr: pharmacyMedicineBatches.purchaseRatePkr,
      saleRatePkr: pharmacyMedicineBatches.saleRatePkr,
      valuePkr: sql<number>`(${pharmacyMedicineBatches.quantity} * ${pharmacyMedicineBatches.purchaseRatePkr})`,
      status: pharmacyMedicineBatches.status,
      holdReason: pharmacyMedicineBatches.holdReason,
      daysToExpiry: sql<number>`(${pharmacyMedicineBatches.expiryDate} - current_date)`,
      createdAt: pharmacyMedicineBatches.createdAt,
    };
  }

  private derive(
    row: { status: string | null; daysToExpiry: number; physicalQty: number },
    nearExpiryDays: number,
  ): BatchDerivedStatus {
    if (row.daysToExpiry < 0) return "expired";
    if ((row.status ?? "active").toLowerCase() !== "active") return "hold";
    if (row.physicalQty <= 0) return "depleted";
    if (row.daysToExpiry <= nearExpiryDays) return "near_expiry";
    return "active";
  }

  private mapBatchRow(
    row: {
      id: string;
      medicineId: string;
      medicineName: string;
      medicineSku: string;
      companyName: string | null;
      batchNumber: string;
      manufacturingDate: string | null;
      expiryDate: string;
      warehouseId: string | null;
      warehouseName: string | null;
      quantity: number;
      reservedQuantity: number;
      damagedQuantity: number;
      quarantineQuantity: number;
      blockedQuantity: number;
      physicalQty: number;
      purchaseRatePkr: number;
      saleRatePkr: number;
      valuePkr: number;
      status: string;
      holdReason: string | null;
      daysToExpiry: number;
      createdAt: Date;
    },
    nearExpiryDays: number,
  ): BatchRow {
    const physicalQty = Number(row.physicalQty ?? 0);
    const daysToExpiry = Number(row.daysToExpiry ?? 0);
    return {
      id: row.id,
      medicineId: row.medicineId,
      medicineName: row.medicineName,
      medicineSku: row.medicineSku,
      companyName: row.companyName ?? null,
      batchNumber: row.batchNumber,
      manufacturingDate: row.manufacturingDate ?? null,
      expiryDate: row.expiryDate,
      warehouseId: row.warehouseId ?? null,
      warehouseName: row.warehouseName ?? null,
      quantity: Number(row.quantity ?? 0),
      reservedQuantity: Number(row.reservedQuantity ?? 0),
      damagedQuantity: Number(row.damagedQuantity ?? 0),
      quarantineQuantity: Number(row.quarantineQuantity ?? 0),
      blockedQuantity: Number(row.blockedQuantity ?? 0),
      physicalQty,
      purchaseRatePkr: Number(row.purchaseRatePkr ?? 0),
      saleRatePkr: Number(row.saleRatePkr ?? 0),
      valuePkr: Number(row.valuePkr ?? 0),
      status: row.status,
      holdReason: row.holdReason ?? null,
      derivedStatus: this.derive({ status: row.status, daysToExpiry, physicalQty }, nearExpiryDays),
      daysToExpiry,
      createdAt: row.createdAt,
    };
  }

  /**
   * Legacy batches carry a NULL warehouse. Hiding them from a warehouse filter
   * would make real stock disappear, so they are always included.
   */
  private warehouseClause(warehouseId?: string | null): SQL | null {
    if (!warehouseId) return null;
    return sql`(${pharmacyMedicineBatches.warehouseId} = ${warehouseId} OR ${pharmacyMedicineBatches.warehouseId} IS NULL)`;
  }

  private scopeClauses(
    organizationId: string,
    branchId: string,
    opts: { warehouseId?: string | null; medicineId?: string | null; companyId?: string | null } = {},
  ): SQL[] {
    const clauses: SQL[] = [
      eq(pharmacyMedicines.organizationId, organizationId),
      eq(pharmacyMedicines.branchId, branchId),
    ];
    const wh = this.warehouseClause(opts.warehouseId);
    if (wh) clauses.push(wh);
    if (opts.medicineId) clauses.push(eq(pharmacyMedicineBatches.medicineId, opts.medicineId));
    if (opts.companyId) clauses.push(eq(pharmacyMedicines.companyId, opts.companyId));
    return clauses;
  }

  /**
   * Independent predicates, not the priority-ordered `derivedStatus`: filtering
   * by `expired` returns every expired batch even when it is also on hold.
   */
  private statusClause(status: string | undefined, nearExpiryDays: number): SQL | null {
    const s = (status ?? "all").trim().toLowerCase();
    if (!s || s === "all") return null;
    const active = sql`lower(coalesce(${pharmacyMedicineBatches.status}, 'active')) = 'active'`;
    switch (s) {
      case "expired":
        return sql`${pharmacyMedicineBatches.expiryDate} < current_date`;
      case "hold":
        return sql`lower(coalesce(${pharmacyMedicineBatches.status}, 'active')) <> 'active'`;
      case "zero":
        return sql`${this.physicalExpr()} <= 0`;
      case "near_expiry":
        return sql`${pharmacyMedicineBatches.expiryDate} >= current_date
          AND ${pharmacyMedicineBatches.expiryDate} <= current_date + ${sql.raw(String(nearExpiryDays))}`;
      case "active":
        return sql`${active}
          AND ${pharmacyMedicineBatches.expiryDate} >= current_date
          AND ${this.physicalExpr()} > 0`;
      default:
        throw new BadRequestException(
          "status must be one of active, hold, expired, near_expiry, zero, all",
        );
    }
  }

  private orderFor(sort?: string) {
    const s = (sort ?? "expiry_asc").trim().toLowerCase();
    if (!(BATCH_SORTS as readonly string[]).includes(s)) {
      throw new BadRequestException(`sort must be one of ${BATCH_SORTS.join(", ")}`);
    }
    switch (s) {
      case "expiry_desc":
        return [desc(pharmacyMedicineBatches.expiryDate), desc(pharmacyMedicineBatches.createdAt)];
      case "qty_desc":
        return [desc(pharmacyMedicineBatches.quantity), asc(pharmacyMedicineBatches.expiryDate)];
      case "medicine_asc":
        return [asc(pharmacyMedicines.name), asc(pharmacyMedicineBatches.expiryDate)];
      case "created_desc":
        return [desc(pharmacyMedicineBatches.createdAt)];
      default:
        return [asc(pharmacyMedicineBatches.expiryDate), asc(pharmacyMedicineBatches.createdAt)];
    }
  }

  /** Shared paginated batch query. Every caller goes through this. */
  private async queryBatchPage(input: {
    organizationId: string;
    branchId: string;
    nearExpiryDays: number;
    clauses: SQL[];
    q?: string;
    sort?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PageResult<BatchRow>> {
    const { page, pageSize, offset } = normalizePage(input.page, input.pageSize);
    const clauses = [...input.clauses];

    if (input.q?.trim()) {
      const term = `%${input.q.trim()}%`;
      const search = or(
        ilike(pharmacyMedicines.name, term),
        ilike(pharmacyMedicines.sku, term),
        ilike(pharmacyMedicineBatches.batchNumber, term),
      );
      if (search) clauses.push(search);
    }

    const where = and(...clauses);

    const rows = await this.db
      .select(this.batchSelect())
      .from(pharmacyMedicineBatches)
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyMedicineBatches.medicineId))
      .leftJoin(
        pharmacyCompanies,
        and(
          eq(pharmacyCompanies.id, pharmacyMedicines.companyId),
          eq(pharmacyCompanies.organizationId, input.organizationId),
        ),
      )
      .leftJoin(
        pharmacyWarehouses,
        and(
          eq(pharmacyWarehouses.id, pharmacyMedicineBatches.warehouseId),
          eq(pharmacyWarehouses.organizationId, input.organizationId),
        ),
      )
      .where(where)
      .orderBy(...this.orderFor(input.sort))
      .limit(pageSize)
      .offset(offset);

    const [totalRow] = await this.db
      .select({ value: count() })
      .from(pharmacyMedicineBatches)
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyMedicineBatches.medicineId))
      .where(where);

    return pageResult(
      rows.map((r) => this.mapBatchRow(r, input.nearExpiryDays)),
      Number(totalRow?.value ?? 0),
      page,
      pageSize,
    );
  }

  async listBatches(organizationId: string, filters: BatchListFilters): Promise<PageResult<BatchRow>> {
    const branch = await this.availability.resolveBranch(organizationId, filters.branchCode);
    const warehouse = await this.availability.resolveWarehouse(organizationId, branch.id, filters.warehouseId);
    const settings = await this.settings.getSettings(organizationId, branch.id);

    const clauses = this.scopeClauses(organizationId, branch.id, {
      warehouseId: warehouse?.id ?? null,
      medicineId: filters.medicineId,
      companyId: filters.companyId,
    });

    const statusClause = this.statusClause(filters.status, settings.nearExpiryDays);
    if (statusClause) clauses.push(statusClause);

    if (filters.expiringInDays !== undefined && filters.expiringInDays !== null) {
      const days = Math.floor(Number(filters.expiringInDays));
      if (!Number.isFinite(days) || days < 0) {
        throw new BadRequestException("expiringInDays must be a non-negative whole number");
      }
      clauses.push(
        sql`${pharmacyMedicineBatches.expiryDate} >= current_date
          AND ${pharmacyMedicineBatches.expiryDate} <= current_date + ${sql.raw(String(days))}`,
      );
    }

    return this.queryBatchPage({
      organizationId,
      branchId: branch.id,
      nearExpiryDays: settings.nearExpiryDays,
      clauses,
      q: filters.q,
      sort: filters.sort,
      page: filters.page,
      pageSize: filters.pageSize,
    });
  }

  private async fetchBatchRow(
    organizationId: string,
    branchId: string,
    batchId: string,
    nearExpiryDays: number,
  ): Promise<BatchRow> {
    const [row] = await this.db
      .select(this.batchSelect())
      .from(pharmacyMedicineBatches)
      // The join to medicines is the security boundary: a batch is only visible
      // when its medicine belongs to this organisation and branch.
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyMedicineBatches.medicineId))
      .leftJoin(
        pharmacyCompanies,
        and(
          eq(pharmacyCompanies.id, pharmacyMedicines.companyId),
          eq(pharmacyCompanies.organizationId, organizationId),
        ),
      )
      .leftJoin(
        pharmacyWarehouses,
        and(
          eq(pharmacyWarehouses.id, pharmacyMedicineBatches.warehouseId),
          eq(pharmacyWarehouses.organizationId, organizationId),
        ),
      )
      .where(
        and(
          eq(pharmacyMedicineBatches.id, batchId),
          eq(pharmacyMedicines.organizationId, organizationId),
          eq(pharmacyMedicines.branchId, branchId),
        ),
      )
      .limit(1);

    if (!row) throw new NotFoundException("Batch not found for this branch");
    return this.mapBatchRow(row, nearExpiryDays);
  }

  async getBatchDetail(organizationId: string, batchId: string, branchCode: string): Promise<BatchDetail> {
    const branch = await this.availability.resolveBranch(organizationId, branchCode);
    const settings = await this.settings.getSettings(organizationId, branch.id);
    const batch = await this.fetchBatchRow(organizationId, branch.id, batchId, settings.nearExpiryDays);

    const [raw] = await this.db
      .select({
        supplierId: pharmacyMedicineBatches.supplierId,
        grnId: pharmacyMedicineBatches.grnId,
      })
      .from(pharmacyMedicineBatches)
      .where(eq(pharmacyMedicineBatches.id, batchId))
      .limit(1);

    const movementsPage = await this.ledger.listMovements(
      organizationId,
      { batchId, pageSize: 50 },
      branch.id,
    );

    const reservations = await this.db
      .select({
        id: pharmacyStockReservations.id,
        referenceType: pharmacyStockReservations.referenceType,
        referenceId: pharmacyStockReservations.referenceId,
        quantity: pharmacyStockReservations.quantity,
        status: pharmacyStockReservations.status,
        expiresAt: pharmacyStockReservations.expiresAt,
        createdAt: pharmacyStockReservations.createdAt,
      })
      .from(pharmacyStockReservations)
      .where(
        and(
          eq(pharmacyStockReservations.organizationId, organizationId),
          eq(pharmacyStockReservations.branchId, branch.id),
          eq(pharmacyStockReservations.batchId, batchId),
          eq(pharmacyStockReservations.status, "active"),
        ),
      )
      .orderBy(desc(pharmacyStockReservations.createdAt));

    let supplierName: string | null = null;
    if (raw?.supplierId) {
      const [supplier] = await this.db
        .select({ name: popsSuppliers.name })
        .from(popsSuppliers)
        .where(and(eq(popsSuppliers.id, raw.supplierId), eq(popsSuppliers.organizationId, organizationId)))
        .limit(1);
      supplierName = supplier?.name ?? null;
    }

    let grnNumber: string | null = null;
    if (raw?.grnId) {
      const [grn] = await this.db
        .select({ grnNumber: pharmacyGrns.grnNumber })
        .from(pharmacyGrns)
        .where(and(eq(pharmacyGrns.id, raw.grnId), eq(pharmacyGrns.organizationId, organizationId)))
        .limit(1);
      grnNumber = grn?.grnNumber ?? null;
    }

    // Recall preparation: distribution invoice lines carry the batch id, so the
    // customers who received this exact batch can be listed without guessing.
    const soldRows = await this.db
      .select({
        invoiceId: pharmacyDistInvoices.id,
        invoiceNumber: pharmacyDistInvoices.invoiceNumber,
        invoiceDate: pharmacyDistInvoices.invoiceDate,
        customerId: pharmacyTradeCustomers.id,
        customerName: pharmacyTradeCustomers.name,
        quantity: pharmacyDistInvoiceLines.quantity,
      })
      .from(pharmacyDistInvoiceLines)
      .innerJoin(pharmacyDistInvoices, eq(pharmacyDistInvoices.id, pharmacyDistInvoiceLines.invoiceId))
      .leftJoin(
        pharmacyTradeCustomers,
        eq(pharmacyTradeCustomers.id, pharmacyDistInvoices.tradeCustomerId),
      )
      .where(
        and(
          eq(pharmacyDistInvoiceLines.batchId, batchId),
          eq(pharmacyDistInvoices.organizationId, organizationId),
          eq(pharmacyDistInvoices.branchId, branch.id),
        ),
      )
      .orderBy(desc(pharmacyDistInvoices.invoiceDate))
      .limit(100);

    return {
      ...batch,
      movements: movementsPage.items,
      reservations: reservations.map((r) => ({
        id: r.id,
        referenceType: r.referenceType,
        referenceId: r.referenceId,
        quantity: Number(r.quantity ?? 0),
        status: r.status,
        expiresAt: r.expiresAt ?? null,
        createdAt: r.createdAt,
      })),
      traceability: {
        supplierId: raw?.supplierId ?? null,
        supplierName,
        grnId: raw?.grnId ?? null,
        grnNumber,
        receivedAt: batch.createdAt,
        soldToCustomers: soldRows.map((r) => ({
          invoiceId: r.invoiceId,
          invoiceNumber: r.invoiceNumber,
          invoiceDate: r.invoiceDate,
          customerId: r.customerId ?? null,
          customerName: r.customerName ?? null,
          quantity: Number(r.quantity ?? 0),
        })),
      },
    };
  }

  /**
   * Flags a batch only. Quantities stay exactly where they are — moving units
   * between buckets is StockAdjustmentService's job, and doing it here would
   * change stock without an adjustment document.
   */
  async setBatchHold(
    organizationId: string,
    batchId: string,
    input: { branchCode: string; status: string; reason?: string },
    userId?: string,
  ): Promise<BatchRow> {
    const status = (input.status ?? "").trim().toLowerCase();
    if (!HOLD_STATUSES.includes(status)) {
      throw new BadRequestException(`status must be one of ${HOLD_STATUSES.join(", ")}`);
    }

    const branch = await this.availability.resolveBranch(organizationId, input.branchCode);
    const settings = await this.settings.getSettings(organizationId, branch.id);
    const before = await this.fetchBatchRow(organizationId, branch.id, batchId, settings.nearExpiryDays);

    const reason = input.reason?.trim() || null;

    await this.db
      .update(pharmacyMedicineBatches)
      .set({ status, holdReason: status === "active" ? null : reason })
      .where(eq(pharmacyMedicineBatches.id, batchId));

    const after = await this.fetchBatchRow(organizationId, branch.id, batchId, settings.nearExpiryDays);

    await this.db.insert(pharmacyAuditLogs).values({
      organizationId,
      branchId: branch.id,
      userId: userId ?? null,
      action: "batch.hold",
      entityType: "pharmacy_batch",
      entityId: batchId,
      oldValueJson: JSON.stringify({ status: before.status, holdReason: before.holdReason }),
      newValueJson: JSON.stringify({ status: after.status, holdReason: after.holdReason }),
      reason,
    });

    return after;
  }

  /** Bucket boundaries come from settings and are never hardcoded. */
  private buildBuckets(days: number[]): { label: string; fromDays: number; toDays: number | null }[] {
    const cleaned = Array.from(
      new Set(days.map((d) => Math.floor(Number(d))).filter((d) => Number.isFinite(d) && d > 0)),
    ).sort((a, b) => a - b);
    const sorted = cleaned.length ? cleaned : DEFAULT_INVENTORY_SETTINGS.expiryBuckets;
    const out = sorted.map((to, i) => ({
      label: `${i === 0 ? 0 : sorted[i - 1] + 1}-${to} days`,
      fromDays: i === 0 ? 0 : sorted[i - 1] + 1,
      toDays: to as number | null,
    }));
    const last = sorted[sorted.length - 1];
    out.push({ label: `>${last} days`, fromDays: last + 1, toDays: null });
    return out;
  }

  async expiryBuckets(
    organizationId: string,
    filters: { branchCode: string; warehouseId?: string; companyId?: string },
  ): Promise<ExpiryBucketsResult> {
    const branch = await this.availability.resolveBranch(organizationId, filters.branchCode);
    const warehouse = await this.availability.resolveWarehouse(organizationId, branch.id, filters.warehouseId);
    const settings = await this.settings.getSettings(organizationId, branch.id);

    const buckets = this.buildBuckets(settings.expiryBuckets);
    const where = and(
      ...this.scopeClauses(organizationId, branch.id, {
        warehouseId: warehouse?.id ?? null,
        companyId: filters.companyId,
      }),
    );

    // -1 is the expired bucket; the final index is the open-ended bucket.
    const chunks: SQL[] = [sql`case when ${pharmacyMedicineBatches.expiryDate} < current_date then -1`];
    buckets.forEach((b, i) => {
      if (b.toDays === null) return;
      chunks.push(
        sql` when (${pharmacyMedicineBatches.expiryDate} - current_date) <= ${sql.raw(String(b.toDays))} then ${sql.raw(String(i))}`,
      );
    });
    chunks.push(sql` else ${sql.raw(String(buckets.length - 1))} end`);
    const bucketExpr = sql.join(chunks, sql``);

    const rows = await this.db
      .select({
        bucketIndex: sql<number>`${bucketExpr}`,
        batchCount: count(),
        quantity: sql<number>`coalesce(sum(${pharmacyMedicineBatches.quantity}), 0)`,
        valuePkr: sql<number>`coalesce(sum(${pharmacyMedicineBatches.quantity} * ${pharmacyMedicineBatches.purchaseRatePkr}), 0)`,
      })
      .from(pharmacyMedicineBatches)
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyMedicineBatches.medicineId))
      .where(where)
      .groupBy(bucketExpr);

    const byIndex = new Map(rows.map((r) => [Number(r.bucketIndex), r]));

    const [nearRow] = await this.db
      .select({
        valuePkr: sql<number>`coalesce(sum(${pharmacyMedicineBatches.quantity} * ${pharmacyMedicineBatches.purchaseRatePkr}), 0)`,
      })
      .from(pharmacyMedicineBatches)
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyMedicineBatches.medicineId))
      .where(
        and(
          where,
          sql`${pharmacyMedicineBatches.expiryDate} >= current_date`,
          sql`${pharmacyMedicineBatches.expiryDate} <= current_date + ${sql.raw(String(settings.nearExpiryDays))}`,
        ),
      );

    const expired = byIndex.get(-1);
    return {
      buckets: buckets.map((b, i) => {
        const hit = byIndex.get(i);
        return {
          label: b.label,
          fromDays: b.fromDays,
          toDays: b.toDays,
          batchCount: Number(hit?.batchCount ?? 0),
          quantity: Number(hit?.quantity ?? 0),
          valuePkr: Number(hit?.valuePkr ?? 0),
        };
      }),
      expired: {
        batchCount: Number(expired?.batchCount ?? 0),
        quantity: Number(expired?.quantity ?? 0),
        valuePkr: Number(expired?.valuePkr ?? 0),
      },
      totalNearExpiryValuePkr: Number(nearRow?.valuePkr ?? 0),
    };
  }

  async listExpiringBatches(
    organizationId: string,
    filters: {
      branchCode: string;
      warehouseId?: string;
      bucket?: string;
      includeExpired?: boolean;
      page?: number;
      pageSize?: number;
    },
  ): Promise<PageResult<BatchRow>> {
    const branch = await this.availability.resolveBranch(organizationId, filters.branchCode);
    const warehouse = await this.availability.resolveWarehouse(organizationId, branch.id, filters.warehouseId);
    const settings = await this.settings.getSettings(organizationId, branch.id);

    const clauses = this.scopeClauses(organizationId, branch.id, { warehouseId: warehouse?.id ?? null });
    const bucketKey = filters.bucket?.trim().toLowerCase();

    if (bucketKey === "expired") {
      clauses.push(sql`${pharmacyMedicineBatches.expiryDate} < current_date`);
    } else if (bucketKey) {
      const buckets = this.buildBuckets(settings.expiryBuckets);
      const hit = buckets.find(
        (b) => b.label.toLowerCase() === bucketKey || (b.toDays !== null && String(b.toDays) === bucketKey),
      );
      if (!hit) {
        throw new BadRequestException(
          `bucket must be "expired" or one of: ${buckets.map((b) => b.label).join(", ")}`,
        );
      }
      clauses.push(
        sql`(${pharmacyMedicineBatches.expiryDate} - current_date) >= ${sql.raw(String(hit.fromDays))}`,
      );
      if (hit.toDays !== null) {
        clauses.push(
          sql`(${pharmacyMedicineBatches.expiryDate} - current_date) <= ${sql.raw(String(hit.toDays))}`,
        );
      }
    } else {
      clauses.push(
        sql`${pharmacyMedicineBatches.expiryDate} <= current_date + ${sql.raw(String(settings.nearExpiryDays))}`,
      );
      if (!filters.includeExpired) {
        clauses.push(sql`${pharmacyMedicineBatches.expiryDate} >= current_date`);
      }
    }

    clauses.push(sql`${this.physicalExpr()} > 0`);

    return this.queryBatchPage({
      organizationId,
      branchId: branch.id,
      nearExpiryDays: settings.nearExpiryDays,
      clauses,
      sort: "expiry_asc",
      page: filters.page,
      pageSize: filters.pageSize,
    });
  }
}
