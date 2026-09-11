import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createPharmacyGrnSchema,
  createPharmacyPurchaseInvoiceSchema,
  createPharmacyPurchaseOrderSchema,
  createPharmacyPurchaseRequisitionSchema,
  createPharmacyPurchaseReturnSchema,
  purchaseConfirmSchema,
  purchaseFromReorderSchema,
  purchaseRejectSchema,
  purchaseRequisitionConvertSchema,
  updatePharmacyPurchaseRequisitionSchema,
} from "@platform/contracts";
import { z } from "zod";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { CurrentUser } from "../../auth/current-user.decorator";
import type { AccessJwtPayload } from "../../auth/jwt.types";
import { PermissionsGuard } from "../../users/permissions.guard";
import { RequirePermissions } from "../../users/require-permission.decorator";
import { SystemTypeGuard } from "../../users/system-type.guard";
import { RequireSystemType } from "../../users/require-system-type.decorator";
import { PurchaseDashboardService } from "./purchase-dashboard.service";
import { PurchaseGrnService } from "./purchase-grn.service";
import { PurchaseInvoiceService } from "./purchase-invoice.service";
import { PurchaseOrderService } from "./purchase-order.service";
import { PurchaseRequisitionService } from "./purchase-requisition.service";
import { PurchaseReturnService } from "./purchase-return.service";
import { SupplierPerformanceService } from "./supplier-performance.service";

type Q = Record<string, string | undefined>;

@Controller("v1/pharmacy/purchase")
@UseGuards(JwtAuthGuard, PermissionsGuard, SystemTypeGuard)
@RequireSystemType("pharmacy", "distribution")
export class PurchaseController {
  constructor(
    private readonly dashboard: PurchaseDashboardService,
    private readonly requisitions: PurchaseRequisitionService,
    private readonly orders: PurchaseOrderService,
    private readonly grns: PurchaseGrnService,
    private readonly invoices: PurchaseInvoiceService,
    private readonly returns: PurchaseReturnService,
    private readonly suppliers: SupplierPerformanceService,
  ) {}

