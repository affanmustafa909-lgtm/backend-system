import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  pharmacyMedicineBatches,
  pharmacyMedicines,
  pharmacyWarehouses,
  popsBranches,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { FefoService, type FefoAllocation } from "./fefo.service";
import { InventorySettingsService } from "./inventory-settings.service";

/**
 * The three numbers, defined once.
 *
 * physical  = every unit in the building, whatever state it is in
 * reserved  = physically present but promised to a document
 * available = free to sell right now (active, unexpired, unreserved)
 *
 * No screen and no service may compute these differently. Everything that needs
 * a stock number calls this service.
 */
export type StockNumbers = {
  physicalQty: number;
  availableQty: number;
  reservedQty: number;
  damagedQty: number;
  quarantineQty: number;
  blockedQty: number;
  expiredQty: number;
  onHoldQty: number;
  nearExpiryQty: number;
  batchCount: number;
  valuePkr: number;
};

export type MedicineAvailability = StockNumbers & {
  medicineId: string;
  sku: string;
  name: string;
  unit: string;
  reorderLevel: number;
  minStock: number;
  maxStock: number;
  /** ok | low | out | negative */
  stockState: "ok" | "low" | "out" | "negative";
};

const ZERO_NUMBERS: StockNumbers = {
  physicalQty: 0,
  availableQty: 0,
  reservedQty: 0,
  damagedQty: 0,
  quarantineQty: 0,
  blockedQty: 0,
  expiredQty: 0,
  onHoldQty: 0,
  nearExpiryQty: 0,
  batchCount: 0,
  valuePkr: 0,
};

