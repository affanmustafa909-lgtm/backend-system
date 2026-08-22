import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  closeStoreShiftSchema,
  completeStoreHeldSaleSchema,
  createStoreBrandSchema,
  createStoreCategorySchema,
  createStoreCustomerSchema,
  createStoreGrnSchema,
  createStoreProductSchema,
  createStorePromotionSchema,
  createStorePurchaseReturnSchema,
  createStoreSaleReturnSchema,
  createStoreCashMovementSchema,
  createStoreCouponSchema,
  createStoreGiftCardSchema,
  validateStoreCouponSchema,
  validateStoreGiftCardSchema,
  updateStoreCustomerTierSchema,
  createStorePurchaseOrderSchema,
  createStorePurchaseRequisitionSchema,
  createStoreSaleSchema,
  createStoreStockAdjustmentSchema,
  createStoreStockAuditSchema,
  createStoreStockTransferSchema,
  createStoreSupplierSchema,
  createStoreUnitSchema,
  createStoreWarehouseSchema,
  openStoreShiftSchema,
  stockMovementSchema,
  upsertStorePosShortcutSchema,
} from "@platform/contracts";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { SystemTypeGuard } from "../users/system-type.guard";
import { RequireSystemType } from "../users/require-system-type.decorator";
import { StoreService } from "./store.service";
import { StoreGroceryService } from "./store-grocery.service";

@Controller("v1/store")
@UseGuards(JwtAuthGuard, PermissionsGuard, SystemTypeGuard)
@RequireSystemType("general_store", "grocery", "retail")
export class StoreController {
  constructor(
    private readonly store: StoreService,
    private readonly grocery: StoreGroceryService,
  ) {}

