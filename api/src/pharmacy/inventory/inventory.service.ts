import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, count, countDistinct, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  pharmacyCompanies,
  pharmacyDistInvoiceLines,
  pharmacyDistInvoices,
  pharmacyGrnLines,
  pharmacyGrns,
  pharmacyMedicineBatches,
  pharmacyMedicines,
  pharmacyStockAdjustments,
  pharmacyStockMovements,
  pharmacyStockReservations,
  pharmacyStockTransfers,
  pharmacyTradeCustomers,
  pharmacyWarehouses,
  popsSuppliers,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import {
  BatchStockService,
  normalizePage,
  pageResult,
  type BatchRow,
  type ExpiryBucketsResult,
  type PageResult,
} from "./batch-stock.service";
import { InventorySettingsService } from "./inventory-settings.service";
import {
  InventoryValuationService,
  type ValuationReportRow,
  type ValuationSummary,
} from "./inventory-valuation.service";
import { StockAvailabilityService, type StockNumbers } from "./stock-availability.service";
import { MOVEMENT_TYPES, StockLedgerService } from "./stock-ledger.service";

export type { PageResult };

export type StockState = "ok" | "low" | "out" | "negative";

export type StockRow = {
  medicineId: string;
  sku: string;
  name: string;
  unit: string;
  companyId: string | null;
  companyName: string | null;
  rackLocation: string | null;
  physicalQty: number;
  availableQty: number;
  reservedQty: number;
  damagedQty: number;
  quarantineQty: number;
  blockedQty: number;
  expiredQty: number;
  nearExpiryQty: number;
  batchCount: number;
  valuePkr: number;
  reorderLevel: number;
  minStock: number;
  maxStock: number;
  stockState: StockState;
  earliestExpiry: string | null;
};

export type StockTotals = {
  skuCount: number;
  availableQty: number;
  physicalQty: number;
  valuePkr: number;
  lowCount: number;
  outCount: number;
  nearExpiryQty: number;
  expiredQty: number;
};

export type StockListFilters = {
  branchCode: string;
  warehouseId?: string;
  companyId?: string;
  q?: string;
  /** all | ok | low | out | negative | near_expiry | expired | has_hold */
  stockState?: string;
  page?: number;
  pageSize?: number;
  /** name_asc | qty_asc | qty_desc | value_desc | expiry_asc */
  sort?: string;
};

export type ProductWarehouseRow = {
  warehouseId: string | null;
  warehouseName: string;
  availableQty: number;
  physicalQty: number;
  batchCount: number;
  valuePkr: number;
};

export type PurchaseHistoryRow = {
  grnId: string;
  grnNumber: string;
  date: string;
  supplierName: string | null;
  batchNumber: string;
  quantity: number;
  unitCostPkr: number;
};

export type SalesHistoryRow = {
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  customerName: string | null;
  quantity: number;
  unitPricePkr: number;
};

type LedgerPage = Awaited<ReturnType<StockLedgerService["listMovements"]>>;
type LedgerRow = LedgerPage["items"][number];

export type ProductInventoryDetail = {
  medicine: {
    id: string;
    sku: string;
    name: string;
    unit: string;
    companyName: string | null;
    reorderLevel: number;
    minStock: number;
    maxStock: number;
    batchTrackingEnabled: boolean;
    expiryTrackingEnabled: boolean;
    fefoEnabled: boolean;
    rackLocation: string | null;
    shelfLocation: string | null;
    aisleLocation: string | null;
  };
  stock: StockNumbers;
  byWarehouse: ProductWarehouseRow[];
  batches: BatchRow[];
  recentMovements: LedgerRow[];
  purchaseHistory: PurchaseHistoryRow[];
  salesHistory: SalesHistoryRow[];
};

export type InventoryDashboard = {
  totals: StockNumbers;
  counts: {
    skuCount: number;
    batchCount: number;
    warehouseCount: number;
    lowStockCount: number;
    outOfStockCount: number;
    negativeStockCount: number;
    expiredBatchCount: number;
    nearExpiryBatchCount: number;
    holdBatchCount: number;
    activeReservationCount: number;
    pendingTransferCount: number;
    pendingAdjustmentCount: number;
  };
  valuation: ValuationSummary;
  expiry: ExpiryBucketsResult;
  topValueProducts: ValuationReportRow[];
  recentMovements: LedgerRow[];
};

export type ReorderRow = {
  medicineId: string;
  sku: string;
  name: string;
  unit: string;
  companyName: string | null;
  availableQty: number;
  reorderLevel: number;
  minStock: number;
  maxStock: number;
  avgDailySales: number;
  /** null when there is no consumption to divide by — never Infinity. */
  daysOfCover: number | null;
  suggestedQty: number;
  urgency: "critical" | "high" | "normal";
  reason: string;
};

export type SlowMovingRow = {
  medicineId: string;
  sku: string;
  name: string;
  availableQty: number;
  valuePkr: number;
  lastMovementAt: Date | null;
  daysSinceMovement: number | null;
  unitsSoldInPeriod: number;
};

export type StockAgingRow = {
  batchId: string;
  medicineId: string;
  sku: string;
  name: string;
  batchNumber: string;
  expiryDate: string;
  warehouseName: string | null;
  quantity: number;
  physicalQty: number;
  valuePkr: number;
  receivedAt: Date;
  ageDays: number;
  bucket: string;
};

export type StockAgingResult = {
  buckets: { label: string; batchCount: number; quantity: number; valuePkr: number }[];
  items: PageResult<StockAgingRow>;
};

export type ReconciliationRow = {
  medicineId: string;
  sku: string;
  name: string;
  cachedCurrentStock: number;
  batchSumQuantity: number;
  cacheDrift: number;
  ledgerNetQuantity: number;
  ledgerDrift: number;
  note: string;
};

export type ReconciliationResult = {
  checkedSkus: number;
  discrepancyCount: number;
  items: PageResult<ReconciliationRow>;
};

export type DataQualityCheck = {
  check: string;
  severity: "critical" | "warning" | "info";
  count: number;
  description: string;
  sampleIds: string[];
};

const STOCK_SORTS = ["name_asc", "qty_asc", "qty_desc", "value_desc", "expiry_asc"] as const;
const STOCK_STATES = ["all", "ok", "low", "out", "negative", "near_expiry", "expired", "has_hold"] as const;

/** Canonical plus legacy labels for stock leaving as a sale. */
const SALE_MOVEMENT_TYPES = [MOVEMENT_TYPES.SALE, "sale", "sale_out", "SALE_OUT"];

/** Age-of-stock buckets, measured from when the batch was received. */
const AGING_BUCKETS: { label: string; upTo: number | null }[] = [
  { label: "0-30 days", upTo: 30 },
  { label: "31-60 days", upTo: 60 },
  { label: "61-90 days", upTo: 90 },
  { label: "91-180 days", upTo: 180 },
  { label: "180+ days", upTo: null },
];

