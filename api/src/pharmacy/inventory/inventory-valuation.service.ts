import { Inject, Injectable } from "@nestjs/common";
import { and, count, countDistinct, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import {
  pharmacyCompanies,
  pharmacyMedicineBatches,
  pharmacyMedicines,
  pharmacyWarehouses,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { normalizePage, pageResult, type PageResult } from "./batch-stock.service";
import { InventorySettingsService, type CostingMethod } from "./inventory-settings.service";
import { StockAvailabilityService } from "./stock-availability.service";

export type ValuationSummary = {
  costingMethod: CostingMethod;
  availableQty: number;
  physicalQty: number;
  availableValuePkr: number;
  physicalValuePkr: number;
  expiredValuePkr: number;
  damagedValuePkr: number;
  quarantineValuePkr: number;
  blockedValuePkr: number;
  nearExpiryValuePkr: number;
  batchesValued: number;
  batchesMissingCost: number;
  fallbackUsedCount: number;
  note: string;
};

export type WarehouseValuationRow = {
  warehouseId: string | null;
  warehouseCode: string | null;
  warehouseName: string;
  availableQty: number;
  availableValuePkr: number;
  physicalValuePkr: number;
  batchCount: number;
};

export type CompanyValuationRow = {
  companyId: string | null;
  companyName: string;
  availableQty: number;
  availableValuePkr: number;
  batchCount: number;
  skuCount: number;
};

/** Where the unit cost on a report line actually came from, so it is auditable. */
export type CostSource = "batch" | "product_cost" | "product_purchase" | "none";

export type ValuationReportRow = {
  medicineId: string;
  sku: string;
  name: string;
  companyName: string | null;
  unit: string;
  availableQty: number;
  physicalQty: number;
  unitCostPkr: number;
  availableValuePkr: number;
  costSource: CostSource;
};

export type ValuationFilters = {
  branchCode: string;
  warehouseId?: string;
  companyId?: string;
};

const UNASSIGNED_WAREHOUSE = "Unassigned (legacy)";

@Injectable()
export class InventoryValuationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly availability: StockAvailabilityService,
    private readonly settings: InventorySettingsService,
  ) {}

  /**
   * Unit cost resolution chain, in order:
   *   batch_purchase_rate (default): batch.purchaseRatePkr -> medicine.costPricePkr
   *                                  -> medicine.purchasePricePkr -> 0
   *   product_cost_price:            medicine.costPricePkr -> medicine.purchasePricePkr
   *                                  -> batch.purchaseRatePkr -> 0
   *
   * Pre-Phase-4 reports valued stock as `currentStock * costPricePkr`. Phase 4
   * values each batch at its own purchase rate, so the two can legitimately
   * differ. The method and the number of fallbacks are reported rather than
   * hidden, so nobody has to guess which basis a figure used.
   */
  private costing(method: CostingMethod) {
    const batchRate = sql`nullif(${pharmacyMedicineBatches.purchaseRatePkr}, 0)`;
    const productCost = sql`nullif(${pharmacyMedicines.costPricePkr}, 0)`;
    const productPurchase = sql`nullif(${pharmacyMedicines.purchasePricePkr}, 0)`;

    const chain =
      method === "product_cost_price"
        ? [productCost, productPurchase, batchRate]
        : [batchRate, productCost, productPurchase];
    const sources: CostSource[] =
      method === "product_cost_price"
        ? ["product_cost", "product_purchase", "batch"]
        : ["batch", "product_cost", "product_purchase"];

    return {
      unitCost: sql<number>`coalesce(${chain[0]}, ${chain[1]}, ${chain[2]}, 0)`,
      /** 1 when the preferred source was empty and a later one had to be used. */
      fallbackFlag: sql<number>`case when ${chain[0]} is null then 1 else 0 end`,
      missingFlag: sql<number>`case when coalesce(${chain[0]}, ${chain[1]}, ${chain[2]}, 0) = 0 then 1 else 0 end`,
      preferred: chain[0],
      sources,
    };
  }

  private scopeClauses(
    organizationId: string,
    branchId: string,
    filters: { warehouseId?: string | null; companyId?: string | null },
  ): SQL[] {
    const clauses: SQL[] = [
      eq(pharmacyMedicines.organizationId, organizationId),
      eq(pharmacyMedicines.branchId, branchId),
    ];
    if (filters.warehouseId) {
      // Legacy batches with a NULL warehouse belong to the branch as a whole.
      clauses.push(
        sql`(${pharmacyMedicineBatches.warehouseId} = ${filters.warehouseId} OR ${pharmacyMedicineBatches.warehouseId} IS NULL)`,
      );
    }
    if (filters.companyId) clauses.push(eq(pharmacyMedicines.companyId, filters.companyId));
    return clauses;
  }

  private async resolveScope(organizationId: string, filters: ValuationFilters) {
    const branch = await this.availability.resolveBranch(organizationId, filters.branchCode);
    const warehouse = await this.availability.resolveWarehouse(organizationId, branch.id, filters.warehouseId);
    const settings = await this.settings.getSettings(organizationId, branch.id);
    return { branch, warehouse, settings };
  }

  async valuationSummary(organizationId: string, filters: ValuationFilters): Promise<ValuationSummary> {
    const { branch, warehouse, settings } = await this.resolveScope(organizationId, filters);
    const cost = this.costing(settings.costingMethod);

    const active = sql`lower(coalesce(${pharmacyMedicineBatches.status}, 'active')) = 'active'`;
    const unexpired = sql`${pharmacyMedicineBatches.expiryDate} >= current_date`;
    const physical = sql`(
      ${pharmacyMedicineBatches.quantity}
      + ${pharmacyMedicineBatches.reservedQuantity}
      + ${pharmacyMedicineBatches.damagedQuantity}
      + ${pharmacyMedicineBatches.quarantineQuantity}
      + ${pharmacyMedicineBatches.blockedQuantity}
    )`;

    const [row] = await this.db
      .select({
        availableQty: sql<number>`coalesce(sum(case when ${active} and ${unexpired} then ${pharmacyMedicineBatches.quantity} else 0 end), 0)`,
        physicalQty: sql<number>`coalesce(sum(${physical}), 0)`,
        availableValuePkr: sql<number>`coalesce(sum(case when ${active} and ${unexpired} then ${pharmacyMedicineBatches.quantity} * ${cost.unitCost} else 0 end), 0)`,
        physicalValuePkr: sql<number>`coalesce(sum(${physical} * ${cost.unitCost}), 0)`,
        expiredValuePkr: sql<number>`coalesce(sum(case when ${pharmacyMedicineBatches.expiryDate} < current_date then ${pharmacyMedicineBatches.quantity} * ${cost.unitCost} else 0 end), 0)`,
        damagedValuePkr: sql<number>`coalesce(sum(${pharmacyMedicineBatches.damagedQuantity} * ${cost.unitCost}), 0)`,
        quarantineValuePkr: sql<number>`coalesce(sum(${pharmacyMedicineBatches.quarantineQuantity} * ${cost.unitCost}), 0)`,
        blockedValuePkr: sql<number>`coalesce(sum(${pharmacyMedicineBatches.blockedQuantity} * ${cost.unitCost}), 0)`,
        nearExpiryValuePkr: sql<number>`coalesce(sum(case when ${unexpired} and ${pharmacyMedicineBatches.expiryDate} <= current_date + ${sql.raw(String(settings.nearExpiryDays))} then ${pharmacyMedicineBatches.quantity} * ${cost.unitCost} else 0 end), 0)`,
        batchesValued: count(pharmacyMedicineBatches.id),
        fallbackUsedCount: sql<number>`coalesce(sum(case when ${pharmacyMedicineBatches.id} is null then 0 else ${cost.fallbackFlag} end), 0)`,
        batchesMissingCost: sql<number>`coalesce(sum(case when ${pharmacyMedicineBatches.id} is null then 0 else ${cost.missingFlag} end), 0)`,
      })
      .from(pharmacyMedicines)
      .leftJoin(pharmacyMedicineBatches, eq(pharmacyMedicineBatches.medicineId, pharmacyMedicines.id))
      .where(
        and(
          ...this.scopeClauses(organizationId, branch.id, {
            warehouseId: warehouse?.id ?? null,
            companyId: filters.companyId,
          }),
        ),
      );

    const batchesValued = Number(row?.batchesValued ?? 0);
    const fallbackUsedCount = Number(row?.fallbackUsedCount ?? 0);
    const batchesMissingCost = Number(row?.batchesMissingCost ?? 0);

    const basis =
      settings.costingMethod === "product_cost_price"
        ? "Valued at product cost price"
        : "Valued at batch purchase rate";
    const fallbackNote = fallbackUsedCount
      ? ` ${fallbackUsedCount} of ${batchesValued} batches had no ${
          settings.costingMethod === "product_cost_price" ? "product cost price" : "batch cost"
        } and fell back to the next source in the chain.`
      : ` All ${batchesValued} batches carried their own cost.`;
    const missingNote = batchesMissingCost
      ? ` ${batchesMissingCost} batches have no cost anywhere and are valued at 0.`
      : "";

    return {
      costingMethod: settings.costingMethod,
      availableQty: Number(row?.availableQty ?? 0),
      physicalQty: Number(row?.physicalQty ?? 0),
      availableValuePkr: Number(row?.availableValuePkr ?? 0),
      physicalValuePkr: Number(row?.physicalValuePkr ?? 0),
      expiredValuePkr: Number(row?.expiredValuePkr ?? 0),
      damagedValuePkr: Number(row?.damagedValuePkr ?? 0),
      quarantineValuePkr: Number(row?.quarantineValuePkr ?? 0),
      blockedValuePkr: Number(row?.blockedValuePkr ?? 0),
      nearExpiryValuePkr: Number(row?.nearExpiryValuePkr ?? 0),
      batchesValued,
      batchesMissingCost,
      fallbackUsedCount,
      note: `${basis}.${fallbackNote}${missingNote}`,
    };
  }

  async valuationByWarehouse(
    organizationId: string,
    filters: ValuationFilters,
  ): Promise<WarehouseValuationRow[]> {
    const { branch, warehouse, settings } = await this.resolveScope(organizationId, filters);
    const cost = this.costing(settings.costingMethod);

    const active = sql`lower(coalesce(${pharmacyMedicineBatches.status}, 'active')) = 'active'`;
    const unexpired = sql`${pharmacyMedicineBatches.expiryDate} >= current_date`;
    const physical = sql`(
      ${pharmacyMedicineBatches.quantity}
      + ${pharmacyMedicineBatches.reservedQuantity}
      + ${pharmacyMedicineBatches.damagedQuantity}
      + ${pharmacyMedicineBatches.quarantineQuantity}
      + ${pharmacyMedicineBatches.blockedQuantity}
    )`;

    const rows = await this.db
      .select({
        warehouseId: pharmacyMedicineBatches.warehouseId,
        warehouseCode: pharmacyWarehouses.code,
        warehouseName: pharmacyWarehouses.name,
        availableQty: sql<number>`coalesce(sum(case when ${active} and ${unexpired} then ${pharmacyMedicineBatches.quantity} else 0 end), 0)`,
        availableValuePkr: sql<number>`coalesce(sum(case when ${active} and ${unexpired} then ${pharmacyMedicineBatches.quantity} * ${cost.unitCost} else 0 end), 0)`,
        physicalValuePkr: sql<number>`coalesce(sum(${physical} * ${cost.unitCost}), 0)`,
        batchCount: count(pharmacyMedicineBatches.id),
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
      .where(
        and(
          ...this.scopeClauses(organizationId, branch.id, {
            warehouseId: warehouse?.id ?? null,
            companyId: filters.companyId,
          }),
        ),
      )
      .groupBy(pharmacyMedicineBatches.warehouseId, pharmacyWarehouses.code, pharmacyWarehouses.name)
      .orderBy(desc(sql`coalesce(sum(case when ${active} and ${unexpired} then ${pharmacyMedicineBatches.quantity} * ${cost.unitCost} else 0 end), 0)`));

    // The NULL-warehouse group is real pre-Phase-4 stock, surfaced as its own row
    // rather than dropped, so branch totals always reconcile.
    return rows.map((r) => ({
      warehouseId: r.warehouseId ?? null,
      warehouseCode: r.warehouseCode ?? null,
      warehouseName: r.warehouseName ?? UNASSIGNED_WAREHOUSE,
      availableQty: Number(r.availableQty ?? 0),
      availableValuePkr: Number(r.availableValuePkr ?? 0),
      physicalValuePkr: Number(r.physicalValuePkr ?? 0),
      batchCount: Number(r.batchCount ?? 0),
    }));
  }

  async valuationByCompany(
    organizationId: string,
    filters: ValuationFilters,
  ): Promise<CompanyValuationRow[]> {
    const { branch, warehouse, settings } = await this.resolveScope(organizationId, filters);
    const cost = this.costing(settings.costingMethod);

    const active = sql`lower(coalesce(${pharmacyMedicineBatches.status}, 'active')) = 'active'`;
    const unexpired = sql`${pharmacyMedicineBatches.expiryDate} >= current_date`;

    const rows = await this.db
      .select({
        companyId: pharmacyMedicines.companyId,
        companyName: pharmacyCompanies.name,
        availableQty: sql<number>`coalesce(sum(case when ${active} and ${unexpired} then ${pharmacyMedicineBatches.quantity} else 0 end), 0)`,
        availableValuePkr: sql<number>`coalesce(sum(case when ${active} and ${unexpired} then ${pharmacyMedicineBatches.quantity} * ${cost.unitCost} else 0 end), 0)`,
        batchCount: count(pharmacyMedicineBatches.id),
        skuCount: countDistinct(pharmacyMedicines.id),
      })
      .from(pharmacyMedicines)
      .leftJoin(pharmacyMedicineBatches, eq(pharmacyMedicineBatches.medicineId, pharmacyMedicines.id))
      .leftJoin(
        pharmacyCompanies,
        and(
          eq(pharmacyCompanies.id, pharmacyMedicines.companyId),
          eq(pharmacyCompanies.organizationId, organizationId),
        ),
      )
      .where(
        and(
          ...this.scopeClauses(organizationId, branch.id, {
            warehouseId: warehouse?.id ?? null,
            companyId: filters.companyId,
          }),
        ),
      )
      .groupBy(pharmacyMedicines.companyId, pharmacyCompanies.name)
      .orderBy(desc(sql`coalesce(sum(case when ${active} and ${unexpired} then ${pharmacyMedicineBatches.quantity} * ${cost.unitCost} else 0 end), 0)`));

    return rows.map((r) => ({
      companyId: r.companyId ?? null,
      companyName: r.companyName ?? "Unassigned company",
      availableQty: Number(r.availableQty ?? 0),
      availableValuePkr: Number(r.availableValuePkr ?? 0),
      batchCount: Number(r.batchCount ?? 0),
      skuCount: Number(r.skuCount ?? 0),
    }));
  }

  async valuationReport(
    organizationId: string,
    filters: ValuationFilters & { q?: string; page?: number; pageSize?: number },
  ): Promise<PageResult<ValuationReportRow>> {
    const { branch, warehouse, settings } = await this.resolveScope(organizationId, filters);
    const { page, pageSize, offset } = normalizePage(filters.page, filters.pageSize);
    const cost = this.costing(settings.costingMethod);

    const active = sql`lower(coalesce(${pharmacyMedicineBatches.status}, 'active')) = 'active'`;
    const unexpired = sql`${pharmacyMedicineBatches.expiryDate} >= current_date`;
    const physical = sql`(
      ${pharmacyMedicineBatches.quantity}
      + ${pharmacyMedicineBatches.reservedQuantity}
      + ${pharmacyMedicineBatches.damagedQuantity}
      + ${pharmacyMedicineBatches.quarantineQuantity}
      + ${pharmacyMedicineBatches.blockedQuantity}
    )`;

    const clauses = this.scopeClauses(organizationId, branch.id, {
      warehouseId: warehouse?.id ?? null,
      companyId: filters.companyId,
    });
    if (filters.q?.trim()) {
      const term = `%${filters.q.trim()}%`;
      const search = or(
        ilike(pharmacyMedicines.name, term),
        ilike(pharmacyMedicines.sku, term),
        ilike(pharmacyMedicines.genericName, term),
      );
      if (search) clauses.push(search);
    }
    const where = and(...clauses);

    const availableQtyExpr = sql<number>`coalesce(sum(case when ${active} and ${unexpired} then ${pharmacyMedicineBatches.quantity} else 0 end), 0)`;
    const availableValueExpr = sql<number>`coalesce(sum(case when ${active} and ${unexpired} then ${pharmacyMedicineBatches.quantity} * ${cost.unitCost} else 0 end), 0)`;

    const rows = await this.db
      .select({
        medicineId: pharmacyMedicines.id,
        sku: pharmacyMedicines.sku,
        name: pharmacyMedicines.name,
        companyName: pharmacyCompanies.name,
        unit: pharmacyMedicines.unit,
        availableQty: availableQtyExpr,
        physicalQty: sql<number>`coalesce(sum(${physical}), 0)`,
        availableValuePkr: availableValueExpr,
        // Weighted average of the resolved batch costs, so the printed unit cost
        // multiplied by the quantity reproduces the reported value.
        unitCostPkr: sql<number>`case
          when ${availableQtyExpr} > 0
            then round(${availableValueExpr}::numeric / ${availableQtyExpr})::int
          else coalesce(max(${cost.unitCost}), 0)
        end`,
        // 'batch' means at least one batch supplied its own rate; otherwise the
        // product-level source that was actually used is reported.
        costSource: sql<string>`case
          when coalesce(sum(case when ${cost.preferred} is not null then 1 else 0 end), 0) > 0 then ${cost.sources[0]}::text
          when max(case when ${pharmacyMedicines.costPricePkr} > 0 then 1 else 0 end) = 1 then 'product_cost'::text
          when max(case when ${pharmacyMedicines.purchasePricePkr} > 0 then 1 else 0 end) = 1 then 'product_purchase'::text
          else 'none'::text end`,
      })
      .from(pharmacyMedicines)
      .leftJoin(pharmacyMedicineBatches, eq(pharmacyMedicineBatches.medicineId, pharmacyMedicines.id))
      .leftJoin(
        pharmacyCompanies,
        and(
          eq(pharmacyCompanies.id, pharmacyMedicines.companyId),
          eq(pharmacyCompanies.organizationId, organizationId),
        ),
      )
      .where(where)
      .groupBy(
        pharmacyMedicines.id,
        pharmacyMedicines.sku,
        pharmacyMedicines.name,
        pharmacyCompanies.name,
        pharmacyMedicines.unit,
      )
      .orderBy(desc(availableValueExpr), sql`${pharmacyMedicines.name} asc`)
      .limit(pageSize)
      .offset(offset);

    const [totalRow] = await this.db
      .select({ value: countDistinct(pharmacyMedicines.id) })
      .from(pharmacyMedicines)
      .leftJoin(pharmacyMedicineBatches, eq(pharmacyMedicineBatches.medicineId, pharmacyMedicines.id))
      .where(where);

    const items: ValuationReportRow[] = rows.map((r) => ({
      medicineId: r.medicineId,
      sku: r.sku,
      name: r.name,
      companyName: r.companyName ?? null,
      unit: r.unit,
      availableQty: Number(r.availableQty ?? 0),
      physicalQty: Number(r.physicalQty ?? 0),
      unitCostPkr: Number(r.unitCostPkr ?? 0),
      availableValuePkr: Number(r.availableValuePkr ?? 0),
      costSource: (["batch", "product_cost", "product_purchase", "none"] as CostSource[]).includes(
        r.costSource as CostSource,
      )
        ? (r.costSource as CostSource)
        : "none",
    }));

    return pageResult(items, Number(totalRow?.value ?? 0), page, pageSize);
  }
}
