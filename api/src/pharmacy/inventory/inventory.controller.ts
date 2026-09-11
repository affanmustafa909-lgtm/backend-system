import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { CurrentUser } from "../../auth/current-user.decorator";
import type { AccessJwtPayload } from "../../auth/jwt.types";
import { PermissionsGuard } from "../../users/permissions.guard";
import { RequirePermissions } from "../../users/require-permission.decorator";
import { SystemTypeGuard } from "../../users/system-type.guard";
import { RequireSystemType } from "../../users/require-system-type.decorator";
import { BatchStockService } from "./batch-stock.service";
import { InventoryService } from "./inventory.service";
import { InventorySettingsService } from "./inventory-settings.service";
import { InventoryValuationService } from "./inventory-valuation.service";
import { StockAdjustmentService } from "./stock-adjustment.service";
import { StockAvailabilityService } from "./stock-availability.service";
import { StockCountService } from "./stock-count.service";
import { StockTransferService } from "./stock-transfer.service";
import { MOVEMENT_TYPE_LIST, StockLedgerService } from "./stock-ledger.service";

type Q = Record<string, string | undefined>;

/**
 * Phase 4 inventory API family.
 *
 * Permissions use the existing RBAC architecture with OR semantics — the new
 * `inventory.*` identifiers are listed alongside the pre-existing
 * `pharmacy.inventory.*` / `pops.inventory.manage` ones so current roles keep
 * working. No second permission system is introduced.
 *
 * Branch and warehouse scoping is enforced inside the services: the
 * organisation id always comes from the JWT, and every `warehouseId` is
 * validated against the resolved branch before it is used in a query.
 */