@Injectable()
export class InventoryService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly availability: StockAvailabilityService,
    private readonly settings: InventorySettingsService,
    private readonly batches: BatchStockService,
    private readonly valuation: InventoryValuationService,
    private readonly ledger: StockLedgerService,
  ) {}

  private async resolveScope(filters: { branchCode: string; warehouseId?: string }, organizationId: string) {
    const branch = await this.availability.resolveBranch(organizationId, filters.branchCode);
    const warehouse = await this.availability.resolveWarehouse(organizationId, branch.id, filters.warehouseId);
    const settings = await this.settings.getSettings(organizationId, branch.id);
    return { branch, warehouse, settings };
  }

  /**
   * Batch join condition. Legacy batches carry a NULL warehouse and stay visible
   * to every warehouse in the branch, otherwise real stock would vanish.
   */
  private batchJoinOn(warehouseId?: string | null): SQL {
    const base = eq(pharmacyMedicineBatches.medicineId, pharmacyMedicines.id);
    if (!warehouseId) return base;
    return and(
      base,
      sql`(${pharmacyMedicineBatches.warehouseId} = ${warehouseId} OR ${pharmacyMedicineBatches.warehouseId} IS NULL)`,
    ) as SQL;
  }

  private medicineClauses(
    organizationId: string,
    branchId: string,
    filters: { companyId?: string; q?: string },
  ): SQL[] {
    const clauses: SQL[] = [
      eq(pharmacyMedicines.organizationId, organizationId),
      eq(pharmacyMedicines.branchId, branchId),
    ];
    if (filters.companyId) clauses.push(eq(pharmacyMedicines.companyId, filters.companyId));
    if (filters.q?.trim()) {
      const term = `%${filters.q.trim()}%`;
      const search = or(
        ilike(pharmacyMedicines.name, term),
        ilike(pharmacyMedicines.sku, term),
        ilike(pharmacyMedicines.genericName, term),
        ilike(pharmacyMedicines.barcode, term),
      );
      if (search) clauses.push(search);
    }
    return clauses;
  }

  private classify(availableQty: number, reorderLevel: number, minStock: number): StockState {
    if (availableQty < 0) return "negative";
    if (availableQty === 0) return "out";
    const threshold = Math.max(reorderLevel, minStock);
    if (threshold > 0 && availableQty <= threshold) return "low";
    return "ok";
  }

  /** `stockState` is an aggregate condition, so it is applied with HAVING. */
  private stockStateHaving(
    stockState: string | undefined,
    expr: ReturnType<StockAvailabilityService["stockExpressions"]>,
  ): SQL {
    const s = (stockState ?? "all").trim().toLowerCase() || "all";
    if (!(STOCK_STATES as readonly string[]).includes(s)) {
      throw new BadRequestException(`stockState must be one of ${STOCK_STATES.join(", ")}`);
    }
    const threshold = sql`greatest(${pharmacyMedicines.reorderLevel}, ${pharmacyMedicines.minStock})`;
    switch (s) {
      case "ok":
        return sql`${expr.availableQty} > 0 and (${threshold} <= 0 or ${expr.availableQty} > ${threshold})`;
      case "low":
        return sql`${expr.availableQty} > 0 and ${threshold} > 0 and ${expr.availableQty} <= ${threshold}`;
      case "out":
        return sql`${expr.availableQty} = 0`;
      case "negative":
        return sql`${expr.availableQty} < 0`;
      case "near_expiry":
        return sql`${expr.nearExpiryQty} > 0`;
      case "expired":
        return sql`${expr.expiredQty} > 0`;
      case "has_hold":
        return sql`(${expr.onHoldQty} > 0 or ${expr.blockedQty} > 0 or ${expr.quarantineQty} > 0)`;
      default:
        return sql`true`;
    }
  }

  private earliestExpiryExpr() {
    return sql<string | null>`min(case
      when lower(coalesce(${pharmacyMedicineBatches.status}, 'active')) = 'active'
        and ${pharmacyMedicineBatches.expiryDate} >= current_date
        and ${pharmacyMedicineBatches.quantity} > 0
      then ${pharmacyMedicineBatches.expiryDate} end)`;
  }

  async listStock(
    organizationId: string,
    filters: StockListFilters,
  ): Promise<PageResult<StockRow> & { totals: StockTotals }> {
    const { branch, warehouse, settings } = await this.resolveScope(filters, organizationId);
    const { page, pageSize, offset } = normalizePage(filters.page, filters.pageSize);
    const expr = this.availability.stockExpressions(settings.nearExpiryDays);

    const where = and(...this.medicineClauses(organizationId, branch.id, filters));
    const having = this.stockStateHaving(filters.stockState, expr);
    const joinOn = this.batchJoinOn(warehouse?.id ?? null);
    const earliestExpiry = this.earliestExpiryExpr();

    const sort = (filters.sort ?? "name_asc").trim().toLowerCase();
    if (!(STOCK_SORTS as readonly string[]).includes(sort)) {
      throw new BadRequestException(`sort must be one of ${STOCK_SORTS.join(", ")}`);
    }
    const orderBy =
      sort === "qty_asc"
        ? [asc(expr.availableQty), asc(pharmacyMedicines.name)]
        : sort === "qty_desc"
          ? [desc(expr.availableQty), asc(pharmacyMedicines.name)]
          : sort === "value_desc"
            ? [desc(expr.valuePkr), asc(pharmacyMedicines.name)]
            : sort === "expiry_asc"
              ? [sql`${earliestExpiry} asc nulls last`, asc(pharmacyMedicines.name)]
              : [asc(pharmacyMedicines.name)];

    const groupBy = [
      pharmacyMedicines.id,
      pharmacyMedicines.sku,
      pharmacyMedicines.name,
      pharmacyMedicines.unit,
      pharmacyMedicines.companyId,
      pharmacyCompanies.name,
      pharmacyMedicines.rackLocation,
      pharmacyMedicines.reorderLevel,
      pharmacyMedicines.minStock,
      pharmacyMedicines.maxStock,
    ];

    const rows = await this.db
      .select({
        medicineId: pharmacyMedicines.id,
        sku: pharmacyMedicines.sku,
        name: pharmacyMedicines.name,
        unit: pharmacyMedicines.unit,
        companyId: pharmacyMedicines.companyId,
        companyName: pharmacyCompanies.name,
        rackLocation: pharmacyMedicines.rackLocation,
        reorderLevel: pharmacyMedicines.reorderLevel,
        minStock: pharmacyMedicines.minStock,
        maxStock: pharmacyMedicines.maxStock,
        earliestExpiry,
        ...expr,
      })
      .from(pharmacyMedicines)
      .leftJoin(pharmacyMedicineBatches, joinOn)
      .leftJoin(
        pharmacyCompanies,
        and(
          eq(pharmacyCompanies.id, pharmacyMedicines.companyId),
          eq(pharmacyCompanies.organizationId, organizationId),
        ),
      )
      .where(where)
      .groupBy(...groupBy)
      .having(having)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset(offset);

    // Roll-up for the whole filter, not just this page. Aggregated from the same
    // grouped rows so the footer can never disagree with the list.
    const rollup = this.db
      .select({
        availableQty: expr.availableQty.as("available_qty"),
        physicalQty: expr.physicalQty.as("physical_qty"),
        valuePkr: expr.valuePkr.as("value_pkr"),
        nearExpiryQty: expr.nearExpiryQty.as("near_expiry_qty"),
        expiredQty: expr.expiredQty.as("expired_qty"),
        reorderLevel: pharmacyMedicines.reorderLevel,
        minStock: pharmacyMedicines.minStock,
      })
      .from(pharmacyMedicines)
      .leftJoin(pharmacyMedicineBatches, joinOn)
      .where(where)
      .groupBy(pharmacyMedicines.id, pharmacyMedicines.reorderLevel, pharmacyMedicines.minStock)
      .having(having)
      .as("stock_rollup");

    const [totalsRow] = await this.db
      .select({
        skuCount: count(),
        availableQty: sql<number>`coalesce(sum(${rollup.availableQty}), 0)`,
        physicalQty: sql<number>`coalesce(sum(${rollup.physicalQty}), 0)`,
        valuePkr: sql<number>`coalesce(sum(${rollup.valuePkr}), 0)`,
        nearExpiryQty: sql<number>`coalesce(sum(${rollup.nearExpiryQty}), 0)`,
        expiredQty: sql<number>`coalesce(sum(${rollup.expiredQty}), 0)`,
        lowCount: sql<number>`count(*) filter (where ${rollup.availableQty} > 0
          and greatest(${rollup.reorderLevel}, ${rollup.minStock}) > 0
          and ${rollup.availableQty} <= greatest(${rollup.reorderLevel}, ${rollup.minStock}))`,
        outCount: sql<number>`count(*) filter (where ${rollup.availableQty} <= 0)`,
      })
      .from(rollup);

    const totals: StockTotals = {
      skuCount: Number(totalsRow?.skuCount ?? 0),
      availableQty: Number(totalsRow?.availableQty ?? 0),
      physicalQty: Number(totalsRow?.physicalQty ?? 0),
      valuePkr: Number(totalsRow?.valuePkr ?? 0),
      lowCount: Number(totalsRow?.lowCount ?? 0),
      outCount: Number(totalsRow?.outCount ?? 0),
      nearExpiryQty: Number(totalsRow?.nearExpiryQty ?? 0),
      expiredQty: Number(totalsRow?.expiredQty ?? 0),
    };

    const items: StockRow[] = rows.map((r) => {
      const availableQty = Number(r.availableQty ?? 0);
      return {
        medicineId: r.medicineId,
        sku: r.sku,
        name: r.name,
        unit: r.unit,
        companyId: r.companyId ?? null,
        companyName: r.companyName ?? null,
        rackLocation: r.rackLocation ?? null,
        physicalQty: Number(r.physicalQty ?? 0),
        availableQty,
        reservedQty: Number(r.reservedQty ?? 0),
        damagedQty: Number(r.damagedQty ?? 0),
        quarantineQty: Number(r.quarantineQty ?? 0),
        blockedQty: Number(r.blockedQty ?? 0),
        expiredQty: Number(r.expiredQty ?? 0),
        nearExpiryQty: Number(r.nearExpiryQty ?? 0),
        batchCount: Number(r.batchCount ?? 0),
        valuePkr: Number(r.valuePkr ?? 0),
        reorderLevel: r.reorderLevel,
        minStock: r.minStock,
        maxStock: r.maxStock,
        stockState: this.classify(availableQty, r.reorderLevel, r.minStock),
        earliestExpiry: r.earliestExpiry ?? null,
      };
    });

    return { ...pageResult(items, totals.skuCount, page, pageSize), totals };
  }

  async getProductInventory(
    organizationId: string,
    medicineId: string,
    filters: { branchCode: string; warehouseId?: string },
  ): Promise<ProductInventoryDetail> {
    const { branch, warehouse, settings } = await this.resolveScope(filters, organizationId);

    const [medicine] = await this.db
      .select({
        id: pharmacyMedicines.id,
        sku: pharmacyMedicines.sku,
        name: pharmacyMedicines.name,
        unit: pharmacyMedicines.unit,
        companyName: pharmacyCompanies.name,
        reorderLevel: pharmacyMedicines.reorderLevel,
        minStock: pharmacyMedicines.minStock,
        maxStock: pharmacyMedicines.maxStock,
        batchTrackingEnabled: pharmacyMedicines.batchTrackingEnabled,
        expiryTrackingEnabled: pharmacyMedicines.expiryTrackingEnabled,
        fefoEnabled: pharmacyMedicines.fefoEnabled,
        rackLocation: pharmacyMedicines.rackLocation,
        shelfLocation: pharmacyMedicines.shelfLocation,
        aisleLocation: pharmacyMedicines.aisleLocation,
      })
      .from(pharmacyMedicines)
      .leftJoin(
        pharmacyCompanies,
        and(
          eq(pharmacyCompanies.id, pharmacyMedicines.companyId),
          eq(pharmacyCompanies.organizationId, organizationId),
        ),
      )
      .where(
        and(
          eq(pharmacyMedicines.id, medicineId),
          eq(pharmacyMedicines.organizationId, organizationId),
          eq(pharmacyMedicines.branchId, branch.id),
        ),
      )
      .limit(1);

    if (!medicine) throw new NotFoundException("Product not found in this branch");

    const [availability] = await this.availability.getAvailability({
      organizationId,
      branchId: branch.id,
      medicineIds: [medicineId],
      warehouseId: warehouse?.id ?? null,
      nearExpiryDays: settings.nearExpiryDays,
    });

    const stock: StockNumbers = {
      physicalQty: availability?.physicalQty ?? 0,
      availableQty: availability?.availableQty ?? 0,
      reservedQty: availability?.reservedQty ?? 0,
      damagedQty: availability?.damagedQty ?? 0,
      quarantineQty: availability?.quarantineQty ?? 0,
      blockedQty: availability?.blockedQty ?? 0,
      expiredQty: availability?.expiredQty ?? 0,
      onHoldQty: availability?.onHoldQty ?? 0,
      nearExpiryQty: availability?.nearExpiryQty ?? 0,
      batchCount: availability?.batchCount ?? 0,
      valuePkr: availability?.valuePkr ?? 0,
    };

    const expr = this.availability.stockExpressions(settings.nearExpiryDays);
    const warehouseClauses: SQL[] = [
      eq(pharmacyMedicines.organizationId, organizationId),
      eq(pharmacyMedicines.branchId, branch.id),
      eq(pharmacyMedicineBatches.medicineId, medicineId),
    ];
    if (warehouse?.id) {
      warehouseClauses.push(
        sql`(${pharmacyMedicineBatches.warehouseId} = ${warehouse.id} OR ${pharmacyMedicineBatches.warehouseId} IS NULL)`,
      );
    }

    const warehouseRows = await this.db
      .select({
        warehouseId: pharmacyMedicineBatches.warehouseId,
        warehouseName: pharmacyWarehouses.name,
        availableQty: expr.availableQty,
        physicalQty: expr.physicalQty,
        batchCount: expr.batchCount,
        valuePkr: expr.valuePkr,
      })
      .from(pharmacyMedicineBatches)
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyMedicineBatches.medicineId))
      .leftJoin(
        pharmacyWarehouses,
        and(
          eq(pharmacyWarehouses.id, pharmacyMedicineBatches.warehouseId),
          eq(pharmacyWarehouses.organizationId, organizationId),
        ),
      )
      .where(and(...warehouseClauses))
      .groupBy(pharmacyMedicineBatches.warehouseId, pharmacyWarehouses.name);

    const batchPage = await this.batches.listBatches(organizationId, {
      branchCode: filters.branchCode,
      warehouseId: filters.warehouseId,
      medicineId,
      status: "all",
      sort: "expiry_asc",
      page: 1,
      pageSize: 100,
    });

    const movements = await this.ledger.listMovements(
      organizationId,
      { medicineId, warehouseId: warehouse?.id, pageSize: 25 },
      branch.id,
    );

    const purchaseHistory = await this.db
      .select({
        grnId: pharmacyGrns.id,
        grnNumber: pharmacyGrns.grnNumber,
        date: pharmacyGrns.receivedDate,
        supplierName: popsSuppliers.name,
        batchNumber: pharmacyGrnLines.batchNumber,
        quantity: pharmacyGrnLines.quantity,
        unitCostPkr: pharmacyGrnLines.unitCostPkr,
      })
      .from(pharmacyGrnLines)
      .innerJoin(pharmacyGrns, eq(pharmacyGrns.id, pharmacyGrnLines.grnId))
      .leftJoin(popsSuppliers, eq(popsSuppliers.id, pharmacyGrns.supplierId))
      .where(
        and(
          eq(pharmacyGrnLines.medicineId, medicineId),
          eq(pharmacyGrns.organizationId, organizationId),
          eq(pharmacyGrns.branchId, branch.id),
        ),
      )
      .orderBy(desc(pharmacyGrns.receivedDate), desc(pharmacyGrns.createdAt))
      .limit(10);

    const salesHistory = await this.db
      .select({
        invoiceId: pharmacyDistInvoices.id,
        invoiceNumber: pharmacyDistInvoices.invoiceNumber,
        date: pharmacyDistInvoices.invoiceDate,
        customerName: pharmacyTradeCustomers.name,
        quantity: pharmacyDistInvoiceLines.quantity,
        unitPricePkr: pharmacyDistInvoiceLines.unitPricePkr,
      })
      .from(pharmacyDistInvoiceLines)
      .innerJoin(pharmacyDistInvoices, eq(pharmacyDistInvoices.id, pharmacyDistInvoiceLines.invoiceId))
      .leftJoin(pharmacyTradeCustomers, eq(pharmacyTradeCustomers.id, pharmacyDistInvoices.tradeCustomerId))
      .where(
        and(
          eq(pharmacyDistInvoiceLines.medicineId, medicineId),
          eq(pharmacyDistInvoices.organizationId, organizationId),
          eq(pharmacyDistInvoices.branchId, branch.id),
        ),
      )
      .orderBy(desc(pharmacyDistInvoices.invoiceDate), desc(pharmacyDistInvoices.createdAt))
      .limit(10);

    return {
      medicine: {
        id: medicine.id,
        sku: medicine.sku,
        name: medicine.name,
        unit: medicine.unit,
        companyName: medicine.companyName ?? null,
        reorderLevel: medicine.reorderLevel,
        minStock: medicine.minStock,
        maxStock: medicine.maxStock,
        batchTrackingEnabled: medicine.batchTrackingEnabled,
        expiryTrackingEnabled: medicine.expiryTrackingEnabled,
        fefoEnabled: medicine.fefoEnabled,
        rackLocation: medicine.rackLocation ?? null,
        shelfLocation: medicine.shelfLocation ?? null,
        aisleLocation: medicine.aisleLocation ?? null,
      },
      stock,
      byWarehouse: warehouseRows.map((r) => ({
        warehouseId: r.warehouseId ?? null,
        warehouseName: r.warehouseName ?? "Unassigned (legacy)",
        availableQty: Number(r.availableQty ?? 0),
        physicalQty: Number(r.physicalQty ?? 0),
        batchCount: Number(r.batchCount ?? 0),
        valuePkr: Number(r.valuePkr ?? 0),
      })),
      batches: batchPage.items,
      recentMovements: movements.items,
      purchaseHistory: purchaseHistory.map((r) => ({
        grnId: r.grnId,
        grnNumber: r.grnNumber,
        date: r.date,
        supplierName: r.supplierName ?? null,
        batchNumber: r.batchNumber,
        quantity: Number(r.quantity ?? 0),
        unitCostPkr: Number(r.unitCostPkr ?? 0),
      })),
      salesHistory: salesHistory.map((r) => ({
        invoiceId: r.invoiceId,
        invoiceNumber: r.invoiceNumber,
        date: r.date,
        customerName: r.customerName ?? null,
        quantity: Number(r.quantity ?? 0),
        unitPricePkr: Number(r.unitPricePkr ?? 0),
      })),
    };
  }

  async dashboard(
    organizationId: string,
    filters: { branchCode: string; warehouseId?: string },
  ): Promise<InventoryDashboard> {
    const { branch, warehouse, settings } = await this.resolveScope(filters, organizationId);
    const expr = this.availability.stockExpressions(settings.nearExpiryDays);
    const joinOn = this.batchJoinOn(warehouse?.id ?? null);
    const medicineWhere = and(
      eq(pharmacyMedicines.organizationId, organizationId),
      eq(pharmacyMedicines.branchId, branch.id),
    );

    const totals = await this.availability.branchTotals(organizationId, branch.id, warehouse?.id ?? null);

    const rollup = this.db
      .select({
        availableQty: expr.availableQty.as("available_qty"),
        reorderLevel: pharmacyMedicines.reorderLevel,
        minStock: pharmacyMedicines.minStock,
      })
      .from(pharmacyMedicines)
      .leftJoin(pharmacyMedicineBatches, joinOn)
      .where(medicineWhere)
      .groupBy(pharmacyMedicines.id, pharmacyMedicines.reorderLevel, pharmacyMedicines.minStock)
      .as("dashboard_rollup");

    const [skuRow] = await this.db
      .select({
        skuCount: count(),
        lowStockCount: sql<number>`count(*) filter (where ${rollup.availableQty} > 0
          and greatest(${rollup.reorderLevel}, ${rollup.minStock}) > 0
          and ${rollup.availableQty} <= greatest(${rollup.reorderLevel}, ${rollup.minStock}))`,
        outOfStockCount: sql<number>`count(*) filter (where ${rollup.availableQty} = 0)`,
        negativeStockCount: sql<number>`count(*) filter (where ${rollup.availableQty} < 0)`,
      })
      .from(rollup);

    const batchClauses: SQL[] = [medicineWhere as SQL];
    if (warehouse?.id) {
      batchClauses.push(
        sql`(${pharmacyMedicineBatches.warehouseId} = ${warehouse.id} OR ${pharmacyMedicineBatches.warehouseId} IS NULL)`,
      );
    }

    const [batchRow] = await this.db
      .select({
        batchCount: count(),
        expiredBatchCount: sql<number>`count(*) filter (where ${pharmacyMedicineBatches.expiryDate} < current_date)`,
        nearExpiryBatchCount: sql<number>`count(*) filter (where ${pharmacyMedicineBatches.expiryDate} >= current_date
          and ${pharmacyMedicineBatches.expiryDate} <= current_date + ${sql.raw(String(settings.nearExpiryDays))})`,
        holdBatchCount: sql<number>`count(*) filter (where lower(coalesce(${pharmacyMedicineBatches.status}, 'active')) <> 'active')`,
      })
      .from(pharmacyMedicineBatches)
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyMedicineBatches.medicineId))
      .where(and(...batchClauses));

    const [warehouseRow] = await this.db
      .select({ value: count() })
      .from(pharmacyWarehouses)
      .where(
        and(
          eq(pharmacyWarehouses.organizationId, organizationId),
          eq(pharmacyWarehouses.branchId, branch.id),
        ),
      );

    const [reservationRow] = await this.db
      .select({ value: count() })
      .from(pharmacyStockReservations)
      .where(
        and(
          eq(pharmacyStockReservations.organizationId, organizationId),
          eq(pharmacyStockReservations.branchId, branch.id),
          eq(pharmacyStockReservations.status, "active"),
        ),
      );

    // Transfers and adjustments are Phase 4 tables. On a database that has not
    // been migrated yet the dashboard must still render, so a missing relation
    // is reported as zero instead of failing the whole screen.
    const pendingTransferCount = await this.countOrZero(async () => {
      const [row] = await this.db
        .select({ value: count() })
        .from(pharmacyStockTransfers)
        .where(
          and(
            eq(pharmacyStockTransfers.organizationId, organizationId),
            eq(pharmacyStockTransfers.branchId, branch.id),
            inArray(pharmacyStockTransfers.status, ["submitted", "approved", "dispatched"]),
          ),
        );
      return Number(row?.value ?? 0);
    });

    const pendingAdjustmentCount = await this.countOrZero(async () => {
      const [row] = await this.db
        .select({ value: count() })
        .from(pharmacyStockAdjustments)
        .where(
          and(
            eq(pharmacyStockAdjustments.organizationId, organizationId),
            eq(pharmacyStockAdjustments.branchId, branch.id),
            eq(pharmacyStockAdjustments.status, "pending_approval"),
          ),
        );
      return Number(row?.value ?? 0);
    });

    const valuation = await this.valuation.valuationSummary(organizationId, {
      branchCode: filters.branchCode,
      warehouseId: filters.warehouseId,
    });
    const expiry = await this.batches.expiryBuckets(organizationId, {
      branchCode: filters.branchCode,
      warehouseId: filters.warehouseId,
    });
    const topValue = await this.valuation.valuationReport(organizationId, {
      branchCode: filters.branchCode,
      warehouseId: filters.warehouseId,
      page: 1,
      pageSize: 10,
    });
    const recent = await this.ledger.listMovements(
      organizationId,
      { warehouseId: warehouse?.id, pageSize: 10 },
      branch.id,
    );

    return {
      totals,
      counts: {
        skuCount: Number(skuRow?.skuCount ?? 0),
        batchCount: Number(batchRow?.batchCount ?? 0),
        warehouseCount: Number(warehouseRow?.value ?? 0),
        lowStockCount: Number(skuRow?.lowStockCount ?? 0),
        outOfStockCount: Number(skuRow?.outOfStockCount ?? 0),
        negativeStockCount: Number(skuRow?.negativeStockCount ?? 0),
        expiredBatchCount: Number(batchRow?.expiredBatchCount ?? 0),
        nearExpiryBatchCount: Number(batchRow?.nearExpiryBatchCount ?? 0),
        holdBatchCount: Number(batchRow?.holdBatchCount ?? 0),
        activeReservationCount: Number(reservationRow?.value ?? 0),
        pendingTransferCount,
        pendingAdjustmentCount,
      },
      valuation,
      expiry,
      topValueProducts: topValue.items,
      recentMovements: recent.items,
    };
  }

  private async countOrZero(run: () => Promise<number>): Promise<number> {
    try {
      return await run();
    } catch {
      return 0;
    }
  }

  /** Sale-direction units per medicine over a window, for consumption maths. */
  private salesSubquery(
    organizationId: string,
    branchId: string,
    warehouseId: string | null | undefined,
    days: number,
    alias: string,
  ) {
    const clauses: SQL[] = [
      eq(pharmacyStockMovements.organizationId, organizationId),
      eq(pharmacyStockMovements.branchId, branchId),
      inArray(pharmacyStockMovements.movementType, SALE_MOVEMENT_TYPES),
      sql`${pharmacyStockMovements.quantityDelta} < 0`,
      sql`${pharmacyStockMovements.createdAt} >= current_date - ${sql.raw(String(days))}`,
    ];
    if (warehouseId) clauses.push(eq(pharmacyStockMovements.warehouseId, warehouseId));
    return this.db
      .select({
        medicineId: pharmacyStockMovements.medicineId,
        soldUnits: sql<number>`coalesce(sum(-${pharmacyStockMovements.quantityDelta}), 0)`.as("sold_units"),
      })
      .from(pharmacyStockMovements)
      .where(and(...clauses))
      .groupBy(pharmacyStockMovements.medicineId)
      .as(alias);
  }

  async reorderSuggestions(
    organizationId: string,
    filters: {
      branchCode: string;
      warehouseId?: string;
      companyId?: string;
      page?: number;
      pageSize?: number;
    },
  ): Promise<PageResult<ReorderRow> & { formula: string }> {
    const { branch, warehouse, settings } = await this.resolveScope(filters, organizationId);
    const { page, pageSize, offset } = normalizePage(filters.page, filters.pageSize);
    const expr = this.availability.stockExpressions(settings.nearExpiryDays);
    const joinOn = this.batchJoinOn(warehouse?.id ?? null);
    const days = Math.max(1, settings.slowMovingDays);
    const leadTime = settings.reorderLeadTimeDays;
    const coverDays = settings.reorderLeadTimeDays + settings.reorderSafetyDays;

    const sales = this.salesSubquery(organizationId, branch.id, warehouse?.id, days, "reorder_sales");
    const soldUnitsExpr = sql<number>`coalesce(max(${sales.soldUnits}), 0)`;

    const where = and(
      ...this.medicineClauses(organizationId, branch.id, { companyId: filters.companyId }),
      eq(pharmacyMedicines.status, "active"),
    );

    const having =
      settings.reorderFormula === "min_max"
        ? sql`${expr.availableQty} <= ${pharmacyMedicines.minStock}`
        : settings.reorderFormula === "avg_consumption"
          ? sql`(ceil((${soldUnitsExpr})::numeric / ${sql.raw(String(days))} * ${sql.raw(String(coverDays))}) - ${expr.availableQty}) > 0`
          : sql`${expr.availableQty} <= ${pharmacyMedicines.reorderLevel}`;

    const formula =
      settings.reorderFormula === "min_max"
        ? "min_max: suggest when availableQty <= minStock; suggestedQty = maxStock - availableQty"
        : settings.reorderFormula === "avg_consumption"
          ? `avg_consumption: avgDailySales over last ${days} days x (leadTime ${settings.reorderLeadTimeDays} + safety ${settings.reorderSafetyDays} days) - availableQty`
          : "reorder_level: suggest when availableQty <= reorderLevel; suggestedQty = max(suggestedReorderQty, reorderLevel x 2 - availableQty)";

    const groupBy = [
      pharmacyMedicines.id,
      pharmacyMedicines.sku,
      pharmacyMedicines.name,
      pharmacyMedicines.unit,
      pharmacyCompanies.name,
      pharmacyMedicines.reorderLevel,
      pharmacyMedicines.minStock,
      pharmacyMedicines.maxStock,
      pharmacyMedicines.suggestedReorderQty,
    ];

    const rows = await this.db
      .select({
        medicineId: pharmacyMedicines.id,
        sku: pharmacyMedicines.sku,
        name: pharmacyMedicines.name,
        unit: pharmacyMedicines.unit,
        companyName: pharmacyCompanies.name,
        reorderLevel: pharmacyMedicines.reorderLevel,
        minStock: pharmacyMedicines.minStock,
        maxStock: pharmacyMedicines.maxStock,
        suggestedReorderQty: pharmacyMedicines.suggestedReorderQty,
        availableQty: expr.availableQty,
        soldUnits: soldUnitsExpr,
      })
      .from(pharmacyMedicines)
      .leftJoin(pharmacyMedicineBatches, joinOn)
      .leftJoin(sales, eq(sales.medicineId, pharmacyMedicines.id))
      .leftJoin(
        pharmacyCompanies,
        and(
          eq(pharmacyCompanies.id, pharmacyMedicines.companyId),
          eq(pharmacyCompanies.organizationId, organizationId),
        ),
      )
      .where(where)
      .groupBy(...groupBy)
      .having(having)
      .orderBy(asc(expr.availableQty), asc(pharmacyMedicines.name))
      .limit(pageSize)
      .offset(offset);

    const countSub = this.db
      .select({ medicineId: pharmacyMedicines.id })
      .from(pharmacyMedicines)
      .leftJoin(pharmacyMedicineBatches, joinOn)
      .leftJoin(sales, eq(sales.medicineId, pharmacyMedicines.id))
      .where(where)
      .groupBy(pharmacyMedicines.id, pharmacyMedicines.reorderLevel, pharmacyMedicines.minStock)
      .having(having)
      .as("reorder_count");
    const [totalRow] = await this.db.select({ value: count() }).from(countSub);

    const items: ReorderRow[] = rows.map((r) => {
      const availableQty = Number(r.availableQty ?? 0);
      const soldUnits = Number(r.soldUnits ?? 0);
      const avgDailySales = soldUnits > 0 ? Number((soldUnits / days).toFixed(4)) : 0;
      // Infinity is never returned: no consumption means cover is unknown, not endless.
      const daysOfCover =
        avgDailySales > 0 ? Number((availableQty / avgDailySales).toFixed(2)) : null;

      let suggestedQty = 0;
      if (settings.reorderFormula === "min_max") {
        suggestedQty = Math.max(r.maxStock - availableQty, 0);
      } else if (settings.reorderFormula === "avg_consumption") {
        suggestedQty = Math.max(Math.ceil(avgDailySales * coverDays) - availableQty, 0);
      } else {
        suggestedQty = Math.max(r.suggestedReorderQty, r.reorderLevel * 2 - availableQty, 0);
      }

      const urgency: ReorderRow["urgency"] =
        availableQty <= 0 ? "critical" : daysOfCover !== null && daysOfCover <= leadTime ? "high" : "normal";

      const reason =
        availableQty <= 0
          ? "Out of stock"
          : daysOfCover === null
            ? `No recorded sales in the last ${days} days, so days of cover cannot be calculated`
            : daysOfCover <= leadTime
              ? `About ${daysOfCover} days of cover left against a ${leadTime} day lead time`
              : settings.reorderFormula === "min_max"
                ? `Available ${availableQty} is at or below minimum stock ${r.minStock}`
                : `Available ${availableQty} is at or below reorder level ${r.reorderLevel}`;

      return {
        medicineId: r.medicineId,
        sku: r.sku,
        name: r.name,
        unit: r.unit,
        companyName: r.companyName ?? null,
        availableQty,
        reorderLevel: r.reorderLevel,
        minStock: r.minStock,
        maxStock: r.maxStock,
        avgDailySales,
        daysOfCover,
        suggestedQty,
        urgency,
        reason,
      };
    });

    return { ...pageResult(items, Number(totalRow?.value ?? 0), page, pageSize), formula };
  }

  async slowMoving(
    organizationId: string,
    filters: {
      branchCode: string;
      warehouseId?: string;
      days?: number;
      page?: number;
      pageSize?: number;
    },
  ): Promise<PageResult<SlowMovingRow>> {
    const { branch, warehouse, settings } = await this.resolveScope(filters, organizationId);
    const { page, pageSize, offset } = normalizePage(filters.page, filters.pageSize);
    const expr = this.availability.stockExpressions(settings.nearExpiryDays);
    const joinOn = this.batchJoinOn(warehouse?.id ?? null);

    const requested = filters.days === undefined ? settings.slowMovingDays : Math.floor(Number(filters.days));
    if (!Number.isFinite(requested) || requested < 1) {
      throw new BadRequestException("days must be a whole number of at least 1");
    }
    const days = requested;

    const outboundClauses: SQL[] = [
      eq(pharmacyStockMovements.organizationId, organizationId),
      eq(pharmacyStockMovements.branchId, branch.id),
      sql`${pharmacyStockMovements.quantityDelta} < 0`,
    ];
    if (warehouse?.id) outboundClauses.push(eq(pharmacyStockMovements.warehouseId, warehouse.id));

    const outbound = this.db
      .select({
        medicineId: pharmacyStockMovements.medicineId,
        lastMovementAt: sql<Date | null>`max(${pharmacyStockMovements.createdAt})`.as("last_movement_at"),
        soldInPeriod: sql<number>`coalesce(sum(case
          when ${pharmacyStockMovements.createdAt} >= current_date - ${sql.raw(String(days))}
          then -${pharmacyStockMovements.quantityDelta} else 0 end), 0)`.as("sold_in_period"),
      })
      .from(pharmacyStockMovements)
      .where(and(...outboundClauses))
      .groupBy(pharmacyStockMovements.medicineId)
      .as("outbound");

    const lastAtExpr = sql<Date | null>`max(${outbound.lastMovementAt})`;
    const soldExpr = sql<number>`coalesce(max(${outbound.soldInPeriod}), 0)`;
    const where = and(...this.medicineClauses(organizationId, branch.id, {}));
    const having = sql`${expr.availableQty} > 0
      and (${lastAtExpr} is null or ${lastAtExpr} < current_date - ${sql.raw(String(days))})`;

    const rows = await this.db
      .select({
        medicineId: pharmacyMedicines.id,
        sku: pharmacyMedicines.sku,
        name: pharmacyMedicines.name,
        availableQty: expr.availableQty,
        valuePkr: expr.valuePkr,
        lastMovementAt: lastAtExpr,
        soldInPeriod: soldExpr,
      })
      .from(pharmacyMedicines)
      .leftJoin(pharmacyMedicineBatches, joinOn)
      .leftJoin(outbound, eq(outbound.medicineId, pharmacyMedicines.id))
      .where(where)
      .groupBy(pharmacyMedicines.id, pharmacyMedicines.sku, pharmacyMedicines.name)
      .having(having)
      .orderBy(desc(expr.valuePkr), asc(pharmacyMedicines.name))
      .limit(pageSize)
      .offset(offset);

    const countSub = this.db
      .select({ medicineId: pharmacyMedicines.id })
      .from(pharmacyMedicines)
      .leftJoin(pharmacyMedicineBatches, joinOn)
      .leftJoin(outbound, eq(outbound.medicineId, pharmacyMedicines.id))
      .where(where)
      .groupBy(pharmacyMedicines.id)
      .having(having)
      .as("slow_moving_count");
    const [totalRow] = await this.db.select({ value: count() }).from(countSub);

    const now = Date.now();
    const items: SlowMovingRow[] = rows.map((r) => {
      const lastMovementAt = r.lastMovementAt ? new Date(r.lastMovementAt) : null;
      return {
        medicineId: r.medicineId,
        sku: r.sku,
        name: r.name,
        availableQty: Number(r.availableQty ?? 0),
        valuePkr: Number(r.valuePkr ?? 0),
        lastMovementAt,
        daysSinceMovement: lastMovementAt
          ? Math.floor((now - lastMovementAt.getTime()) / 86_400_000)
          : null,
        unitsSoldInPeriod: Number(r.soldInPeriod ?? 0),
      };
    });

    return pageResult(items, Number(totalRow?.value ?? 0), page, pageSize);
  }

  async stockAging(
    organizationId: string,
    filters: { branchCode: string; warehouseId?: string; page?: number; pageSize?: number },
  ): Promise<StockAgingResult> {
    const { branch, warehouse } = await this.resolveScope(filters, organizationId);
    const { page, pageSize, offset } = normalizePage(filters.page, filters.pageSize);

    const clauses: SQL[] = [
      eq(pharmacyMedicines.organizationId, organizationId),
      eq(pharmacyMedicines.branchId, branch.id),
      sql`${pharmacyMedicineBatches.quantity} > 0`,
    ];
    if (warehouse?.id) {
      clauses.push(
        sql`(${pharmacyMedicineBatches.warehouseId} = ${warehouse.id} OR ${pharmacyMedicineBatches.warehouseId} IS NULL)`,
      );
    }
    const where = and(...clauses);

    // Age is how long the stock has been held, measured from receipt.
    const ageExpr = sql<number>`(current_date - ${pharmacyMedicineBatches.createdAt}::date)`;
    const chunks: SQL[] = [sql`case`];
    AGING_BUCKETS.forEach((b, i) => {
      if (b.upTo === null) return;
      chunks.push(sql` when ${ageExpr} <= ${sql.raw(String(b.upTo))} then ${sql.raw(String(i))}`);
    });
    chunks.push(sql` else ${sql.raw(String(AGING_BUCKETS.length - 1))} end`);
    const bucketExpr = sql.join(chunks, sql``);

    const bucketRows = await this.db
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

    const byIndex = new Map(bucketRows.map((r) => [Number(r.bucketIndex), r]));

    const rows = await this.db
      .select({
        batchId: pharmacyMedicineBatches.id,
        medicineId: pharmacyMedicines.id,
        sku: pharmacyMedicines.sku,
        name: pharmacyMedicines.name,
        batchNumber: pharmacyMedicineBatches.batchNumber,
        expiryDate: pharmacyMedicineBatches.expiryDate,
        warehouseName: pharmacyWarehouses.name,
        quantity: pharmacyMedicineBatches.quantity,
        physicalQty: sql<number>`(
          ${pharmacyMedicineBatches.quantity}
          + ${pharmacyMedicineBatches.reservedQuantity}
          + ${pharmacyMedicineBatches.damagedQuantity}
          + ${pharmacyMedicineBatches.quarantineQuantity}
          + ${pharmacyMedicineBatches.blockedQuantity}
        )`,
        valuePkr: sql<number>`(${pharmacyMedicineBatches.quantity} * ${pharmacyMedicineBatches.purchaseRatePkr})`,
        receivedAt: pharmacyMedicineBatches.createdAt,
        ageDays: ageExpr,
        bucketIndex: sql<number>`${bucketExpr}`,
      })
      .from(pharmacyMedicineBatches)
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyMedicineBatches.medicineId))
      .leftJoin(
        pharmacyWarehouses,
        and(
          eq(pharmacyWarehouses.id, pharmacyMedicineBatches.warehouseId),
          eq(pharmacyWarehouses.organizationId, organizationId),
        ),
      )
      .where(where)
      .orderBy(asc(pharmacyMedicineBatches.createdAt))
      .limit(pageSize)
      .offset(offset);

    const [totalRow] = await this.db
      .select({ value: count() })
      .from(pharmacyMedicineBatches)
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyMedicineBatches.medicineId))
      .where(where);

    const items: StockAgingRow[] = rows.map((r) => ({
      batchId: r.batchId,
      medicineId: r.medicineId,
      sku: r.sku,
      name: r.name,
      batchNumber: r.batchNumber,
      expiryDate: r.expiryDate,
      warehouseName: r.warehouseName ?? null,
      quantity: Number(r.quantity ?? 0),
      physicalQty: Number(r.physicalQty ?? 0),
      valuePkr: Number(r.valuePkr ?? 0),
      receivedAt: r.receivedAt,
      ageDays: Number(r.ageDays ?? 0),
      bucket: AGING_BUCKETS[Number(r.bucketIndex ?? 0)]?.label ?? AGING_BUCKETS[AGING_BUCKETS.length - 1].label,
    }));

    return {
      buckets: AGING_BUCKETS.map((b, i) => {
        const hit = byIndex.get(i);
        return {
          label: b.label,
          batchCount: Number(hit?.batchCount ?? 0),
          quantity: Number(hit?.quantity ?? 0),
          valuePkr: Number(hit?.valuePkr ?? 0),
        };
      }),
      items: pageResult(items, Number(totalRow?.value ?? 0), page, pageSize),
    };
  }

  /**
   * READ-ONLY reconciliation. Discrepancies are reported, never silently
   * repaired: fixing a drift is a stock adjustment with an audit trail, not a
   * side effect of opening a report.
   */
  async reconcile(
    organizationId: string,
    filters: { branchCode: string; page?: number; pageSize?: number },
  ): Promise<ReconciliationResult> {
    const branch = await this.availability.resolveBranch(organizationId, filters.branchCode);
    const { page, pageSize, offset } = normalizePage(filters.page, filters.pageSize);

    const ledgerAgg = this.db
      .select({
        medicineId: pharmacyStockMovements.medicineId,
        netQuantity: sql<number>`coalesce(sum(${pharmacyStockMovements.quantityDelta}), 0)`.as("net_quantity"),
      })
      .from(pharmacyStockMovements)
      .where(
        and(
          eq(pharmacyStockMovements.organizationId, organizationId),
          eq(pharmacyStockMovements.branchId, branch.id),
        ),
      )
      .groupBy(pharmacyStockMovements.medicineId)
      .as("ledger_net");

    const batchSumExpr = sql<number>`coalesce(sum(${pharmacyMedicineBatches.quantity}), 0)`;
    const physicalSumExpr = sql<number>`coalesce(sum(
      ${pharmacyMedicineBatches.quantity}
      + ${pharmacyMedicineBatches.reservedQuantity}
      + ${pharmacyMedicineBatches.damagedQuantity}
      + ${pharmacyMedicineBatches.quarantineQuantity}
      + ${pharmacyMedicineBatches.blockedQuantity}
    ), 0)`;
    const ledgerNetExpr = sql<number>`coalesce(max(${ledgerAgg.netQuantity}), 0)`;

    const where = and(
      eq(pharmacyMedicines.organizationId, organizationId),
      eq(pharmacyMedicines.branchId, branch.id),
    );
    const having = sql`(${pharmacyMedicines.currentStock} - ${batchSumExpr}) <> 0
      or (${physicalSumExpr} - ${ledgerNetExpr}) <> 0`;

    const [checkedRow] = await this.db
      .select({ value: countDistinct(pharmacyMedicines.id) })
      .from(pharmacyMedicines)
      .where(where);

    const discrepancySub = this.db
      .select({ medicineId: pharmacyMedicines.id })
      .from(pharmacyMedicines)
      .leftJoin(pharmacyMedicineBatches, eq(pharmacyMedicineBatches.medicineId, pharmacyMedicines.id))
      .leftJoin(ledgerAgg, eq(ledgerAgg.medicineId, pharmacyMedicines.id))
      .where(where)
      .groupBy(pharmacyMedicines.id, pharmacyMedicines.currentStock)
      .having(having)
      .as("reconcile_discrepancies");
    const [discrepancyRow] = await this.db.select({ value: count() }).from(discrepancySub);

    // Only drifting products are listed; a clean product has nothing to report.
    const rows = await this.db
      .select({
        medicineId: pharmacyMedicines.id,
        sku: pharmacyMedicines.sku,
        name: pharmacyMedicines.name,
        cachedCurrentStock: pharmacyMedicines.currentStock,
        batchSumQuantity: batchSumExpr,
        physicalSumQuantity: physicalSumExpr,
        ledgerNetQuantity: ledgerNetExpr,
      })
      .from(pharmacyMedicines)
      .leftJoin(pharmacyMedicineBatches, eq(pharmacyMedicineBatches.medicineId, pharmacyMedicines.id))
      .leftJoin(ledgerAgg, eq(ledgerAgg.medicineId, pharmacyMedicines.id))
      .where(where)
      .groupBy(
        pharmacyMedicines.id,
        pharmacyMedicines.sku,
        pharmacyMedicines.name,
        pharmacyMedicines.currentStock,
      )
      .having(having)
      .orderBy(desc(sql`abs(${pharmacyMedicines.currentStock} - ${batchSumExpr})`), asc(pharmacyMedicines.name))
      .limit(pageSize)
      .offset(offset);

    const items: ReconciliationRow[] = rows.map((r) => {
      const cachedCurrentStock = Number(r.cachedCurrentStock ?? 0);
      const batchSumQuantity = Number(r.batchSumQuantity ?? 0);
      const physicalSumQuantity = Number(r.physicalSumQuantity ?? 0);
      const ledgerNetQuantity = Number(r.ledgerNetQuantity ?? 0);
      const cacheDrift = cachedCurrentStock - batchSumQuantity;
      const ledgerDrift = physicalSumQuantity - ledgerNetQuantity;
      const notes: string[] = [];
      if (cacheDrift !== 0) {
        notes.push(
          `currentStock cache is off by ${cacheDrift} against the sum of batch quantities`,
        );
      }
      if (ledgerDrift !== 0) {
        notes.push(
          `physical quantity is off by ${ledgerDrift} against the ledger net. Pre-Phase-4 opening stock was written without ledger rows, and a reservation posts a single reserved-state row, so a non-zero ledger drift is expected on legacy data and is not necessarily a bug`,
        );
      }
      return {
        medicineId: r.medicineId,
        sku: r.sku,
        name: r.name,
        cachedCurrentStock,
        batchSumQuantity,
        cacheDrift,
        ledgerNetQuantity,
        ledgerDrift,
        note: notes.join(". "),
      };
    });

    return {
      checkedSkus: Number(checkedRow?.value ?? 0),
      discrepancyCount: Number(discrepancyRow?.value ?? 0),
      items: pageResult(items, Number(discrepancyRow?.value ?? 0), page, pageSize),
    };
  }

  private async batchCheck(
    organizationId: string,
    branchId: string,
    condition: SQL,
  ): Promise<{ count: number; sampleIds: string[] }> {
    const where = and(
      eq(pharmacyMedicines.organizationId, organizationId),
      eq(pharmacyMedicines.branchId, branchId),
      condition,
    );
    const [row] = await this.db
      .select({ value: count() })
      .from(pharmacyMedicineBatches)
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyMedicineBatches.medicineId))
      .where(where);
    const samples = await this.db
      .select({ id: pharmacyMedicineBatches.id })
      .from(pharmacyMedicineBatches)
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyMedicineBatches.medicineId))
      .where(where)
      .limit(5);
    return { count: Number(row?.value ?? 0), sampleIds: samples.map((s) => s.id) };
  }

  private async medicineGroupCheck(
    organizationId: string,
    branchId: string,
    extra: SQL | null,
    having: SQL,
  ): Promise<{ count: number; sampleIds: string[] }> {
    const clauses: SQL[] = [
      eq(pharmacyMedicines.organizationId, organizationId),
      eq(pharmacyMedicines.branchId, branchId),
    ];
    if (extra) clauses.push(extra);
    const sub = this.db
      .select({ id: pharmacyMedicines.id })
      .from(pharmacyMedicines)
      .leftJoin(pharmacyMedicineBatches, eq(pharmacyMedicineBatches.medicineId, pharmacyMedicines.id))
      .where(and(...clauses))
      .groupBy(pharmacyMedicines.id, pharmacyMedicines.currentStock)
      .having(having)
      .as("medicine_check");
    const [row] = await this.db.select({ value: count() }).from(sub);
    const samples = await this.db.select({ id: sub.id }).from(sub).limit(5);
    return { count: Number(row?.value ?? 0), sampleIds: samples.map((s) => s.id) };
  }

  async dataQuality(
    organizationId: string,
    filters: { branchCode: string },
  ): Promise<DataQualityCheck[]> {
    const branch = await this.availability.resolveBranch(organizationId, filters.branchCode);

    const nullWarehouse = await this.batchCheck(
      organizationId,
      branch.id,
      sql`${pharmacyMedicineBatches.warehouseId} is null`,
    );
    const negativeQty = await this.batchCheck(
      organizationId,
      branch.id,
      sql`${pharmacyMedicineBatches.quantity} < 0`,
    );
    const expiredWithStock = await this.batchCheck(
      organizationId,
      branch.id,
      sql`${pharmacyMedicineBatches.expiryDate} < current_date and ${pharmacyMedicineBatches.quantity} > 0`,
    );
    const missingCost = await this.batchCheck(
      organizationId,
      branch.id,
      sql`${pharmacyMedicineBatches.purchaseRatePkr} = 0 and ${pharmacyMedicineBatches.quantity} > 0`,
    );
    const badDates = await this.batchCheck(
      organizationId,
      branch.id,
      sql`${pharmacyMedicineBatches.manufacturingDate} is not null
        and ${pharmacyMedicineBatches.expiryDate} < ${pharmacyMedicineBatches.manufacturingDate}`,
    );
    const syntheticBatches = await this.batchCheck(
      organizationId,
      branch.id,
      sql`${pharmacyMedicineBatches.batchNumber} like 'RESTORE-%'`,
    );

    const cacheDrift = await this.medicineGroupCheck(
      organizationId,
      branch.id,
      null,
      sql`${pharmacyMedicines.currentStock} <> coalesce(sum(${pharmacyMedicineBatches.quantity}), 0)`,
    );
    const trackedWithoutBatches = await this.medicineGroupCheck(
      organizationId,
      branch.id,
      and(
        eq(pharmacyMedicines.batchTrackingEnabled, true),
        sql`${pharmacyMedicines.currentStock} > 0`,
      ) as SQL,
      sql`count(${pharmacyMedicineBatches.id}) = 0`,
    );

    const staleReservationWhere = and(
      eq(pharmacyStockReservations.organizationId, organizationId),
      eq(pharmacyStockReservations.branchId, branch.id),
      eq(pharmacyStockReservations.status, "active"),
      sql`${pharmacyStockReservations.createdAt} < current_date - 7`,
    );
    const [staleReservationCount] = await this.db
      .select({ value: count() })
      .from(pharmacyStockReservations)
      .where(staleReservationWhere);
    const staleReservationSamples = await this.db
      .select({ id: pharmacyStockReservations.id })
      .from(pharmacyStockReservations)
      .where(staleReservationWhere)
      .limit(5);

    return [
      {
        check: "batch_missing_warehouse",
        severity: "warning",
        count: nullWarehouse.count,
        description:
          "Batches with no warehouse. These are pre-Phase-4 rows: they remain sellable from every warehouse in the branch, which makes per-warehouse stock approximate until they are assigned.",
        sampleIds: nullWarehouse.sampleIds,
      },
      {
        check: "batch_negative_quantity",
        severity: "critical",
        count: negativeQty.count,
        description: "Batches holding a negative available quantity, which cannot happen physically.",
        sampleIds: negativeQty.sampleIds,
      },
      {
        check: "expired_batch_with_stock",
        severity: "warning",
        count: expiredWithStock.count,
        description:
          "Expired batches that still hold stock. They are excluded from sale but still carry value until written off.",
        sampleIds: expiredWithStock.sampleIds,
      },
      {
        check: "batch_missing_cost",
        severity: "warning",
        count: missingCost.count,
        description:
          "Batches with stock but no purchase rate. Their value falls back to the product cost price, so valuation is less precise.",
        sampleIds: missingCost.sampleIds,
      },
      {
        check: "medicine_stock_cache_drift",
        severity: "warning",
        count: cacheDrift.count,
        description:
          "Products whose currentStock cache disagrees with the sum of their batch quantities. Batch quantities are authoritative.",
        sampleIds: cacheDrift.sampleIds,
      },
      {
        check: "tracked_product_without_batches",
        severity: "critical",
        count: trackedWithoutBatches.count,
        description:
          "Batch-tracked products that report stock but have no batches at all, so the stock cannot be allocated, valued, or traced.",
        sampleIds: trackedWithoutBatches.sampleIds,
      },
      {
        check: "batch_expiry_before_manufacture",
        severity: "warning",
        count: badDates.count,
        description: "Batches whose expiry date is earlier than their manufacturing date.",
        sampleIds: badDates.sampleIds,
      },
      {
        check: "synthetic_restore_batches",
        severity: "info",
        count: syntheticBatches.count,
        description:
          "Batches numbered RESTORE-% were generated by a data restore rather than a real goods receipt, so they have no supplier or GRN traceability.",
        sampleIds: syntheticBatches.sampleIds,
      },
      {
        check: "stale_active_reservations",
        severity: "info",
        count: Number(staleReservationCount?.value ?? 0),
        description:
          "Reservations still active after more than 7 days. They keep holding stock out of the available bucket.",
        sampleIds: staleReservationSamples.map((r) => r.id),
      },
    ];
  }
}
