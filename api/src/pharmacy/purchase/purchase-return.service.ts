import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, count, desc, eq, type SQL } from "drizzle-orm";
import {
  pharmacyPurchaseReturnLines,
  pharmacyPurchaseReturns,
  pharmacyWarehouses,
  popsBranches,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { normalizePage, pageResult, type PageResult } from "../inventory/batch-stock.service";
import { MOVEMENT_TYPES } from "../inventory/stock-ledger.service";
import { PharmacyStockEngine } from "../pharmacy-stock.engine";
import { PurchaseNumberingService } from "./purchase-numbering.service";
import { AccountingHooksService } from "../../accounting/accounting-hooks.service";

export type CreatePurchaseReturnInput = {
  branchCode: string;
  warehouseId?: string;
  supplierId?: string;
  grnId?: string;
  reason?: string;
  lines: { medicineId: string; batchId?: string; quantity: number; unitCostPkr?: number }[];
};

/**
 * Hardened purchase returns. Stock OUT via deductFefo only.
 *
 * AP reverse: pharmacy GRNs post JV AP (not vendor bills). There is no dedicated
 * reversePurchaseFromPharmacyReturn hook today — skip reverse journal and leave a
 * comment rather than inventing double-entry that could desync the ledger.
 */
@Injectable()
export class PurchaseReturnService {
  private readonly logger = new Logger(PurchaseReturnService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly stock: PharmacyStockEngine,
    private readonly numbering: PurchaseNumberingService,
    private readonly accountingHooks: AccountingHooksService,
  ) {}

  private async resolveBranch(organizationId: string, branchCode: string) {
    const code = branchCode.trim();
    if (!code) throw new BadRequestException("branchCode is required");
    const [branch] = await this.db
      .select()
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, code)))
      .limit(1);
    if (!branch) throw new NotFoundException(`Branch not found: ${code}`);
    return branch;
  }

  async list(
    organizationId: string,
    filters: { branchCode?: string; page?: number; pageSize?: number },
  ): Promise<PageResult<typeof pharmacyPurchaseReturns.$inferSelect>> {
    const { page, pageSize, offset } = normalizePage(filters.page, filters.pageSize);
    const clauses: SQL[] = [eq(pharmacyPurchaseReturns.organizationId, organizationId)];
    if (filters.branchCode?.trim()) {
      const branch = await this.resolveBranch(organizationId, filters.branchCode);
      clauses.push(eq(pharmacyPurchaseReturns.branchId, branch.id));
    }
    const where = and(...clauses);
    const [totalRow] = await this.db.select({ n: count() }).from(pharmacyPurchaseReturns).where(where);
    const items = await this.db
      .select()
      .from(pharmacyPurchaseReturns)
      .where(where)
      .orderBy(desc(pharmacyPurchaseReturns.createdAt))
      .limit(pageSize)
      .offset(offset);
    return pageResult(items, Number(totalRow?.n ?? 0), page, pageSize);
  }

  async getById(organizationId: string, id: string) {
    const [ret] = await this.db
      .select()
      .from(pharmacyPurchaseReturns)
      .where(
        and(
          eq(pharmacyPurchaseReturns.id, id),
          eq(pharmacyPurchaseReturns.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!ret) throw new NotFoundException("Purchase return not found");
    const lines = await this.db
      .select()
      .from(pharmacyPurchaseReturnLines)
      .where(eq(pharmacyPurchaseReturnLines.purchaseReturnId, id));
    return { ...ret, lines };
  }

  async create(organizationId: string, input: CreatePurchaseReturnInput, userId?: string) {
    if (!input.lines?.length) throw new BadRequestException("lines are required");
    for (const line of input.lines) {
      if (!line.medicineId) throw new BadRequestException("medicineId is required on each line");
      if (!Number.isFinite(line.quantity) || Math.round(line.quantity) < 1) {
        throw new BadRequestException("quantity must be >= 1 on each line");
      }
    }

    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const warehouse = input.warehouseId
      ? (
          await this.db
            .select()
            .from(pharmacyWarehouses)
            .where(eq(pharmacyWarehouses.id, input.warehouseId))
            .limit(1)
        )[0]
      : await this.stock.ensureDefaultWarehouse(organizationId, branch.id);
    if (!warehouse) throw new BadRequestException("Warehouse not found");

    let total = 0;
    for (const line of input.lines) {
      total += Math.round(line.quantity) * Math.round(line.unitCostPkr ?? 0);
    }

    const ret = await this.numbering.withNumber(organizationId, "return", async (returnNumber) =>
      this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(pharmacyPurchaseReturns)
          .values({
            organizationId,
            branchId: branch.id,
            warehouseId: warehouse.id,
            supplierId: input.supplierId ?? null,
            grnId: input.grnId ?? null,
            returnNumber,
            reason: input.reason ?? null,
            totalPkr: total,
            createdByUserId: userId ?? null,
          })
          .returning();
        if (!created) throw new BadRequestException("Failed to create purchase return");

        for (const [lineIndex, line] of input.lines.entries()) {
          const qty = Math.round(line.quantity);
          const unitCost = Math.round(line.unitCostPkr ?? 0);
          await this.stock.deductFefo(tx, {
            organizationId,
            branchId: branch.id,
            medicineId: line.medicineId,
            qty,
            warehouseId: warehouse.id,
            preferredBatchId: line.batchId,
            referenceType: "purchase_return",
            referenceId: created.id,
            movementType: MOVEMENT_TYPES.PURCHASE_RETURN,
            idempotencyKey: `purchase-return:${created.id}:${lineIndex}`,
            createdByUserId: userId,
          });
          await tx.insert(pharmacyPurchaseReturnLines).values({
            purchaseReturnId: created.id,
            medicineId: line.medicineId,
            batchId: line.batchId ?? null,
            quantity: qty,
            unitCostPkr: unitCost,
            lineTotalPkr: qty * unitCost,
          });
        }
        return created;
      }),
    );

    try {
      await this.accountingHooks.recordPharmacyPurchaseReturn(organizationId, ret.branchId, {
        returnNumber: ret.returnNumber,
        totalPkr: ret.totalPkr,
        createdAt: ret.createdAt,
      });
    } catch (err) {
      this.logger.error(
        `PRN ${ret.returnNumber} missing journal: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return this.getById(organizationId, ret.id);
  }
}
