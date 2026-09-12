import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CreatePharmacyGrn } from "@platform/contracts";
import { and, count, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import {
  pharmacyGrnLines,
  pharmacyGrns,
  pharmacyMedicines,
  pharmacyPurchaseOrderLines,
  pharmacyStockMovements,
  pharmacyWarehouses,
  popsBranches,
  type PlatformPgDb,
} from "@platform/database-pg";
import { AccountingHooksService } from "../../accounting/accounting-hooks.service";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { normalizePage, pageResult, type PageResult } from "../inventory/batch-stock.service";
import { InventorySettingsService } from "../inventory/inventory-settings.service";
import { MOVEMENT_TYPES, StockLedgerService } from "../inventory/stock-ledger.service";
import { PharmacyStockEngine } from "../pharmacy-stock.engine";
import { PurchaseNumberingService } from "./purchase-numbering.service";
import { PurchaseOrderService } from "./purchase-order.service";

/** Soft warn threshold vs PO unit cost (fraction). */
export const PRICE_VARIANCE_WARN = 0.1;
/** Hard block unless priceVarianceOverride + reason (fraction). */
export const PRICE_VARIANCE_BLOCK = 0.25;

export type CreatePharmacyGrnInput = CreatePharmacyGrn & {
  idempotencyKey?: string;
  /** Legacy bypass for PO status gate. */
  skipPoStatusCheck?: boolean;
  priceVarianceOverride?: boolean;
  priceVarianceReason?: string;
  /** Reserved for later permissioned over-receive; currently ignored — over-receive is blocked. */
  overReceive?: boolean;
  overReceiveReason?: string;
  blockNearExpiry?: boolean;
};

@Injectable()
export class PurchaseGrnService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly stock: PharmacyStockEngine,
    private readonly ledger: StockLedgerService,
    private readonly accountingHooks: AccountingHooksService,
    private readonly settings: InventorySettingsService,
    private readonly numbering: PurchaseNumberingService,
    private readonly orders: PurchaseOrderService,
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

  private daysUntil(expiryIso: string): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exp = new Date(expiryIso.slice(0, 10) + "T00:00:00");
    return Math.floor((exp.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  }

  async list(
    organizationId: string,
    filters: {
      branchCode?: string;
      purchaseOrderId?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      pageSize?: number;
    },
  ): Promise<PageResult<typeof pharmacyGrns.$inferSelect>> {
    const { page, pageSize, offset } = normalizePage(filters.page, filters.pageSize);
    const clauses: SQL[] = [eq(pharmacyGrns.organizationId, organizationId)];
    if (filters.branchCode?.trim()) {
      const branch = await this.resolveBranch(organizationId, filters.branchCode);
      clauses.push(eq(pharmacyGrns.branchId, branch.id));
    }
    if (filters.purchaseOrderId?.trim()) {
      clauses.push(eq(pharmacyGrns.purchaseOrderId, filters.purchaseOrderId.trim()));
    }
    if (filters.dateFrom?.trim()) clauses.push(gte(pharmacyGrns.receivedDate, filters.dateFrom.trim()));
    if (filters.dateTo?.trim()) clauses.push(lte(pharmacyGrns.receivedDate, filters.dateTo.trim()));

    const where = and(...clauses);
    const [totalRow] = await this.db.select({ n: count() }).from(pharmacyGrns).where(where);
    const items = await this.db
      .select()
      .from(pharmacyGrns)
      .where(where)
      .orderBy(desc(pharmacyGrns.createdAt))
      .limit(pageSize)
      .offset(offset);
    return pageResult(items, Number(totalRow?.n ?? 0), page, pageSize);
  }

  async getById(organizationId: string, id: string) {
    const [grn] = await this.db
      .select()
      .from(pharmacyGrns)
      .where(and(eq(pharmacyGrns.id, id), eq(pharmacyGrns.organizationId, organizationId)))
      .limit(1);
    if (!grn) throw new NotFoundException("GRN not found");
    const lines = await this.db
      .select({
        id: pharmacyGrnLines.id,
        grnId: pharmacyGrnLines.grnId,
        medicineId: pharmacyGrnLines.medicineId,
        batchId: pharmacyGrnLines.batchId,
        purchaseOrderLineId: pharmacyGrnLines.purchaseOrderLineId,
        batchNumber: pharmacyGrnLines.batchNumber,
        manufacturingDate: pharmacyGrnLines.manufacturingDate,
        expiryDate: pharmacyGrnLines.expiryDate,
        quantity: pharmacyGrnLines.quantity,
        freeQuantity: pharmacyGrnLines.freeQuantity,
        unitCostPkr: pharmacyGrnLines.unitCostPkr,
        lineTotalPkr: pharmacyGrnLines.lineTotalPkr,
        medicineName: pharmacyMedicines.name,
        medicineSku: pharmacyMedicines.sku,
      })
      .from(pharmacyGrnLines)
      .leftJoin(pharmacyMedicines, eq(pharmacyGrnLines.medicineId, pharmacyMedicines.id))
      .where(eq(pharmacyGrnLines.grnId, id));
    return { ...grn, lines };
  }

  /**
   * Shared GRN posting used by /v1/pharmacy/grns and /v1/pharmacy/purchase/grns.
   * Stock always goes through PharmacyStockEngine.receiveBatch (Phase 4).
   *
   * Accounting: still posts JV AP via recordPurchaseFromPharmacyGrn — do not
   * silently switch to vendor bills.
   */
  async create(organizationId: string, input: CreatePharmacyGrnInput, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const warehouse =
      input.warehouseId != null
        ? (
            await this.db
              .select()
              .from(pharmacyWarehouses)
              .where(eq(pharmacyWarehouses.id, input.warehouseId))
              .limit(1)
          )[0]
        : await this.stock.ensureDefaultWarehouse(organizationId, branch.id);
    if (!warehouse) throw new BadRequestException("Warehouse not found");

    const invSettings = await this.settings.getSettings(organizationId, branch.id);
    const warnings: string[] = [];

    let po: Awaited<ReturnType<PurchaseOrderService["getById"]>> | null = null;
    if (input.purchaseOrderId) {
      po = await this.orders.assertReceivable(
        organizationId,
        input.purchaseOrderId,
        Boolean(input.skipPoStatusCheck),
      );
    }

    // Pre-validate all lines before opening the stock transaction.
    for (const line of input.lines) {
      const expiry = line.expiryDate?.trim();
      if (!expiry) throw new BadRequestException("expiryDate is required on every GRN line");
      const days = this.daysUntil(expiry);
      if (days < 0) {
        throw new BadRequestException(`Expired stock blocked: batch ${line.batchNumber} expired on ${expiry}`);
      }
      if (days < invSettings.nearExpiryDays) {
        const msg = `Near-expiry: ${line.batchNumber} expires in ${days} day(s) (threshold ${invSettings.nearExpiryDays})`;
        if (input.blockNearExpiry) throw new BadRequestException(msg);
        warnings.push(msg);
      }

      const qty = Math.round(line.quantity);
      const freeQty = Math.round(line.freeQuantity ?? 0);
      const receiveTotal = qty + freeQty;
      const unitCost = Math.round(line.unitCostPkr ?? 0);

      if (po) {
        const match =
          (line.purchaseOrderLineId
            ? po.lines.find((l) => l.id === line.purchaseOrderLineId)
            : undefined) ?? po.lines.find((l) => l.medicineId === line.medicineId);
        if (!match) {
          throw new BadRequestException(`No matching PO line for medicine ${line.medicineId}`);
        }
        const pending = match.pendingQty;
        if (receiveTotal > pending) {
          // Over-receive blocked for now (overReceive flag reserved for later).
          throw new BadRequestException(
            `Over-receive blocked for medicine ${line.medicineId}: receiving ${receiveTotal}, pending ${pending}`,
          );
        }
        if (match.unitCostPkr > 0 && unitCost > 0) {
          const variance = Math.abs(unitCost - match.unitCostPkr) / match.unitCostPkr;
          if (variance > PRICE_VARIANCE_BLOCK) {
            if (!input.priceVarianceOverride || !input.priceVarianceReason?.trim()) {
              throw new BadRequestException(
                `Price variance ${(variance * 100).toFixed(1)}% exceeds 25% vs PO; provide priceVarianceOverride and priceVarianceReason`,
              );
            }
            warnings.push(
              `Price variance override: ${(variance * 100).toFixed(1)}% — ${input.priceVarianceReason.trim()}`,
            );
          } else if (variance > PRICE_VARIANCE_WARN) {
            warnings.push(
              `Price variance ${(variance * 100).toFixed(1)}% on ${line.batchNumber} (PO ${match.unitCostPkr} vs GRN ${unitCost})`,
            );
          }
        }
      }
    }

    let total = 0;
    for (const line of input.lines) {
      total += Math.round(line.quantity) * Math.round(line.unitCostPkr ?? 0);
    }

    const tableKey = input.idempotencyKey?.trim() || null;
    if (tableKey) {
      const [prior] = await this.db
        .select()
        .from(pharmacyGrns)
        .where(
          and(eq(pharmacyGrns.organizationId, organizationId), eq(pharmacyGrns.idempotencyKey, tableKey)),
        )
        .limit(1);
      if (prior) {
        const lines = await this.db.select().from(pharmacyGrnLines).where(eq(pharmacyGrnLines.grnId, prior.id));
        return { ...prior, lines, warnings, replayed: true };
      }
    }

    const docKey = tableKey ? `grn-doc:${tableKey}` : null;

    const post = (grnNumber: string) =>
      this.db.transaction(async (tx) => {
        if (docKey && (await this.ledger.hasPosted(organizationId, docKey, tx))) {
          const [priorMovement] = await tx
            .select({ referenceId: pharmacyStockMovements.referenceId })
            .from(pharmacyStockMovements)
            .where(
              and(
                eq(pharmacyStockMovements.organizationId, organizationId),
                eq(pharmacyStockMovements.idempotencyKey, docKey),
              ),
            )
            .limit(1);
          if (priorMovement?.referenceId) {
            const [prior] = await tx
              .select()
              .from(pharmacyGrns)
              .where(
                and(
                  eq(pharmacyGrns.id, priorMovement.referenceId),
                  eq(pharmacyGrns.organizationId, organizationId),
                ),
              )
              .limit(1);
            if (prior) return { grn: prior, replayed: true as const };
          }
        }

        const [created] = await tx
          .insert(pharmacyGrns)
          .values({
            organizationId,
            branchId: branch.id,
            warehouseId: warehouse.id,
            purchaseOrderId: input.purchaseOrderId ?? null,
            supplierId: input.supplierId ?? po?.supplierId ?? null,
            grnNumber,
            supplierInvoiceNumber: input.supplierInvoiceNumber ?? null,
            receivedDate: input.receivedDate ?? new Date().toISOString().slice(0, 10),
            status: "posted",
            totalPkr: total,
            notes: input.notes ?? null,
            idempotencyKey: tableKey,
            createdByUserId: userId ?? null,
            receivedByUserId: userId ?? null,
          })
          .returning();
        if (!created) throw new BadRequestException("Failed to create GRN");

        for (const [lineIndex, line] of input.lines.entries()) {
          const qty = Math.round(line.quantity);
          const freeQty = Math.round(line.freeQuantity ?? 0);
          const unitCost = Math.round(line.unitCostPkr ?? 0);
          const batchId = await this.stock.receiveBatch(tx, {
            organizationId,
            branchId: branch.id,
            warehouseId: warehouse.id,
            medicineId: line.medicineId,
            batchNumber: line.batchNumber.trim(),
            expiryDate: line.expiryDate,
            manufacturingDate: line.manufacturingDate ?? null,
            quantity: qty,
            freeQuantity: freeQty,
            purchaseRatePkr: unitCost,
            supplierId: input.supplierId ?? po?.supplierId ?? null,
            grnId: created.id,
            referenceType: "grn",
            referenceId: created.id,
            movementType: MOVEMENT_TYPES.GRN,
            idempotencyKey: docKey && lineIndex === 0 ? docKey : `grn:${created.id}:${lineIndex}`,
            createdByUserId: userId,
          });

          let matchedLineId: string | null = line.purchaseOrderLineId ?? null;
          if (input.purchaseOrderId) {
            const poLines = await tx
              .select()
              .from(pharmacyPurchaseOrderLines)
              .where(eq(pharmacyPurchaseOrderLines.purchaseOrderId, input.purchaseOrderId));
            const match =
              (line.purchaseOrderLineId
                ? poLines.find((l) => l.id === line.purchaseOrderLineId)
                : undefined) ?? poLines.find((l) => l.medicineId === line.medicineId);
            if (match) {
              matchedLineId = match.id;
              await tx
                .update(pharmacyPurchaseOrderLines)
                .set({ receivedQty: match.receivedQty + qty + freeQty })
                .where(eq(pharmacyPurchaseOrderLines.id, match.id));
            }
          }

          await tx.insert(pharmacyGrnLines).values({
            grnId: created.id,
            medicineId: line.medicineId,
            batchId,
            purchaseOrderLineId: matchedLineId,
            batchNumber: line.batchNumber.trim(),
            manufacturingDate: line.manufacturingDate ?? null,
            expiryDate: line.expiryDate,
            quantity: qty,
            freeQuantity: freeQty,
            unitCostPkr: unitCost,
            lineTotalPkr: qty * unitCost,
          });
        }

        if (input.purchaseOrderId) {
          // FIX: partial vs received — never force received on first partial GRN.
          await this.orders.refreshReceiveStatus(tx, input.purchaseOrderId);
        }

        return { grn: created, replayed: false as const };
      });

    const isDuplicateKey = (err: unknown) =>
      typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";

    const posting = await this.numbering.withNumber(organizationId, "grn", async (grnNumber) => {
      if (docKey) {
        return post(grnNumber).catch((err: unknown) => {
          if (!isDuplicateKey(err)) throw err;
          return post(grnNumber);
        });
      }
      return post(grnNumber);
    });

    const grn = posting.grn;

    if (!posting.replayed) {
      try {
        await this.accountingHooks.recordPurchaseFromPharmacyGrn(organizationId, branch.id, {
          grnNumber: grn.grnNumber,
          totalPkr: grn.totalPkr,
          createdAt: grn.createdAt,
        });
      } catch {
        /* accounting optional failure should not block GRN */
      }
    }

    const lines = await this.db.select().from(pharmacyGrnLines).where(eq(pharmacyGrnLines.grnId, grn.id));
    return { ...grn, lines, warnings, replayed: posting.replayed };
  }
}
