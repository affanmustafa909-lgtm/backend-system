import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { and, count, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import {
  pharmacyMedicineBatches,
  pharmacyMedicines,
  pharmacyStockMovements,
  pharmacyWarehouses,
  users,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import type { StockTx } from "../pharmacy-stock.engine";

/**
 * An unparseable date reaches the driver as `Invalid Date` and surfaces as a
 * raw 500, so reject it here with a message the caller can act on.
 */
function boundary(value: string, field: "from" | "to", time: string): Date {
  const parsed = new Date(`${value}T${time}Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`Invalid \`${field}\` date "${value}". Expected YYYY-MM-DD.`);
  }
  return parsed;
}

/**
 * Canonical Phase 4 movement types. The ledger is append-only: a mistake is
 * corrected with a REVERSAL row, never by editing history.
 */
export const MOVEMENT_TYPES = {
  OPENING_STOCK: "OPENING_STOCK",
  PURCHASE: "PURCHASE",
  GRN: "GRN",
  SALE: "SALE",
  SALES_RETURN: "SALES_RETURN",
  PURCHASE_RETURN: "PURCHASE_RETURN",
  TRANSFER_OUT: "TRANSFER_OUT",
  TRANSFER_IN: "TRANSFER_IN",
  ADJUSTMENT_IN: "ADJUSTMENT_IN",
  ADJUSTMENT_OUT: "ADJUSTMENT_OUT",
  DAMAGE: "DAMAGE",
  EXPIRY: "EXPIRY",
  STOCK_COUNT: "STOCK_COUNT",
  RESERVATION: "RESERVATION",
  RELEASE: "RELEASE",
  REVERSAL: "REVERSAL",
} as const;

export type MovementType = (typeof MOVEMENT_TYPES)[keyof typeof MOVEMENT_TYPES];

export const MOVEMENT_TYPE_LIST: MovementType[] = Object.values(MOVEMENT_TYPES);

/**
 * Historical rows were written with lower-case legacy types before Phase 4.
 * They are read through this map and never rewritten in place.
 */
const LEGACY_TYPE_MAP: Record<string, MovementType> = {
  grn_in: MOVEMENT_TYPES.GRN,
  sale_out: MOVEMENT_TYPES.SALE,
  return_in: MOVEMENT_TYPES.SALES_RETURN,
  transfer_out: MOVEMENT_TYPES.TRANSFER_OUT,
  transfer_in: MOVEMENT_TYPES.TRANSFER_IN,
  adjustment_in: MOVEMENT_TYPES.ADJUSTMENT_IN,
  adjustment_out: MOVEMENT_TYPES.ADJUSTMENT_OUT,
  opening_stock: MOVEMENT_TYPES.OPENING_STOCK,
};

export function normalizeMovementType(raw: string | null | undefined): string {
  if (!raw) return "UNKNOWN";
  const upper = raw.toUpperCase();
  if ((MOVEMENT_TYPE_LIST as string[]).includes(upper)) return upper;
  return LEGACY_TYPE_MAP[raw.toLowerCase()] ?? upper;
}

/**
 * When a legacy row is ambiguous the sign of quantityDelta is authoritative.
 * A `sale_out` row that actually recorded a purchase return still reduced stock,
 * so the direction is always correct even when the label was not.
 */
export function movementDirection(quantityDelta: number): "in" | "out" | "none" {
  if (quantityDelta > 0) return "in";
  if (quantityDelta < 0) return "out";
  return "none";
}

export type StockState = "available" | "reserved" | "damaged" | "quarantine" | "blocked";

export type LedgerAppendInput = {
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
  referenceType?: string | null;
  referenceId?: string | null;
  idempotencyKey?: string | null;
  reversesMovementId?: string | null;
  notes?: string | null;
  createdByUserId?: string | null;
};

export type LedgerFilters = {
  branchCode?: string;
  branchId?: string;
  warehouseId?: string;
  medicineId?: string;
  batchId?: string;
  movementType?: string;
  referenceType?: string;
  referenceId?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  pageSize?: number;
};

@Injectable()
export class StockLedgerService {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  /**
   * The only sanctioned way to write the ledger. Value is captured at movement
   * time so historical valuation never drifts when prices change later.
   */
  async append(tx: StockTx, input: LedgerAppendInput): Promise<string | null> {
    const unitCost = Math.max(0, Math.round(input.unitCostPkr ?? 0));
    const [row] = await tx
      .insert(pharmacyStockMovements)
      .values({
        organizationId: input.organizationId,
        branchId: input.branchId,
        warehouseId: input.warehouseId ?? null,
        medicineId: input.medicineId,
        batchId: input.batchId ?? null,
        movementType: input.movementType,
        quantityDelta: input.quantityDelta,
        quantityAfter: input.quantityAfter,
        stockState: input.stockState ?? "available",
        unitCostPkr: unitCost,
        valuePkr: Math.round(Math.abs(input.quantityDelta) * unitCost),
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        reversesMovementId: input.reversesMovementId ?? null,
        notes: input.notes ?? null,
        createdByUserId: input.createdByUserId ?? null,
      })
      .returning({ id: pharmacyStockMovements.id });
    return row?.id ?? null;
  }

  /**
   * True when a posting with this idempotency key already landed. Callers use
   * this to short-circuit a retry instead of double-posting stock.
   */
  async hasPosted(organizationId: string, idempotencyKey: string, tx: StockTx = this.db) {
    const [row] = await tx
      .select({ id: pharmacyStockMovements.id })
      .from(pharmacyStockMovements)
      .where(
        and(
          eq(pharmacyStockMovements.organizationId, organizationId),
          eq(pharmacyStockMovements.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  private buildWhere(organizationId: string, filters: LedgerFilters, branchId?: string) {
    const clauses: SQL[] = [eq(pharmacyStockMovements.organizationId, organizationId)];
    if (branchId) clauses.push(eq(pharmacyStockMovements.branchId, branchId));
    if (filters.warehouseId) clauses.push(eq(pharmacyStockMovements.warehouseId, filters.warehouseId));
    if (filters.medicineId) clauses.push(eq(pharmacyStockMovements.medicineId, filters.medicineId));
    if (filters.batchId) clauses.push(eq(pharmacyStockMovements.batchId, filters.batchId));
    if (filters.referenceType) clauses.push(eq(pharmacyStockMovements.referenceType, filters.referenceType));
    if (filters.referenceId) clauses.push(eq(pharmacyStockMovements.referenceId, filters.referenceId));
    if (filters.from) clauses.push(gte(pharmacyStockMovements.createdAt, boundary(filters.from, "from", "00:00:00.000")));
    if (filters.to) clauses.push(lte(pharmacyStockMovements.createdAt, boundary(filters.to, "to", "23:59:59.999")));

    if (filters.movementType) {
      // Match the canonical type and every legacy alias that maps onto it, so a
      // filter for SALE also returns pre-Phase-4 `sale_out` history.
      const canonical = normalizeMovementType(filters.movementType);
      const aliases = Object.entries(LEGACY_TYPE_MAP)
        .filter(([, v]) => v === canonical)
        .map(([k]) => k);
      const wanted = Array.from(new Set([canonical, canonical.toLowerCase(), ...aliases]));
      clauses.push(inArray(pharmacyStockMovements.movementType, wanted));
    }

    if (filters.q?.trim()) {
      const term = `%${filters.q.trim()}%`;
      const search = or(
        ilike(pharmacyMedicines.name, term),
        ilike(pharmacyMedicines.sku, term),
        ilike(pharmacyMedicineBatches.batchNumber, term),
        ilike(pharmacyStockMovements.referenceId, term),
      );
      if (search) clauses.push(search);
    }

    return and(...clauses);
  }

  /** Stock movement register. Always paginated and searched server-side. */
  async listMovements(organizationId: string, filters: LedgerFilters, branchId?: string) {
    const page = Math.max(1, Math.floor(Number(filters.page) || 1));
    const pageSize = Math.min(200, Math.max(1, Math.floor(Number(filters.pageSize) || 50)));
    const where = this.buildWhere(organizationId, filters, branchId);

    const rows = await this.db
      .select({
        id: pharmacyStockMovements.id,
        createdAt: pharmacyStockMovements.createdAt,
        movementType: pharmacyStockMovements.movementType,
        stockState: pharmacyStockMovements.stockState,
        quantityDelta: pharmacyStockMovements.quantityDelta,
        quantityAfter: pharmacyStockMovements.quantityAfter,
        unitCostPkr: pharmacyStockMovements.unitCostPkr,
        valuePkr: pharmacyStockMovements.valuePkr,
        referenceType: pharmacyStockMovements.referenceType,
        referenceId: pharmacyStockMovements.referenceId,
        notes: pharmacyStockMovements.notes,
        reversesMovementId: pharmacyStockMovements.reversesMovementId,
        medicineId: pharmacyStockMovements.medicineId,
        medicineName: pharmacyMedicines.name,
        medicineSku: pharmacyMedicines.sku,
        batchId: pharmacyStockMovements.batchId,
        batchNumber: pharmacyMedicineBatches.batchNumber,
        expiryDate: pharmacyMedicineBatches.expiryDate,
        warehouseId: pharmacyStockMovements.warehouseId,
        warehouseName: pharmacyWarehouses.name,
        userName: users.name,
      })
      .from(pharmacyStockMovements)
      .leftJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyStockMovements.medicineId))
      .leftJoin(pharmacyMedicineBatches, eq(pharmacyMedicineBatches.id, pharmacyStockMovements.batchId))
      .leftJoin(pharmacyWarehouses, eq(pharmacyWarehouses.id, pharmacyStockMovements.warehouseId))
      .leftJoin(users, eq(users.id, pharmacyStockMovements.createdByUserId))
      .where(where)
      .orderBy(desc(pharmacyStockMovements.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const [totalRow] = await this.db
      .select({ value: count() })
      .from(pharmacyStockMovements)
      .leftJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyStockMovements.medicineId))
      .leftJoin(pharmacyMedicineBatches, eq(pharmacyMedicineBatches.id, pharmacyStockMovements.batchId))
      .where(where);
    const total = Number(totalRow?.value ?? 0);

    return {
      items: rows.map((r) => ({
        ...r,
        movementType: normalizeMovementType(r.movementType),
        rawMovementType: r.movementType,
        direction: movementDirection(r.quantityDelta),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** Totals in / out for the same filter set, for register footers. */
  async movementTotals(organizationId: string, filters: LedgerFilters, branchId?: string) {
    const where = this.buildWhere(organizationId, filters, branchId);
    const [row] = await this.db
      .select({
        qtyIn: sql<number>`coalesce(sum(case when ${pharmacyStockMovements.quantityDelta} > 0 then ${pharmacyStockMovements.quantityDelta} else 0 end), 0)`,
        qtyOut: sql<number>`coalesce(sum(case when ${pharmacyStockMovements.quantityDelta} < 0 then -${pharmacyStockMovements.quantityDelta} else 0 end), 0)`,
        valueIn: sql<number>`coalesce(sum(case when ${pharmacyStockMovements.quantityDelta} > 0 then ${pharmacyStockMovements.valuePkr} else 0 end), 0)`,
        valueOut: sql<number>`coalesce(sum(case when ${pharmacyStockMovements.quantityDelta} < 0 then ${pharmacyStockMovements.valuePkr} else 0 end), 0)`,
        rows: count(),
      })
      .from(pharmacyStockMovements)
      .leftJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyStockMovements.medicineId))
      .leftJoin(pharmacyMedicineBatches, eq(pharmacyMedicineBatches.id, pharmacyStockMovements.batchId))
      .where(where);

    return {
      quantityIn: Number(row?.qtyIn ?? 0),
      quantityOut: Number(row?.qtyOut ?? 0),
      netQuantity: Number(row?.qtyIn ?? 0) - Number(row?.qtyOut ?? 0),
      valueInPkr: Number(row?.valueIn ?? 0),
      valueOutPkr: Number(row?.valueOut ?? 0),
      rows: Number(row?.rows ?? 0),
    };
  }
}