@Controller("v1/pharmacy")
@UseGuards(JwtAuthGuard, PermissionsGuard, SystemTypeGuard)
@RequireSystemType("pharmacy", "distribution")
export class PharmacyInventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly batches: BatchStockService,
    private readonly availability: StockAvailabilityService,
    private readonly ledger: StockLedgerService,
    private readonly valuation: InventoryValuationService,
    private readonly transfers: StockTransferService,
    private readonly adjustments: StockAdjustmentService,
    private readonly counts: StockCountService,
    private readonly settings: InventorySettingsService,
  ) {}

  private num(raw?: string) {
    if (raw === undefined || raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }

  private bool(raw?: string) {
    if (raw === undefined || raw === "") return undefined;
    return raw === "true" || raw === "1";
  }

  private page(q: Q) {
    return { page: this.num(q.page), pageSize: this.num(q.pageSize) };
  }

  // ─── Dashboard & stock ────────────────────────────────────────────────────

  @Get("inventory/dashboard")
  @RequirePermissions("inventory.view", "pharmacy.inventory.view", "pharmacy.view", "pops.read")
  dashboard(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.inventory.dashboard(user.organizationId, {
      branchCode: q.branchCode ?? "",
      warehouseId: q.warehouseId,
    });
  }

  @Get("inventory/stock")
  @RequirePermissions("inventory.view", "pharmacy.inventory.view", "pharmacy.view", "pops.read")
  listStock(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.inventory.listStock(user.organizationId, {
      branchCode: q.branchCode ?? "",
      warehouseId: q.warehouseId,
      companyId: q.companyId,
      q: q.q,
      stockState: q.stockState,
      sort: q.sort,
      ...this.page(q),
    });
  }

  @Get("inventory/stock/:medicineId")
  @RequirePermissions("inventory.view", "pharmacy.inventory.view", "pharmacy.view", "pops.read")
  productInventory(
    @CurrentUser() user: AccessJwtPayload,
    @Param("medicineId") medicineId: string,
    @Query() q: Q,
  ) {
    return this.inventory.getProductInventory(user.organizationId, medicineId, {
      branchCode: q.branchCode ?? "",
      warehouseId: q.warehouseId,
    });
  }

  // ─── Availability (the API the Sale Window calls) ─────────────────────────

  /**
   * Single-line availability check. Phase 5 uses the POST form for a full cart.
   * Callers never compute stock themselves — they receive batch allocations.
   */
  @Get("inventory/availability")
  @RequirePermissions("inventory.view", "pharmacy.inventory.view", "pharmacy.view", "pops.read")
  availabilityGet(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.availability.checkAvailability({
      organizationId: user.organizationId,
      branchCode: q.branchCode ?? "",
      warehouseId: q.warehouseId,
      lines: [
        {
          medicineId: q.medicineId ?? "",
          quantity: this.num(q.quantity) ?? 1,
          batchId: q.batchId ?? null,
        },
      ],
    });
  }

  @Post("inventory/availability")
  @RequirePermissions("inventory.view", "pharmacy.inventory.view", "pharmacy.view", "pops.read")
  availabilityPost(
    @CurrentUser() user: AccessJwtPayload,
    @Body()
    body: {
      branchCode?: string;
      warehouseId?: string;
      lines?: { medicineId: string; quantity: number; batchId?: string | null }[];
    },
  ) {
    return this.availability.checkAvailability({
      organizationId: user.organizationId,
      branchCode: body.branchCode ?? "",
      warehouseId: body.warehouseId,
      lines: body.lines ?? [],
    });
  }

  // ─── Batches & expiry ────────────────────────────────────────────────────

  @Get("inventory/batches")
  @RequirePermissions("inventory.view", "pharmacy.inventory.view", "pharmacy.batch.manage", "pharmacy.view", "pops.read")
  listBatches(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.batches.listBatches(user.organizationId, {
      branchCode: q.branchCode ?? "",
      warehouseId: q.warehouseId,
      medicineId: q.medicineId,
      companyId: q.companyId,
      q: q.q,
      status: q.status,
      expiringInDays: this.num(q.expiringInDays),
      sort: q.sort,
      ...this.page(q),
    });
  }

  @Get("inventory/batches/:batchId")
  @RequirePermissions("inventory.view", "pharmacy.inventory.view", "pharmacy.batch.manage", "pharmacy.view", "pops.read")
  batchDetail(@CurrentUser() user: AccessJwtPayload, @Param("batchId") batchId: string, @Query() q: Q) {
    return this.batches.getBatchDetail(user.organizationId, batchId, q.branchCode ?? "");
  }

  /** Manual hold / release. Flags the batch only; quantities move via adjustments. */
  @Post("inventory/batches/:batchId/hold")
  @RequirePermissions("inventory.manage", "pharmacy.batch.manage", "pharmacy.inventory.manage", "pops.inventory.manage")
  setBatchHold(
    @CurrentUser() user: AccessJwtPayload,
    @Param("batchId") batchId: string,
    @Body() body: { branchCode?: string; status: string; reason?: string },
  ) {
    return this.batches.setBatchHold(
      user.organizationId,
      batchId,
      { branchCode: body.branchCode ?? "", status: body.status, reason: body.reason },
      user.sub,
    );
  }

  @Get("inventory/expiry/buckets")
  @RequirePermissions("inventory.view", "pharmacy.inventory.view", "pharmacy.view", "pops.read")
  expiryBuckets(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.batches.expiryBuckets(user.organizationId, {
      branchCode: q.branchCode ?? "",
      warehouseId: q.warehouseId,
      companyId: q.companyId,
    });
  }

  @Get("inventory/expiry/batches")
  @RequirePermissions("inventory.view", "pharmacy.inventory.view", "pharmacy.view", "pops.read")
  expiringBatches(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.batches.listExpiringBatches(user.organizationId, {
      branchCode: q.branchCode ?? "",
      warehouseId: q.warehouseId,
      bucket: q.bucket,
      includeExpired: this.bool(q.includeExpired),
      ...this.page(q),
    });
  }

  // ─── Stock ledger / movement register ────────────────────────────────────

  @Get("inventory/movement-types")
  @RequirePermissions("inventory.view", "pharmacy.inventory.view", "pharmacy.view", "pops.read")
  movementTypes() {
    return { types: MOVEMENT_TYPE_LIST };
  }

  @Get("inventory/ledger")
  @RequirePermissions("inventory.view", "pharmacy.inventory.view", "pharmacy.report.view", "pops.read")
  async listLedger(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    const branch = await this.availability.resolveBranch(user.organizationId, q.branchCode);
    return this.ledger.listMovements(
      user.organizationId,
      {
        warehouseId: q.warehouseId,
        medicineId: q.medicineId,
        batchId: q.batchId,
        movementType: q.movementType,
        referenceType: q.referenceType,
        referenceId: q.referenceId,
        from: q.from,
        to: q.to,
        q: q.q,
        ...this.page(q),
      },
      branch.id,
    );
  }

  @Get("inventory/ledger/totals")
  @RequirePermissions("inventory.view", "pharmacy.inventory.view", "pharmacy.report.view", "pops.read")
  async ledgerTotals(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    const branch = await this.availability.resolveBranch(user.organizationId, q.branchCode);
    return this.ledger.movementTotals(
      user.organizationId,
      {
        warehouseId: q.warehouseId,
        medicineId: q.medicineId,
        batchId: q.batchId,
        movementType: q.movementType,
        referenceType: q.referenceType,
        referenceId: q.referenceId,
        from: q.from,
        to: q.to,
        q: q.q,
      },
      branch.id,
    );
  }

  // ─── Valuation ───────────────────────────────────────────────────────────

  @Get("inventory/valuation/summary")
  @RequirePermissions("inventory.valuation", "inventory.view", "pharmacy.report.view", "pharmacy.inventory.view", "pops.inventory.manage")
  valuationSummary(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.valuation.valuationSummary(user.organizationId, {
      branchCode: q.branchCode ?? "",
      warehouseId: q.warehouseId,
      companyId: q.companyId,
    });
  }

  @Get("inventory/valuation/by-warehouse")
  @RequirePermissions("inventory.valuation", "inventory.view", "pharmacy.report.view", "pharmacy.inventory.view", "pops.inventory.manage")
  valuationByWarehouse(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.valuation.valuationByWarehouse(user.organizationId, {
      branchCode: q.branchCode ?? "",
      warehouseId: q.warehouseId,
      companyId: q.companyId,
    });
  }

  @Get("inventory/valuation/by-company")
  @RequirePermissions("inventory.valuation", "inventory.view", "pharmacy.report.view", "pharmacy.inventory.view", "pops.inventory.manage")
  valuationByCompany(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.valuation.valuationByCompany(user.organizationId, {
      branchCode: q.branchCode ?? "",
      warehouseId: q.warehouseId,
      companyId: q.companyId,
    });
  }

  @Get("inventory/valuation/report")
  @RequirePermissions("inventory.valuation", "inventory.view", "pharmacy.report.view", "pharmacy.inventory.view", "pops.inventory.manage")
  valuationReport(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.valuation.valuationReport(user.organizationId, {
      branchCode: q.branchCode ?? "",
      warehouseId: q.warehouseId,
      companyId: q.companyId,
      q: q.q,
      ...this.page(q),
    });
  }

  // ─── Planning reports ────────────────────────────────────────────────────

  @Get("inventory/reorder")
  @RequirePermissions("inventory.view", "pharmacy.inventory.view", "pharmacy.purchase.view", "pops.read")
  reorder(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.inventory.reorderSuggestions(user.organizationId, {
      branchCode: q.branchCode ?? "",
      warehouseId: q.warehouseId,
      companyId: q.companyId,
      ...this.page(q),
    });
  }

  @Get("inventory/slow-moving")
  @RequirePermissions("inventory.view", "pharmacy.inventory.view", "pharmacy.report.view", "pops.read")
  slowMoving(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.inventory.slowMoving(user.organizationId, {
      branchCode: q.branchCode ?? "",
      warehouseId: q.warehouseId,
      days: this.num(q.days),
      ...this.page(q),
    });
  }

  @Get("inventory/aging")
  @RequirePermissions("inventory.view", "pharmacy.inventory.view", "pharmacy.report.view", "pops.read")
  aging(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.inventory.stockAging(user.organizationId, {
      branchCode: q.branchCode ?? "",
      warehouseId: q.warehouseId,
      ...this.page(q),
    });
  }

  // ─── Integrity tools (read-only) ─────────────────────────────────────────

  /** Reports drift between the stock cache, batch rows, and the ledger. Never repairs. */
  @Get("inventory/reconcile")
  @RequirePermissions("inventory.view", "pharmacy.inventory.manage", "pops.inventory.manage")
  reconcile(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.inventory.reconcile(user.organizationId, {
      branchCode: q.branchCode ?? "",
      ...this.page(q),
    });
  }

  @Get("inventory/data-quality")
  @RequirePermissions("inventory.view", "pharmacy.inventory.manage", "pops.inventory.manage")
  dataQuality(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.inventory.dataQuality(user.organizationId, { branchCode: q.branchCode ?? "" });
  }

  // ─── Settings ────────────────────────────────────────────────────────────

  @Get("inventory/settings")
  @RequirePermissions("inventory.view", "pharmacy.inventory.view", "pharmacy.view", "pops.read")
  async getSettings(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    const branch = q.branchCode
      ? await this.availability.resolveBranch(user.organizationId, q.branchCode)
      : null;
    return this.settings.getSettings(user.organizationId, branch?.id ?? null);
  }

  @Patch("inventory/settings")
  @RequirePermissions("inventory.settings", "pharmacy.inventory.manage", "pops.inventory.manage")
  updateSettings(
    @CurrentUser() user: AccessJwtPayload,
    @Body() body: Record<string, unknown> & { branchCode?: string },
  ) {
    const { branchCode, ...patch } = body;
    return this.settings.updateSettings(user.organizationId, branchCode, patch as never, user.sub);
  }

  // ─── Stock transfers ─────────────────────────────────────────────────────

  @Get("inventory/transfers")
  @RequirePermissions("inventory.view", "inventory.transfer", "pharmacy.inventory.view", "pops.read")
  listTransfers(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.transfers.listTransfers(user.organizationId, {
      branchCode: q.branchCode ?? "",
      status: q.status,
      fromWarehouseId: q.fromWarehouseId,
      toWarehouseId: q.toWarehouseId,
      q: q.q,
      from: q.from,
      to: q.to,
      ...this.page(q),
    });
  }

  @Get("inventory/transfers/:id")
  @RequirePermissions("inventory.view", "inventory.transfer", "pharmacy.inventory.view", "pops.read")
  getTransfer(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Query() q: Q) {
    return this.transfers.getTransfer(user.organizationId, id, q.branchCode ?? "");
  }

  @Post("inventory/transfers")
  @RequirePermissions("inventory.transfer", "pharmacy.inventory.manage", "pops.inventory.manage")
  createTransfer(@CurrentUser() user: AccessJwtPayload, @Body() body: never) {
    return this.transfers.createTransfer(user.organizationId, body, user.sub);
  }

  @Patch("inventory/transfers/:id")
  @RequirePermissions("inventory.transfer", "pharmacy.inventory.manage", "pops.inventory.manage")
  updateTransfer(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: never) {
    return this.transfers.updateTransfer(user.organizationId, id, body, user.sub);
  }

  @Post("inventory/transfers/:id/submit")
  @RequirePermissions("inventory.transfer", "pharmacy.inventory.manage", "pops.inventory.manage")
  submitTransfer(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: { branchCode?: string },
  ) {
    return this.transfers.submitTransfer(user.organizationId, id, body.branchCode ?? "", user.sub);
  }

  @Post("inventory/transfers/:id/approve")
  @RequirePermissions("inventory.transfer.approve", "inventory.transfer", "pharmacy.inventory.manage", "pops.inventory.manage")
  approveTransfer(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: { branchCode?: string },
  ) {
    return this.transfers.approveTransfer(user.organizationId, id, body.branchCode ?? "", user.sub);
  }

  @Post("inventory/transfers/:id/dispatch")
  @RequirePermissions("inventory.transfer", "pharmacy.inventory.manage", "pops.inventory.manage")
  dispatchTransfer(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: { branchCode?: string },
  ) {
    return this.transfers.dispatchTransfer(user.organizationId, id, body.branchCode ?? "", user.sub);
  }

  @Post("inventory/transfers/:id/receive")
  @RequirePermissions("inventory.transfer", "pharmacy.inventory.manage", "pops.inventory.manage")
  receiveTransfer(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: never) {
    return this.transfers.receiveTransfer(user.organizationId, id, body, user.sub);
  }

  @Post("inventory/transfers/:id/cancel")
  @RequirePermissions("inventory.transfer", "pharmacy.inventory.manage", "pops.inventory.manage")
  cancelTransfer(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: never) {
    return this.transfers.cancelTransfer(user.organizationId, id, body, user.sub);
  }

  // ─── Stock adjustments ───────────────────────────────────────────────────

  @Get("inventory/adjustments")
  @RequirePermissions("inventory.view", "inventory.adjust", "pharmacy.inventory.view", "pops.read")
  listAdjustments(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.adjustments.listAdjustments(user.organizationId, {
      branchCode: q.branchCode ?? "",
      status: q.status,
      adjustmentType: q.adjustmentType,
      warehouseId: q.warehouseId,
      q: q.q,
      from: q.from,
      to: q.to,
      ...this.page(q),
    });
  }

  @Get("inventory/adjustments/:id")
  @RequirePermissions("inventory.view", "inventory.adjust", "pharmacy.inventory.view", "pops.read")
  getAdjustment(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Query() q: Q) {
    return this.adjustments.getAdjustment(user.organizationId, id, q.branchCode ?? "");
  }

  @Post("inventory/adjustments")
  @RequirePermissions("inventory.adjust", "pharmacy.inventory.manage", "pops.inventory.manage")
  createAdjustment(@CurrentUser() user: AccessJwtPayload, @Body() body: never) {
    return this.adjustments.createAdjustment(user.organizationId, body, user.sub);
  }

  @Patch("inventory/adjustments/:id")
  @RequirePermissions("inventory.adjust", "pharmacy.inventory.manage", "pops.inventory.manage")
  updateAdjustment(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: never) {
    return this.adjustments.updateAdjustment(user.organizationId, id, body, user.sub);
  }

  @Post("inventory/adjustments/:id/submit")
  @RequirePermissions("inventory.adjust", "pharmacy.inventory.manage", "pops.inventory.manage")
  submitAdjustment(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: { branchCode?: string },
  ) {
    return this.adjustments.submitAdjustment(user.organizationId, id, body.branchCode ?? "", user.sub);
  }

  /** Approval posts the adjustment to stock. Stock is never silently modified. */
  @Post("inventory/adjustments/:id/approve")
  @RequirePermissions("inventory.adjust.approve", "inventory.adjust", "pharmacy.inventory.manage", "pops.inventory.manage")
  approveAdjustment(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: { branchCode?: string },
  ) {
    return this.adjustments.approveAdjustment(user.organizationId, id, body.branchCode ?? "", user.sub);
  }

  @Post("inventory/adjustments/:id/reject")
  @RequirePermissions("inventory.adjust.approve", "inventory.adjust", "pharmacy.inventory.manage", "pops.inventory.manage")
  rejectAdjustment(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: never) {
    return this.adjustments.rejectAdjustment(user.organizationId, id, body, user.sub);
  }

  // ─── Stock counts ────────────────────────────────────────────────────────

  @Get("inventory/counts")
  @RequirePermissions("inventory.view", "inventory.count", "pharmacy.inventory.view", "pops.read")
  listCounts(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.counts.listCounts(user.organizationId, {
      branchCode: q.branchCode ?? "",
      status: q.status,
      countType: q.countType,
      warehouseId: q.warehouseId,
      q: q.q,
      ...this.page(q),
    });
  }

  @Get("inventory/counts/:id")
  @RequirePermissions("inventory.view", "inventory.count", "pharmacy.inventory.view", "pops.read")
  getCount(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Query() q: Q) {
    return this.counts.getCount(user.organizationId, id, {
      branchCode: q.branchCode ?? "",
      onlyVariance: this.bool(q.onlyVariance),
      ...this.page(q),
    });
  }

  @Post("inventory/counts")
  @RequirePermissions("inventory.count", "pharmacy.inventory.manage", "pops.inventory.manage")
  createCount(@CurrentUser() user: AccessJwtPayload, @Body() body: never) {
    return this.counts.createCount(user.organizationId, body, user.sub);
  }

  @Post("inventory/counts/:id/record")
  @RequirePermissions("inventory.count", "pharmacy.inventory.manage", "pops.inventory.manage")
  recordCount(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: never) {
    return this.counts.recordCount(user.organizationId, id, body, user.sub);
  }

  /** Posting converts variances into an approved adjustment document. */
  @Post("inventory/counts/:id/post")
  @RequirePermissions("inventory.count.post", "inventory.count", "pharmacy.inventory.manage", "pops.inventory.manage")
  postCount(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: never) {
    return this.counts.postCount(user.organizationId, id, body, user.sub);
  }

  @Post("inventory/counts/:id/cancel")
  @RequirePermissions("inventory.count", "pharmacy.inventory.manage", "pops.inventory.manage")
  cancelCount(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: never) {
    return this.counts.cancelCount(user.organizationId, id, body, user.sub);
  }
}