  @Get("dashboard")
  @RequirePermissions("pops.read")
  getDashboard(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.store.getDashboard(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("categories")
  @RequirePermissions("pops.read")
  listCategories(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.store.listCategories(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("categories")
  @RequirePermissions("pops.inventory.manage")
  createCategory(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.store.createCategory(user.organizationId, createStoreCategorySchema.parse(body));
  }

  @Get("brands")
  @RequirePermissions("pops.read")
  listBrands(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.store.listBrands(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("brands")
  @RequirePermissions("pops.inventory.manage")
  createBrand(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.store.createBrand(user.organizationId, createStoreBrandSchema.parse(body));
  }

  @Get("units")
  @RequirePermissions("pops.read")
  listUnits(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.store.listUnits(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("units")
  @RequirePermissions("pops.inventory.manage")
  createUnit(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.store.createUnit(user.organizationId, createStoreUnitSchema.parse(body));
  }

  @Get("products")
  @RequirePermissions("pops.read")
  listProducts(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.store.listProducts(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("products")
  @RequirePermissions("pops.inventory.manage")
  createProduct(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.store.createProduct(user.organizationId, createStoreProductSchema.parse(body));
  }

  @Delete("products/:productId")
  @RequirePermissions("pops.inventory.manage")
  deleteProduct(@CurrentUser() user: AccessJwtPayload, @Param("productId") productId: string) {
    return this.store.deleteProduct(user.organizationId, productId);
  }

  @Get("batches")
  @RequirePermissions("pops.read")
  listBatches(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.store.listBatches(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("inventory/movement")
  @RequirePermissions("pops.inventory.manage")
  recordMovement(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.store.recordStockMovement(user.organizationId, stockMovementSchema.parse(body));
  }

  @Get("inventory/transactions")
  @RequirePermissions("pops.read")
  listTransactions(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.store.listInventoryTransactions(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("suppliers")
  @RequirePermissions("pops.read")
  listSuppliers(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.store.listSuppliers(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("suppliers")
  @RequirePermissions("pops.inventory.manage")
  createSupplier(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.store.createSupplier(user.organizationId, createStoreSupplierSchema.parse(body));
  }

  @Get("customers")
  @RequirePermissions("pops.read")
  listCustomers(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.store.listCustomers(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("customers")
  @RequirePermissions("pops.read")
  createCustomer(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.store.createCustomer(user.organizationId, createStoreCustomerSchema.parse(body));
  }

  @Get("warehouses")
  @RequirePermissions("pops.read")
  listWarehouses(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.store.listWarehouses(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("warehouses")
  @RequirePermissions("pops.inventory.manage")
  createWarehouse(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.store.createWarehouse(user.organizationId, createStoreWarehouseSchema.parse(body));
  }

  @Get("purchase/requisitions")
  @RequirePermissions("pops.read")
  listRequisitions(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.store.listPurchaseRequisitions(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("purchase/requisitions")
  @RequirePermissions("pops.inventory.manage")
  createRequisition(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.store.createPurchaseRequisition(user.organizationId, createStorePurchaseRequisitionSchema.parse(body));
  }

  @Get("purchase/orders")
  @RequirePermissions("pops.read")
  listPurchaseOrders(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.store.listPurchaseOrders(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("purchase/orders/:orderId")
  @RequirePermissions("pops.read")
  getPurchaseOrder(@CurrentUser() user: AccessJwtPayload, @Param("orderId") orderId: string) {
    return this.store.getPurchaseOrder(user.organizationId, orderId);
  }

  @Post("purchase/orders")
  @RequirePermissions("pops.inventory.manage")
  createPurchaseOrder(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.store.createPurchaseOrder(user.organizationId, createStorePurchaseOrderSchema.parse(body));
  }

  @Patch("purchase/orders/:orderId/approve")
  @RequirePermissions("pops.inventory.manage")
  approvePurchaseOrder(@CurrentUser() user: AccessJwtPayload, @Param("orderId") orderId: string) {
    return this.store.approvePurchaseOrder(user.organizationId, orderId);
  }

  @Get("purchase/grn")
  @RequirePermissions("pops.read")
  listGrn(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.store.listGrn(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("purchase/grn")
  @RequirePermissions("pops.inventory.manage")
  createGrn(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.store.createGrn(user.organizationId, createStoreGrnSchema.parse(body));
  }

  @Get("transfers")
  @RequirePermissions("pops.read")
  listTransfers(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.store.listStockTransfers(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("transfers")
  @RequirePermissions("pops.inventory.manage")
  createTransfer(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.store.createStockTransfer(user.organizationId, createStoreStockTransferSchema.parse(body));
  }

  @Patch("transfers/:transferId/complete")
  @RequirePermissions("pops.inventory.manage")
  completeTransfer(@CurrentUser() user: AccessJwtPayload, @Param("transferId") transferId: string) {
    return this.store.completeStockTransfer(user.organizationId, transferId);
  }

  @Get("adjustments")
  @RequirePermissions("pops.read")
  listAdjustments(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.store.listStockAdjustments(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("adjustments")
  @RequirePermissions("pops.inventory.manage")
  createAdjustment(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.store.createStockAdjustment(user.organizationId, createStoreStockAdjustmentSchema.parse(body));
  }

  @Patch("adjustments/:adjustmentId/approve")
  @RequirePermissions("pops.inventory.manage")
  approveAdjustment(@CurrentUser() user: AccessJwtPayload, @Param("adjustmentId") adjustmentId: string) {
    return this.store.approveStockAdjustment(user.organizationId, adjustmentId);
  }

  @Get("audits")
  @RequirePermissions("pops.read")
  listAudits(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.store.listStockAudits(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("audits")
  @RequirePermissions("pops.inventory.manage")
  createAudit(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.store.createStockAudit(user.organizationId, createStoreStockAuditSchema.parse(body));
  }

  @Patch("audits/:auditId/approve")
  @RequirePermissions("pops.inventory.manage")
  approveAudit(@CurrentUser() user: AccessJwtPayload, @Param("auditId") auditId: string) {
    return this.store.approveStockAudit(user.organizationId, auditId);
  }

  @Get("sales")
  @RequirePermissions("pops.read")
  listSales(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("status") status?: string,
  ) {
    return this.store.listSales(user.organizationId, branchCode?.trim() ?? "", status?.trim());
  }

  @Post("sales")
  @RequirePermissions("pops.read")
  createSale(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.store.createSale(user.organizationId, createStoreSaleSchema.parse(body));
  }

  @Patch("sales/:saleId/complete")
  @RequirePermissions("pops.read")
  completeHeldSale(@CurrentUser() user: AccessJwtPayload, @Param("saleId") saleId: string, @Body() body: unknown) {
    return this.store.completeHeldSale(user.organizationId, saleId, completeStoreHeldSaleSchema.parse(body));
  }

  @Delete("sales/:saleId")
  @RequirePermissions("pops.read")
  voidHeldSale(@CurrentUser() user: AccessJwtPayload, @Param("saleId") saleId: string) {
    return this.store.voidHeldSale(user.organizationId, saleId);
  }

  @Get("shifts")
  @RequirePermissions("pops.read")
  listShifts(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.store.listShifts(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("shifts/open")
  @RequirePermissions("pops.read")
  getOpenShift(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("terminalId") terminalId?: string,
  ) {
    return this.store.getOpenShift(user.organizationId, branchCode?.trim() ?? "", terminalId?.trim());
  }

  @Post("shifts/open")
  @RequirePermissions("pops.read")
  openShift(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.store.openShift(user.organizationId, openStoreShiftSchema.parse(body));
  }

  @Patch("shifts/:shiftId/close")
  @RequirePermissions("pops.read")
  closeShift(@CurrentUser() user: AccessJwtPayload, @Param("shiftId") shiftId: string, @Body() body: unknown) {
    return this.store.closeShift(user.organizationId, shiftId, closeStoreShiftSchema.parse(body));
  }

  @Get("promotions")
  @RequirePermissions("pops.read")
  listPromotions(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.store.listPromotions(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("promotions")
  @RequirePermissions("pops.inventory.manage")
  createPromotion(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.store.createPromotion(user.organizationId, createStorePromotionSchema.parse(body));
  }

  @Patch("promotions/:promotionId/toggle")
  @RequirePermissions("pops.inventory.manage")
  togglePromotion(
    @CurrentUser() user: AccessJwtPayload,
    @Param("promotionId") promotionId: string,
    @Body() body: { isActive: boolean },
  ) {
    return this.store.togglePromotion(user.organizationId, promotionId, Boolean(body.isActive));
  }

  @Get("pos-shortcuts")
  @RequirePermissions("pops.read")
  listPosShortcuts(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.store.listPosShortcuts(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("pos-shortcuts")
  @RequirePermissions("pops.inventory.manage")
  upsertPosShortcut(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.store.upsertPosShortcut(user.organizationId, upsertStorePosShortcutSchema.parse(body));
  }

  @Delete("pos-shortcuts/:shortcutId")
  @RequirePermissions("pops.inventory.manage")
  deletePosShortcut(@CurrentUser() user: AccessJwtPayload, @Param("shortcutId") shortcutId: string) {
    return this.store.deletePosShortcut(user.organizationId, shortcutId);
  }

  @Get("inventory/sync")
  @RequirePermissions("pops.read")
  syncInventory(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.store.syncInventorySnapshot(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("reports/stock")
  @RequirePermissions("pops.read")
  getStockReport(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.store.getStockReport(user.organizationId, branchCode?.trim() ?? "", from?.trim(), to?.trim());
  }

  @Get("reports/profit-loss")
  @RequirePermissions("pops.read")
  getProfitLoss(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.store.getProfitLoss(user.organizationId, branchCode?.trim() ?? "", from?.trim(), to?.trim());
  }

  @Get("products/lookup")
  @RequirePermissions("pops.read")
  lookupProduct(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("q") q: string,
  ) {
    return this.grocery.lookupProduct(user.organizationId, branchCode?.trim() ?? "", q?.trim() ?? "");
  }

  @Get("customers/:customerId")
  @RequirePermissions("pops.read")
  getCustomerDetail(@CurrentUser() user: AccessJwtPayload, @Param("customerId") customerId: string) {
    return this.grocery.getCustomerDetail(user.organizationId, customerId);
  }

  @Patch("customers/:customerId/tier")
  @RequirePermissions("pops.inventory.manage")
  updateCustomerTier(@CurrentUser() user: AccessJwtPayload, @Param("customerId") customerId: string, @Body() body: unknown) {
    const input = updateStoreCustomerTierSchema.parse(body);
    return this.grocery.updateCustomerTier(user.organizationId, customerId, input.membershipTier);
  }

  @Post("cash-movements")
  @RequirePermissions("pops.read")
  recordCashMovement(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.grocery.recordCashMovement(user.organizationId, createStoreCashMovementSchema.parse(body));
  }

  @Get("cash-movements")
  @RequirePermissions("pops.read")
  listCashMovements(@CurrentUser() user: AccessJwtPayload, @Query("shiftId") shiftId: string) {
    return this.grocery.listCashMovements(user.organizationId, shiftId);
  }

  @Get("coupons")
  @RequirePermissions("pops.read")
  listCoupons(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.grocery.listCoupons(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("coupons")
  @RequirePermissions("pops.inventory.manage")
  createCoupon(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.grocery.createCoupon(user.organizationId, createStoreCouponSchema.parse(body));
  }

  @Post("coupons/validate")
  @RequirePermissions("pops.read")
  validateCoupon(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const input = validateStoreCouponSchema.parse(body);
    return this.grocery.validateCoupon(user.organizationId, input.branchCode, input.code, input.cartTotal);
  }

  @Get("gift-cards")
  @RequirePermissions("pops.read")
  listGiftCards(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.grocery.listGiftCards(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("gift-cards")
  @RequirePermissions("pops.inventory.manage")
  createGiftCard(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.grocery.createGiftCard(user.organizationId, createStoreGiftCardSchema.parse(body));
  }

  @Post("gift-cards/validate")
  @RequirePermissions("pops.read")
  validateGiftCard(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const input = validateStoreGiftCardSchema.parse(body);
    return this.grocery.validateGiftCard(user.organizationId, input.branchCode, input.cardNumber);
  }

  @Get("returns/sales")
  @RequirePermissions("pops.read")
  listSaleReturns(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.grocery.listSaleReturns(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("returns/sales")
  @RequirePermissions("pops.read")
  createSaleReturn(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.grocery.createSaleReturn(user.organizationId, createStoreSaleReturnSchema.parse(body));
  }

  @Get("returns/purchase")
  @RequirePermissions("pops.read")
  listPurchaseReturns(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.grocery.listPurchaseReturns(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("returns/purchase")
  @RequirePermissions("pops.inventory.manage")
  createPurchaseReturn(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.grocery.createPurchaseReturn(user.organizationId, createStorePurchaseReturnSchema.parse(body));
  }

  @Get("reports/peak-hours")
  @RequirePermissions("pops.read")
  getPeakHoursReport(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.grocery.getPeakHoursReport(user.organizationId, branchCode?.trim() ?? "", from?.trim(), to?.trim());
  }

  @Get("reports/employees")
  @RequirePermissions("pops.read")
  getEmployeeReport(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.grocery.getEmployeeReport(user.organizationId, branchCode?.trim() ?? "", from?.trim(), to?.trim());
  }

  @Get("reports/wastage")
  @RequirePermissions("pops.read")
  getWastageReport(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.grocery.getWastageReport(user.organizationId, branchCode?.trim() ?? "", from?.trim(), to?.trim());
  }
}