  private num(raw?: string) {
    if (raw === undefined || raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }

  // ── Dashboard ────────────────────────────────────────────────────────────

  @Get("dashboard")
  @RequirePermissions(
    "purchase.view",
    "purchase.reports",
    "pharmacy.purchase.view",
    "pharmacy.view",
    "pops.read",
  )
  getDashboard(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode?: string) {
    return this.dashboard.getDashboard(user.organizationId, branchCode?.trim());
  }

  // ── Requisitions ─────────────────────────────────────────────────────────

  @Get("requisitions")
  @RequirePermissions("purchase.view", "purchase.requisition", "pharmacy.purchase.view", "pops.read")
  listRequisitions(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.requisitions.list(user.organizationId, {
      branchCode: q.branchCode,
      status: q.status,
      page: this.num(q.page),
      pageSize: this.num(q.pageSize),
    });
  }

  @Post("requisitions")
  @RequirePermissions("purchase.requisition", "pharmacy.purchase.manage", "pops.inventory.manage")
  createRequisition(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.requisitions.create(
      user.organizationId,
      createPharmacyPurchaseRequisitionSchema.parse(body),
      user.sub,
    );
  }

  @Post("requisitions/from-reorder")
  @RequirePermissions("purchase.requisition", "pharmacy.purchase.manage", "pops.inventory.manage")
  fromReorder(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.requisitions.fromReorder(
      user.organizationId,
      purchaseFromReorderSchema.parse(body),
      user.sub,
    );
  }

  @Get("requisitions/:id")
  @RequirePermissions("purchase.view", "purchase.requisition", "pharmacy.purchase.view", "pops.read")
  getRequisition(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.requisitions.getById(user.organizationId, id);
  }

  @Patch("requisitions/:id")
  @RequirePermissions("purchase.requisition", "pharmacy.purchase.manage", "pops.inventory.manage")
  updateRequisition(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.requisitions.updateDraft(
      user.organizationId,
      id,
      updatePharmacyPurchaseRequisitionSchema.parse(body),
    );
  }

  @Post("requisitions/:id/submit")
  @RequirePermissions("purchase.requisition", "pharmacy.purchase.manage", "pops.inventory.manage")
  submitRequisition(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.requisitions.submit(user.organizationId, id);
  }

  @Post("requisitions/:id/approve")
  @RequirePermissions(
    "purchase.requisition.approve",
    "purchase.order.approve",
    "pharmacy.purchase.manage",
    "pops.inventory.manage",
  )
  approveRequisition(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.requisitions.approve(user.organizationId, id, user.sub);
  }

  @Post("requisitions/:id/reject")
  @RequirePermissions(
    "purchase.requisition.approve",
    "pharmacy.purchase.manage",
    "pops.inventory.manage",
  )
  rejectRequisition(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const parsed = purchaseRejectSchema.parse(body);
    return this.requisitions.reject(user.organizationId, id, parsed.reason);
  }

  @Post("requisitions/:id/cancel")
  @RequirePermissions("purchase.requisition", "pharmacy.purchase.manage", "pops.inventory.manage")
  cancelRequisition(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.requisitions.cancel(user.organizationId, id);
  }

  @Post("requisitions/:id/convert")
  @RequirePermissions("purchase.order", "pharmacy.purchase.manage", "pops.inventory.manage")
  convertRequisition(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.requisitions.convertToPo(
      user.organizationId,
      id,
      purchaseRequisitionConvertSchema.parse(body),
      user.sub,
    );
  }

  // ── Orders ───────────────────────────────────────────────────────────────

  @Get("orders")
  @RequirePermissions("purchase.view", "purchase.order", "pharmacy.purchase.view", "pops.read")
  listOrders(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.orders.list(user.organizationId, {
      branchCode: q.branchCode,
      status: q.status,
      supplierId: q.supplierId,
      q: q.q,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      page: this.num(q.page),
      pageSize: this.num(q.pageSize),
    });
  }

  @Post("orders")
  @RequirePermissions("purchase.order", "pharmacy.purchase.manage", "pops.inventory.manage")
  createOrder(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const raw = body as Record<string, unknown>;
    return this.orders.create(
      user.organizationId,
      {
        ...createPharmacyPurchaseOrderSchema.parse(body),
        warehouseId: typeof raw.warehouseId === "string" ? raw.warehouseId : undefined,
        paymentTerms: typeof raw.paymentTerms === "string" ? raw.paymentTerms : undefined,
        idempotencyKey: typeof raw.idempotencyKey === "string" ? raw.idempotencyKey : undefined,
        submit: raw.submit === true,
      },
      user.sub,
    );
  }

  @Get("orders/:id")
  @RequirePermissions("purchase.view", "purchase.order", "pharmacy.purchase.view", "pops.read")
  getOrder(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.orders.getById(user.organizationId, id);
  }

  @Patch("orders/:id")
  @RequirePermissions("purchase.order", "pharmacy.purchase.manage", "pops.inventory.manage")
  updateOrder(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    const raw = (typeof body === "object" && body ? body : {}) as Record<string, unknown>;
    return this.orders.updateDraft(user.organizationId, id, {
      supplierId: typeof raw.supplierId === "string" ? raw.supplierId : raw.supplierId === null ? null : undefined,
      expectedDate:
        typeof raw.expectedDate === "string" ? raw.expectedDate : raw.expectedDate === null ? null : undefined,
      notes: typeof raw.notes === "string" ? raw.notes : raw.notes === null ? null : undefined,
      paymentTerms:
        typeof raw.paymentTerms === "string" ? raw.paymentTerms : raw.paymentTerms === null ? null : undefined,
      warehouseId:
        typeof raw.warehouseId === "string" ? raw.warehouseId : raw.warehouseId === null ? null : undefined,
      taxPkr: typeof raw.taxPkr === "number" ? raw.taxPkr : undefined,
      discountPkr: typeof raw.discountPkr === "number" ? raw.discountPkr : undefined,
      lines: Array.isArray(raw.lines)
        ? (raw.lines as {
            medicineId: string;
            quantity: number;
            freeQuantity?: number;
            unitCostPkr?: number;
            discountPkr?: number;
            taxPkr?: number;
            notes?: string;
          }[])
        : undefined,
    });
  }

  @Post("orders/:id/submit")
  @RequirePermissions("purchase.order", "pharmacy.purchase.manage", "pops.inventory.manage")
  submitOrder(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.orders.submit(user.organizationId, id);
  }

  @Post("orders/:id/approve")
  @RequirePermissions(
    "purchase.order.approve",
    "pharmacy.purchase.manage",
    "pops.inventory.manage",
  )
  approveOrder(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.orders.approve(user.organizationId, id);
  }

  @Post("orders/:id/send")
  @RequirePermissions("purchase.order", "pharmacy.purchase.manage", "pops.inventory.manage")
  sendOrder(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.orders.send(user.organizationId, id);
  }

  @Post("orders/:id/confirm")
  @RequirePermissions("purchase.order", "pharmacy.purchase.manage", "pops.inventory.manage")
  confirmOrder(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.orders.confirm(user.organizationId, id, purchaseConfirmSchema.parse(body ?? {}));
  }

  @Post("orders/:id/cancel")
  @RequirePermissions("purchase.order", "pharmacy.purchase.manage", "pops.inventory.manage")
  cancelOrder(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const reason = z.object({ reason: z.string().optional() }).parse(body ?? {}).reason;
    return this.orders.cancel(user.organizationId, id, reason);
  }

  @Post("orders/:id/revise")
  @RequirePermissions("purchase.order", "pharmacy.purchase.manage", "pops.inventory.manage")
  reviseOrder(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const parsed = z
      .object({
        reason: z.string().optional(),
        lines: createPharmacyPurchaseOrderSchema.shape.lines.optional(),
      })
      .parse(body ?? {});
    return this.orders.revise(user.organizationId, id, parsed, user.sub);
  }

  // ── GRNs ─────────────────────────────────────────────────────────────────

  @Get("grns")
  @RequirePermissions("purchase.view", "purchase.grn", "pharmacy.purchase.view", "pops.read")
  listGrns(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.grns.list(user.organizationId, {
      branchCode: q.branchCode,
      purchaseOrderId: q.purchaseOrderId,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      page: this.num(q.page),
      pageSize: this.num(q.pageSize),
    });
  }

  @Post("grns")
  @RequirePermissions("purchase.grn", "purchase.grn.post", "pharmacy.purchase.manage", "pops.inventory.manage")
  createGrn(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const raw = body as Record<string, unknown>;
    return this.grns.create(
      user.organizationId,
      {
        ...createPharmacyGrnSchema.parse(body),
        idempotencyKey: typeof raw.idempotencyKey === "string" ? raw.idempotencyKey.trim() : undefined,
        skipPoStatusCheck: raw.skipPoStatusCheck === true,
        priceVarianceOverride: raw.priceVarianceOverride === true,
        priceVarianceReason:
          typeof raw.priceVarianceReason === "string" ? raw.priceVarianceReason : undefined,
        overReceive: raw.overReceive === true,
        overReceiveReason:
          typeof raw.overReceiveReason === "string" ? raw.overReceiveReason : undefined,
        blockNearExpiry: raw.blockNearExpiry === true,
      },
      user.sub,
    );
  }

  @Get("grns/:id")
  @RequirePermissions("purchase.view", "purchase.grn", "pharmacy.purchase.view", "pops.read")
  getGrn(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.grns.getById(user.organizationId, id);
  }

  // ── Invoices ─────────────────────────────────────────────────────────────

  @Get("invoices")
  @RequirePermissions("purchase.view", "purchase.invoice", "pharmacy.purchase.view", "pops.read")
  listInvoices(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.invoices.list(user.organizationId, {
      branchCode: q.branchCode,
      status: q.status,
      supplierId: q.supplierId,
      page: this.num(q.page),
      pageSize: this.num(q.pageSize),
    });
  }

  @Post("invoices")
  @RequirePermissions("purchase.invoice", "pharmacy.purchase.manage", "pops.inventory.manage")
  createInvoice(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.invoices.createFromGrn(
      user.organizationId,
      createPharmacyPurchaseInvoiceSchema.parse(body),
      user.sub,
    );
  }

  @Get("invoices/:id")
  @RequirePermissions("purchase.view", "purchase.invoice", "pharmacy.purchase.view", "pops.read")
  getInvoice(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.invoices.getById(user.organizationId, id);
  }

  @Get("invoices/:id/match")
  @RequirePermissions("purchase.view", "purchase.invoice", "pharmacy.purchase.view", "pops.read")
  matchInvoice(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.invoices.matchSummary(user.organizationId, id);
  }

  @Post("invoices/:id/post")
  @RequirePermissions("purchase.invoice", "pharmacy.purchase.manage", "pops.inventory.manage")
  postInvoice(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.invoices.post(user.organizationId, id);
  }

  // ── Returns ──────────────────────────────────────────────────────────────

  @Get("returns")
  @RequirePermissions("purchase.view", "purchase.return", "pharmacy.purchase.view", "pops.read")
  listReturns(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.returns.list(user.organizationId, {
      branchCode: q.branchCode,
      page: this.num(q.page),
      pageSize: this.num(q.pageSize),
    });
  }

  @Post("returns")
  @RequirePermissions("purchase.return", "pharmacy.purchase.manage", "pops.inventory.manage")
  createReturn(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.returns.create(
      user.organizationId,
      createPharmacyPurchaseReturnSchema.parse(body),
      user.sub,
    );
  }

  // ── Suppliers (pops_suppliers) ───────────────────────────────────────────

  @Get("suppliers/search")
  @RequirePermissions("purchase.view", "purchase.supplier", "pharmacy.purchase.view", "pops.read")
  searchSuppliers(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.orders.searchSuppliers(user.organizationId, q.q ?? "", q.branchCode);
  }

  @Get("suppliers/:id/performance")
  @RequirePermissions(
    "purchase.view",
    "purchase.supplier",
    "purchase.reports",
    "pharmacy.purchase.view",
    "pops.read",
  )
  supplierPerformance(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Query("branchCode") branchCode?: string,
  ) {
    return this.suppliers.performance(user.organizationId, id, branchCode?.trim());
  }

  @Get("suppliers/:id/summary")
  @RequirePermissions("purchase.view", "purchase.supplier", "pharmacy.purchase.view", "pops.read")
  supplierSummary(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Query("branchCode") branchCode?: string,
  ) {
    return this.orders.supplierSummary(user.organizationId, id, branchCode?.trim());
  }
}
