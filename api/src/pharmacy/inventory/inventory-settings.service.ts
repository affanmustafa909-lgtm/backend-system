import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import {
  pharmacyInventorySettings,
  popsBranches,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";

export type NegativeStockPolicy = "block" | "warn" | "allow";
export type CostingMethod = "batch_purchase_rate" | "product_cost_price";
export type ReorderFormula = "reorder_level" | "min_max" | "avg_consumption";

export type InventorySettings = {
  negativeStockPolicy: NegativeStockPolicy;
  blockExpiredSale: boolean;
  allowFefoOverride: boolean;
  adjustmentApprovalThreshold: number;
  requireAdjustmentApproval: boolean;
  expiryBuckets: number[];
  nearExpiryDays: number;
  slowMovingDays: number;
  costingMethod: CostingMethod;
  reorderFormula: ReorderFormula;
  reorderLeadTimeDays: number;
  reorderSafetyDays: number;
  /** Which row supplied these values, so the UI can say so honestly. */
  source: "branch" | "organization" | "default";
};

/**
 * Phase 4 audited default. The existing system had no configurable policy and
 * relied on a hard `currentStock >= qty` check, which is equivalent to `block`.
 * Defaulting to `block` therefore preserves current behaviour.
 */
export const DEFAULT_INVENTORY_SETTINGS: InventorySettings = {
  negativeStockPolicy: "block",
  blockExpiredSale: true,
  allowFefoOverride: true,
  adjustmentApprovalThreshold: 0,
  requireAdjustmentApproval: true,
  expiryBuckets: [30, 60, 90, 180],
  nearExpiryDays: 90,
  slowMovingDays: 90,
  costingMethod: "batch_purchase_rate",
  reorderFormula: "reorder_level",
  reorderLeadTimeDays: 7,
  reorderSafetyDays: 7,
  source: "default",
};

const NEGATIVE_POLICIES: NegativeStockPolicy[] = ["block", "warn", "allow"];
const COSTING_METHODS: CostingMethod[] = ["batch_purchase_rate", "product_cost_price"];
const REORDER_FORMULAS: ReorderFormula[] = ["reorder_level", "min_max", "avg_consumption"];

export type InventorySettingsPatch = Partial<{
  negativeStockPolicy: string;
  blockExpiredSale: boolean;
  allowFefoOverride: boolean;
  adjustmentApprovalThreshold: number;
  requireAdjustmentApproval: boolean;
  expiryBuckets: number[];
  nearExpiryDays: number;
  slowMovingDays: number;
  costingMethod: string;
  reorderFormula: string;
  reorderLeadTimeDays: number;
  reorderSafetyDays: number;
}>;

@Injectable()
export class InventorySettingsService {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  private parseBuckets(raw: string | null | undefined): number[] {
    if (!raw) return DEFAULT_INVENTORY_SETTINGS.expiryBuckets;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return DEFAULT_INVENTORY_SETTINGS.expiryBuckets;
      const nums = parsed
        .map((v) => Math.floor(Number(v)))
        .filter((v) => Number.isFinite(v) && v > 0)
        .sort((a, b) => a - b);
      return nums.length ? nums : DEFAULT_INVENTORY_SETTINGS.expiryBuckets;
    } catch {
      return DEFAULT_INVENTORY_SETTINGS.expiryBuckets;
    }
  }

  private toSettings(
    row: typeof pharmacyInventorySettings.$inferSelect,
    source: "branch" | "organization",
  ): InventorySettings {
    return {
      negativeStockPolicy: (NEGATIVE_POLICIES as string[]).includes(row.negativeStockPolicy)
        ? (row.negativeStockPolicy as NegativeStockPolicy)
        : "block",
      blockExpiredSale: row.blockExpiredSale,
      allowFefoOverride: row.allowFefoOverride,
      adjustmentApprovalThreshold: row.adjustmentApprovalThreshold,
      requireAdjustmentApproval: row.requireAdjustmentApproval,
      expiryBuckets: this.parseBuckets(row.expiryBucketsJson),
      nearExpiryDays: row.nearExpiryDays,
      slowMovingDays: row.slowMovingDays,
      costingMethod: (COSTING_METHODS as string[]).includes(row.costingMethod)
        ? (row.costingMethod as CostingMethod)
        : "batch_purchase_rate",
      reorderFormula: (REORDER_FORMULAS as string[]).includes(row.reorderFormula)
        ? (row.reorderFormula as ReorderFormula)
        : "reorder_level",
      reorderLeadTimeDays: row.reorderLeadTimeDays,
      reorderSafetyDays: row.reorderSafetyDays,
      source,
    };
  }

  /**
   * Branch row wins, then the organisation-wide row (branch_id IS NULL), then
   * the audited defaults. Never throws — inventory must stay operable.
   */
  async getSettings(organizationId: string, branchId?: string | null): Promise<InventorySettings> {
    if (branchId) {
      const [branchRow] = await this.db
        .select()
        .from(pharmacyInventorySettings)
        .where(
          and(
            eq(pharmacyInventorySettings.organizationId, organizationId),
            eq(pharmacyInventorySettings.branchId, branchId),
          ),
        )
        .limit(1);
      if (branchRow) return this.toSettings(branchRow, "branch");
    }

    const [orgRow] = await this.db
      .select()
      .from(pharmacyInventorySettings)
      .where(
        and(
          eq(pharmacyInventorySettings.organizationId, organizationId),
          isNull(pharmacyInventorySettings.branchId),
        ),
      )
      .limit(1);
    if (orgRow) return this.toSettings(orgRow, "organization");

    return { ...DEFAULT_INVENTORY_SETTINGS };
  }

  private async resolveBranchId(organizationId: string, branchCode?: string) {
    const code = branchCode?.trim();
    if (!code) return null;
    const [branch] = await this.db
      .select({ id: popsBranches.id })
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, code)))
      .limit(1);
    if (!branch) throw new BadRequestException(`Branch not found: ${code}`);
    return branch.id;
  }

  async updateSettings(
    organizationId: string,
    branchCode: string | undefined,
    patch: InventorySettingsPatch,
    userId?: string,
  ): Promise<InventorySettings> {
    const branchId = await this.resolveBranchId(organizationId, branchCode);

    if (
      patch.negativeStockPolicy !== undefined &&
      !(NEGATIVE_POLICIES as string[]).includes(patch.negativeStockPolicy)
    ) {
      throw new BadRequestException("negativeStockPolicy must be block, warn, or allow");
    }
    if (patch.costingMethod !== undefined && !(COSTING_METHODS as string[]).includes(patch.costingMethod)) {
      throw new BadRequestException("costingMethod must be batch_purchase_rate or product_cost_price");
    }
    if (patch.reorderFormula !== undefined && !(REORDER_FORMULAS as string[]).includes(patch.reorderFormula)) {
      throw new BadRequestException("reorderFormula must be reorder_level, min_max, or avg_consumption");
    }
    if (patch.expiryBuckets !== undefined) {
      const ok =
        Array.isArray(patch.expiryBuckets) &&
        patch.expiryBuckets.length > 0 &&
        patch.expiryBuckets.every((v) => Number.isFinite(Number(v)) && Number(v) > 0);
      if (!ok) throw new BadRequestException("expiryBuckets must be a non-empty array of positive day counts");
    }

    const values = {
      negativeStockPolicy: patch.negativeStockPolicy,
      blockExpiredSale: patch.blockExpiredSale,
      allowFefoOverride: patch.allowFefoOverride,
      adjustmentApprovalThreshold:
        patch.adjustmentApprovalThreshold === undefined
          ? undefined
          : Math.max(0, Math.floor(Number(patch.adjustmentApprovalThreshold))),
      requireAdjustmentApproval: patch.requireAdjustmentApproval,
      expiryBucketsJson:
        patch.expiryBuckets === undefined
          ? undefined
          : JSON.stringify(
              patch.expiryBuckets.map((v) => Math.floor(Number(v))).sort((a, b) => a - b),
            ),
      nearExpiryDays:
        patch.nearExpiryDays === undefined ? undefined : Math.max(1, Math.floor(Number(patch.nearExpiryDays))),
      slowMovingDays:
        patch.slowMovingDays === undefined ? undefined : Math.max(1, Math.floor(Number(patch.slowMovingDays))),
      costingMethod: patch.costingMethod,
      reorderFormula: patch.reorderFormula,
      reorderLeadTimeDays:
        patch.reorderLeadTimeDays === undefined
          ? undefined
          : Math.max(0, Math.floor(Number(patch.reorderLeadTimeDays))),
      reorderSafetyDays:
        patch.reorderSafetyDays === undefined
          ? undefined
          : Math.max(0, Math.floor(Number(patch.reorderSafetyDays))),
      updatedByUserId: userId ?? null,
      updatedAt: new Date(),
    };
    const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));

    const [existing] = await this.db
      .select({ id: pharmacyInventorySettings.id })
      .from(pharmacyInventorySettings)
      .where(
        and(
          eq(pharmacyInventorySettings.organizationId, organizationId),
          branchId
            ? eq(pharmacyInventorySettings.branchId, branchId)
            : isNull(pharmacyInventorySettings.branchId),
        ),
      )
      .limit(1);

    if (existing) {
      await this.db
        .update(pharmacyInventorySettings)
        .set(clean)
        .where(eq(pharmacyInventorySettings.id, existing.id));
    } else {
      await this.db.insert(pharmacyInventorySettings).values({
        organizationId,
        branchId,
        ...clean,
      } as typeof pharmacyInventorySettings.$inferInsert);
    }

    return this.getSettings(organizationId, branchId);
  }
}