@Injectable()
export class StockAvailabilityService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly fefo: FefoService,
    private readonly settings: InventorySettingsService,
  ) {}

  /**
   * Resolves a branch code to an id. Every inventory read and write goes through
   * this so a caller can never reach another organisation's branch by guessing
   * a code — the organisation id comes from the JWT, never from the query.
   */
  async resolveBranch(organizationId: string, branchCode?: string) {
    const code = branchCode?.trim();
    if (!code) throw new BadRequestException("branchCode is required");
    const [branch] = await this.db
      .select({ id: popsBranches.id, code: popsBranches.code, name: popsBranches.name })
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, code)))
      .limit(1);
    if (!branch) throw new NotFoundException(`Branch not found: ${code}`);
    return branch;
  }

  /**
   * Validates that a warehouse belongs to the caller's organisation *and* the
   * requested branch. Without this a user could pass any warehouse id and read
   * another branch's stock.
   */
  async resolveWarehouse(organizationId: string, branchId: string, warehouseId?: string | null) {
    if (!warehouseId) return null;
    const [wh] = await this.db
      .select({ id: pharmacyWarehouses.id, code: pharmacyWarehouses.code, name: pharmacyWarehouses.name })
      .from(pharmacyWarehouses)
      .where(
        and(
          eq(pharmacyWarehouses.id, warehouseId),
          eq(pharmacyWarehouses.organizationId, organizationId),
          eq(pharmacyWarehouses.branchId, branchId),
        ),
      )
      .limit(1);
    if (!wh) throw new NotFoundException("Warehouse not found for this branch");
    return wh;
  }

  /** SQL fragments implementing the definitions above, shared by every query. */
  stockExpressions(nearExpiryDays: number) {
    const active = sql`lower(coalesce(${pharmacyMedicineBatches.status}, 'active')) = 'active'`;
    const unexpired = sql`${pharmacyMedicineBatches.expiryDate} >= current_date`;
    return {
      physicalQty: sql<number>`coalesce(sum(
        ${pharmacyMedicineBatches.quantity}
        + ${pharmacyMedicineBatches.reservedQuantity}
        + ${pharmacyMedicineBatches.damagedQuantity}
        + ${pharmacyMedicineBatches.quarantineQuantity}
        + ${pharmacyMedicineBatches.blockedQuantity}
      ), 0)`,
      availableQty: sql<number>`coalesce(sum(case when ${active} and ${unexpired} then ${pharmacyMedicineBatches.quantity} else 0 end), 0)`,
      reservedQty: sql<number>`coalesce(sum(${pharmacyMedicineBatches.reservedQuantity}), 0)`,
      damagedQty: sql<number>`coalesce(sum(${pharmacyMedicineBatches.damagedQuantity}), 0)`,
      quarantineQty: sql<number>`coalesce(sum(${pharmacyMedicineBatches.quarantineQuantity}), 0)`,
      blockedQty: sql<number>`coalesce(sum(${pharmacyMedicineBatches.blockedQuantity}), 0)`,
      expiredQty: sql<number>`coalesce(sum(case when ${pharmacyMedicineBatches.expiryDate} < current_date then ${pharmacyMedicineBatches.quantity} else 0 end), 0)`,
      onHoldQty: sql<number>`coalesce(sum(case when not (${active}) then ${pharmacyMedicineBatches.quantity} else 0 end), 0)`,
      nearExpiryQty: sql<number>`coalesce(sum(case when ${unexpired} and ${pharmacyMedicineBatches.expiryDate} <= (current_date + ${nearExpiryDays} * interval '1 day') then ${pharmacyMedicineBatches.quantity} else 0 end), 0)`,
      batchCount: sql<number>`count(${pharmacyMedicineBatches.id})`,
      valuePkr: sql<number>`coalesce(sum(${pharmacyMedicineBatches.quantity} * ${pharmacyMedicineBatches.purchaseRatePkr}), 0)`,
    };
  }

  private classify(availableQty: number, reorderLevel: number, minStock: number) {
    if (availableQty < 0) return "negative" as const;
    if (availableQty === 0) return "out" as const;
    const threshold = Math.max(reorderLevel, minStock);
    if (threshold > 0 && availableQty <= threshold) return "low" as const;
    return "ok" as const;
  }

  /**
   * Batch-level stock numbers for a set of medicines, optionally scoped to one
   * warehouse. Used by the stock screen, the availability API, and Phase 5.
   */
  async getAvailability(input: {
    organizationId: string;
    branchId: string;
    medicineIds: string[];
    warehouseId?: string | null;
    nearExpiryDays?: number;
  }): Promise<MedicineAvailability[]> {
    const ids = Array.from(new Set(input.medicineIds.filter(Boolean)));
    if (!ids.length) return [];

    const nearExpiryDays =
      input.nearExpiryDays ??
      (await this.settings.getSettings(input.organizationId, input.branchId)).nearExpiryDays;
    const expr = this.stockExpressions(nearExpiryDays);

    const batchClauses: SQL[] = [];
    if (input.warehouseId) {
      batchClauses.push(
        sql`(${pharmacyMedicineBatches.warehouseId} = ${input.warehouseId} OR ${pharmacyMedicineBatches.warehouseId} IS NULL)`,
      );
    }

    const rows = await this.db
      .select({
        medicineId: pharmacyMedicines.id,
        sku: pharmacyMedicines.sku,
        name: pharmacyMedicines.name,
        unit: pharmacyMedicines.unit,
        reorderLevel: pharmacyMedicines.reorderLevel,
        minStock: pharmacyMedicines.minStock,
        maxStock: pharmacyMedicines.maxStock,
        ...expr,
      })
      .from(pharmacyMedicines)
      .leftJoin(
        pharmacyMedicineBatches,
        batchClauses.length
          ? and(eq(pharmacyMedicineBatches.medicineId, pharmacyMedicines.id), ...batchClauses)
          : eq(pharmacyMedicineBatches.medicineId, pharmacyMedicines.id),
      )
      .where(
        and(
          eq(pharmacyMedicines.organizationId, input.organizationId),
          eq(pharmacyMedicines.branchId, input.branchId),
          inArray(pharmacyMedicines.id, ids),
        ),
      )
      .groupBy(
        pharmacyMedicines.id,
        pharmacyMedicines.sku,
        pharmacyMedicines.name,
        pharmacyMedicines.unit,
        pharmacyMedicines.reorderLevel,
        pharmacyMedicines.minStock,
        pharmacyMedicines.maxStock,
      );

    return rows.map((r) => {
      const numbers: StockNumbers = {
        physicalQty: Number(r.physicalQty ?? 0),
        availableQty: Number(r.availableQty ?? 0),
        reservedQty: Number(r.reservedQty ?? 0),
        damagedQty: Number(r.damagedQty ?? 0),
        quarantineQty: Number(r.quarantineQty ?? 0),
        blockedQty: Number(r.blockedQty ?? 0),
        expiredQty: Number(r.expiredQty ?? 0),
        onHoldQty: Number(r.onHoldQty ?? 0),
        nearExpiryQty: Number(r.nearExpiryQty ?? 0),
        batchCount: Number(r.batchCount ?? 0),
        valuePkr: Number(r.valuePkr ?? 0),
      };
      return {
        medicineId: r.medicineId,
        sku: r.sku,
        name: r.name,
        unit: r.unit,
        reorderLevel: r.reorderLevel,
        minStock: r.minStock,
        maxStock: r.maxStock,
        ...numbers,
        stockState: this.classify(numbers.availableQty, r.reorderLevel, r.minStock),
      };
    });
  }

  /**
   * The endpoint the Sale Window calls. It answers "can I sell this, and from
   * which batches" in one round trip, so no caller ever computes stock itself.
   */
  async checkAvailability(input: {
    organizationId: string;
    branchCode: string;
    warehouseId?: string | null;
    lines: { medicineId: string; quantity: number; batchId?: string | null }[];
  }) {
    const branch = await this.resolveBranch(input.organizationId, input.branchCode);
    const warehouse = await this.resolveWarehouse(input.organizationId, branch.id, input.warehouseId);
    const settings = await this.settings.getSettings(input.organizationId, branch.id);

    const lines = (input.lines ?? []).filter((l) => l?.medicineId);
    if (!lines.length) throw new BadRequestException("At least one line is required");
    if (lines.length > 200) throw new BadRequestException("Maximum 200 lines per availability request");

    const stock = await this.getAvailability({
      organizationId: input.organizationId,
      branchId: branch.id,
      medicineIds: lines.map((l) => l.medicineId),
      warehouseId: warehouse?.id ?? null,
      nearExpiryDays: settings.nearExpiryDays,
    });
    const byId = new Map(stock.map((s) => [s.medicineId, s]));

    const results = [] as {
      medicineId: string;
      sku: string | null;
      name: string | null;
      requestedQty: number;
      availableQty: number;
      reservedQty: number;
      fulfillable: boolean;
      shortfall: number;
      allocations: FefoAllocation[];
      excluded: { batchId: string; batchNumber: string; quantity: number; reason: string }[];
      reason: string | null;
    }[];

    for (const line of lines) {
      const qty = Math.max(0, Math.floor(Number(line.quantity) || 0));
      const info = byId.get(line.medicineId);
      if (!info) {
        results.push({
          medicineId: line.medicineId,
          sku: null,
          name: null,
          requestedQty: qty,
          availableQty: 0,
          reservedQty: 0,
          fulfillable: false,
          shortfall: qty,
          allocations: [],
          excluded: [],
          reason: "Medicine not found in this branch",
        });
        continue;
      }

      const plan = await this.fefo.plan({
        organizationId: input.organizationId,
        branchId: branch.id,
        medicineId: line.medicineId,
        qty,
        warehouseId: warehouse?.id ?? null,
        preferredBatchId: line.batchId ?? null,
        allowExpired: !settings.blockExpiredSale,
      });

      results.push({
        medicineId: line.medicineId,
        sku: info.sku,
        name: info.name,
        requestedQty: qty,
        availableQty: info.availableQty,
        reservedQty: info.reservedQty,
        fulfillable: plan.shortfall === 0,
        shortfall: plan.shortfall,
        allocations: plan.allocations,
        excluded: plan.excluded,
        reason:
          plan.shortfall === 0
            ? null
            : plan.excluded.length
              ? `Short by ${plan.shortfall}. Skipped: ${plan.excluded.map((e) => e.reason).join(", ")}`
              : `Short by ${plan.shortfall}`,
      });
    }

    return {
      branch: { id: branch.id, code: branch.code, name: branch.name },
      warehouse: warehouse ? { id: warehouse.id, code: warehouse.code, name: warehouse.name } : null,
      policy: {
        negativeStockPolicy: settings.negativeStockPolicy,
        blockExpiredSale: settings.blockExpiredSale,
      },
      fulfillable: results.every((r) => r.fulfillable),
      lines: results,
    };
  }

  /** Branch-wide roll-up used by the inventory dashboard. */
  async branchTotals(organizationId: string, branchId: string, warehouseId?: string | null) {
    const settings = await this.settings.getSettings(organizationId, branchId);
    const expr = this.stockExpressions(settings.nearExpiryDays);

    const clauses: SQL[] = [
      eq(pharmacyMedicines.organizationId, organizationId),
      eq(pharmacyMedicines.branchId, branchId),
    ];
    if (warehouseId) {
      clauses.push(
        sql`(${pharmacyMedicineBatches.warehouseId} = ${warehouseId} OR ${pharmacyMedicineBatches.warehouseId} IS NULL)`,
      );
    }

    const [row] = await this.db
      .select(expr)
      .from(pharmacyMedicines)
      .leftJoin(pharmacyMedicineBatches, eq(pharmacyMedicineBatches.medicineId, pharmacyMedicines.id))
      .where(and(...clauses));

    if (!row) return { ...ZERO_NUMBERS };
    return {
      physicalQty: Number(row.physicalQty ?? 0),
      availableQty: Number(row.availableQty ?? 0),
      reservedQty: Number(row.reservedQty ?? 0),
      damagedQty: Number(row.damagedQty ?? 0),
      quarantineQty: Number(row.quarantineQty ?? 0),
      blockedQty: Number(row.blockedQty ?? 0),
      expiredQty: Number(row.expiredQty ?? 0),
      onHoldQty: Number(row.onHoldQty ?? 0),
      nearExpiryQty: Number(row.nearExpiryQty ?? 0),
      batchCount: Number(row.batchCount ?? 0),
      valuePkr: Number(row.valuePkr ?? 0),
    };
  }
}
