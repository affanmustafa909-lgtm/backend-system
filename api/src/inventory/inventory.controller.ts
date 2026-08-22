import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  completeStockCountSchema,
  createGoodsReceiptSchema,
  createIngredientSchema,
  createInventoryCategorySchema,
  createPurchaseOrderSchema,
  createRecipeSchema,
  createStockAdjustmentSchema,
  createStockCountSchema,
  createSupplierSchema,
  createWasteRecordSchema,
  createProductionBatchSchema,
  updateAdjustmentStatusSchema,
  updateIngredientSchema,
  updateInventoryCategorySchema,
  updatePurchaseOrderStatusSchema,
  updatePurchaseOrderSchema,
  updateRecipeSchema,
  updateStockCountLineSchema,
  updateSupplierSchema,
  updateWasteStatusSchema,
} from "@platform/contracts";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { InventoryService } from "./inventory.service";

@Controller("v1/inventory")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get("dashboard")
  @RequirePermissions("pops.read")
  getDashboard(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.inventory.getDashboard(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get()
  @RequirePermissions("pops.read")
  getBranchInventory(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.inventory.getBranchInventory(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("reports/:reportId")
  @RequirePermissions("pops.read")
  getReport(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Param("reportId") reportId: string,
    @Query("filterDate") filterDate?: string,
    @Query("dateMode") dateMode?: string,
  ) {
    return this.inventory.getReport(user.organizationId, branchCode?.trim() ?? "", reportId, {
      filterDate: filterDate?.trim() || undefined,
      dateMode: dateMode?.trim() as "activity" | "expiry" | "order" | undefined,
    });
  }

  @Post("categories")
  @RequirePermissions("pops.inventory.manage")
  createCategory(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.inventory.createCategory(
      user.organizationId,
      user.sub,
      createInventoryCategorySchema.parse(body),
    );
  }

  @Patch("categories/:categoryId")
  @RequirePermissions("pops.inventory.manage")
  updateCategory(
    @CurrentUser() user: AccessJwtPayload,
    @Param("categoryId") categoryId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.updateCategory(
      user.organizationId,
      user.sub,
      categoryId,
      updateInventoryCategorySchema.parse(body),
    );
  }

  @Delete("categories/:categoryId")
  @RequirePermissions("pops.inventory.manage")
  deleteCategory(@CurrentUser() user: AccessJwtPayload, @Param("categoryId") categoryId: string) {
    return this.inventory.deleteCategory(user.organizationId, user.sub, categoryId);
  }

  @Post("ingredients")
  @RequirePermissions("pops.inventory.manage")
  createIngredient(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.inventory.createIngredient(
      user.organizationId,
      user.sub,
      createIngredientSchema.parse(body),
    );
  }

  @Patch("ingredients/:ingredientId")
  @RequirePermissions("pops.inventory.manage")
  updateIngredient(
    @CurrentUser() user: AccessJwtPayload,
    @Param("ingredientId") ingredientId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.updateIngredient(
      user.organizationId,
      user.sub,
      ingredientId,
      updateIngredientSchema.parse(body),
    );
  }

  @Delete("ingredients/:ingredientId")
  @RequirePermissions("pops.inventory.manage")
  deleteIngredient(@CurrentUser() user: AccessJwtPayload, @Param("ingredientId") ingredientId: string) {
    return this.inventory.deleteIngredient(user.organizationId, user.sub, ingredientId);
  }

  @Post("suppliers")
  @RequirePermissions("pops.inventory.manage")
  createSupplier(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.inventory.createSupplier(
      user.organizationId,
      user.sub,
      createSupplierSchema.parse(body),
    );
  }

  @Patch("suppliers/:supplierId")
  @RequirePermissions("pops.inventory.manage")
  updateSupplier(
    @CurrentUser() user: AccessJwtPayload,
    @Param("supplierId") supplierId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.updateSupplier(
      user.organizationId,
      user.sub,
      supplierId,
      updateSupplierSchema.parse(body),
    );
  }

  @Delete("suppliers/:supplierId")
  @RequirePermissions("pops.inventory.manage")
  deleteSupplier(@CurrentUser() user: AccessJwtPayload, @Param("supplierId") supplierId: string) {
    return this.inventory.deleteSupplier(user.organizationId, user.sub, supplierId);
  }

  @Post("purchase-orders")
  @RequirePermissions("pops.inventory.manage")
  createPurchaseOrder(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.inventory.createPurchaseOrder(
      user.organizationId,
      user.sub,
      createPurchaseOrderSchema.parse(body),
    );
  }

  @Patch("purchase-orders/:poId/status")
  @RequirePermissions("pops.inventory.manage")
  updatePurchaseOrderStatus(
    @CurrentUser() user: AccessJwtPayload,
    @Param("poId") poId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.updatePurchaseOrderStatus(
      user.organizationId,
      user.sub,
      poId,
      updatePurchaseOrderStatusSchema.parse(body),
    );
  }

  @Patch("purchase-orders/:poId")
  @RequirePermissions("pops.inventory.manage")
  updatePurchaseOrder(
    @CurrentUser() user: AccessJwtPayload,
    @Param("poId") poId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.updatePurchaseOrder(
      user.organizationId,
      user.sub,
      poId,
      updatePurchaseOrderSchema.parse(body),
    );
  }

  @Post("goods-receipts")
  @RequirePermissions("pops.inventory.manage")
  createGoodsReceipt(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.inventory.createGoodsReceipt(
      user.organizationId,
      user.sub,
      createGoodsReceiptSchema.parse(body),
    );
  }

  @Post("recipes")
  @RequirePermissions("pops.inventory.manage")
  createRecipe(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.inventory.createRecipe(user.organizationId, user.sub, createRecipeSchema.parse(body));
  }

  @Patch("recipes/:recipeId")
  @RequirePermissions("pops.inventory.manage")
  updateRecipe(
    @CurrentUser() user: AccessJwtPayload,
    @Param("recipeId") recipeId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.updateRecipe(
      user.organizationId,
      user.sub,
      recipeId,
      updateRecipeSchema.parse(body),
    );
  }

  @Delete("recipes/:recipeId")
  @RequirePermissions("pops.inventory.manage")
  deleteRecipe(@CurrentUser() user: AccessJwtPayload, @Param("recipeId") recipeId: string) {
    return this.inventory.deleteRecipe(user.organizationId, user.sub, recipeId);
  }

  @Post("adjustments")
  @RequirePermissions("pops.inventory.manage")
  createAdjustment(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.inventory.createAdjustment(
      user.organizationId,
      user.sub,
      createStockAdjustmentSchema.parse(body),
    );
  }

  @Patch("adjustments/:adjustmentId/status")
  @RequirePermissions("pops.inventory.manage")
  updateAdjustmentStatus(
    @CurrentUser() user: AccessJwtPayload,
    @Param("adjustmentId") adjustmentId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.updateAdjustmentStatus(
      user.organizationId,
      user.sub,
      adjustmentId,
      updateAdjustmentStatusSchema.parse(body),
    );
  }

  @Post("waste")
  @RequirePermissions("pops.inventory.manage")
  createWaste(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.inventory.createWaste(user.organizationId, user.sub, createWasteRecordSchema.parse(body));
  }

  @Patch("waste/:wasteId/status")
  @RequirePermissions("pops.inventory.manage")
  updateWasteStatus(
    @CurrentUser() user: AccessJwtPayload,
    @Param("wasteId") wasteId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.updateWasteStatus(
      user.organizationId,
      user.sub,
      wasteId,
      updateWasteStatusSchema.parse(body),
    );
  }

  @Post("stock-counts")
  @RequirePermissions("pops.inventory.manage")
  createStockCount(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.inventory.createStockCount(
      user.organizationId,
      user.sub,
      createStockCountSchema.parse(body),
    );
  }

  @Patch("stock-counts/:countId/lines")
  @RequirePermissions("pops.inventory.manage")
  updateStockCountLine(
    @CurrentUser() user: AccessJwtPayload,
    @Param("countId") countId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.updateStockCountLine(
      user.organizationId,
      user.sub,
      countId,
      updateStockCountLineSchema.parse(body),
    );
  }

  @Post("stock-counts/:countId/complete")
  @RequirePermissions("pops.inventory.manage")
  completeStockCount(
    @CurrentUser() user: AccessJwtPayload,
    @Param("countId") countId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.completeStockCount(
      user.organizationId,
      user.sub,
      countId,
      completeStockCountSchema.parse(body),
    );
  }

  @Get("production")
  @RequirePermissions("pops.read")
  listProduction(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.inventory.listProductionBatches(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("production")
  @RequirePermissions("pops.inventory.manage")
  createProduction(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.inventory.createProductionBatch(
      user.organizationId,
      user.sub,
      createProductionBatchSchema.parse(body),
    );
  }

  @Post("production/:batchId/post")
  @RequirePermissions("pops.inventory.manage")
  postProduction(@CurrentUser() user: AccessJwtPayload, @Param("batchId") batchId: string) {
    return this.inventory.postProductionBatch(user.organizationId, user.sub, batchId);
  }
}
