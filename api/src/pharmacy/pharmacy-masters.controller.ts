import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { SystemTypeGuard } from "../users/system-type.guard";
import { RequireSystemType } from "../users/require-system-type.decorator";
import { PharmacyMastersService } from "./pharmacy-masters.service";

@Controller("v1/pharmacy")
@UseGuards(JwtAuthGuard, PermissionsGuard, SystemTypeGuard)
@RequireSystemType("pharmacy", "distribution")
export class PharmacyMastersController {
  constructor(private readonly masters: PharmacyMastersService) {}

  private pageFilters(query: Record<string, string | undefined>) {
    return {
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
      q: query.q,
      status: query.status,
      sort: query.sort,
      companyId: query.companyId,
      genericId: query.genericId,
      parentId: query.parentId,
      branchCode: query.branchCode,
    };
  }

  // ─── Overview / data quality ─────────────────────────────────────────────

  @Get("masters/overview")
  @RequirePermissions("distribution.masters", "pharmacy.view", "pops.read")
  overview(@CurrentUser() user: AccessJwtPayload) {
    return this.masters.getMastersOverview(user.organizationId);
  }

  @Get("masters/data-quality")
  @RequirePermissions("distribution.masters", "pharmacy.view", "pops.read")
  dataQuality(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode?: string) {
    return this.masters.getMasterDataQuality(user.organizationId, branchCode);
  }

  // ─── Generics ────────────────────────────────────────────────────────────

  @Get("masters/generics")
  @RequirePermissions("distribution.masters", "pharmacy.view", "pops.read")
  listGenerics(@CurrentUser() user: AccessJwtPayload, @Query() query: Record<string, string | undefined>) {
    return this.masters.listGenerics(user.organizationId, this.pageFilters(query));
  }

  @Post("masters/generics")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  createGeneric(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.masters.createGeneric(user.organizationId, body as never, user.sub);
  }

  @Patch("masters/generics/:id")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  updateGeneric(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.masters.updateGeneric(user.organizationId, id, body as never, user.sub);
  }

  @Post("masters/generics/:id/status")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  setGenericStatus(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: { status: string },
  ) {
    return this.masters.setGenericStatus(user.organizationId, id, body.status, user.sub);
  }

  // ─── Brands ──────────────────────────────────────────────────────────────

  @Get("masters/brands")
  @RequirePermissions("distribution.masters", "pharmacy.view", "pops.read")
  listBrands(@CurrentUser() user: AccessJwtPayload, @Query() query: Record<string, string | undefined>) {
    return this.masters.listBrands(user.organizationId, this.pageFilters(query));
  }

  @Post("masters/brands")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  createBrand(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.masters.createBrand(user.organizationId, body as never, user.sub);
  }

  @Patch("masters/brands/:id")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  updateBrand(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.masters.updateBrand(user.organizationId, id, body as never, user.sub);
  }

  @Post("masters/brands/:id/status")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  setBrandStatus(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: { status: string },
  ) {
    return this.masters.setBrandStatus(user.organizationId, id, body.status, user.sub);
  }

  // ─── Categories ──────────────────────────────────────────────────────────

  @Get("masters/categories")
  @RequirePermissions("distribution.masters", "pharmacy.view", "pops.read")
  listCategories(@CurrentUser() user: AccessJwtPayload, @Query() query: Record<string, string | undefined>) {
    return this.masters.listCategories(user.organizationId, this.pageFilters(query));
  }

  @Post("masters/categories")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  createCategory(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.masters.createCategory(user.organizationId, body as never, user.sub);
  }

  @Patch("masters/categories/:id")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  updateCategory(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.masters.updateCategory(user.organizationId, id, body as never, user.sub);
  }

  @Post("masters/categories/:id/status")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  setCategoryStatus(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: { status: string },
  ) {
    return this.masters.setCategoryStatus(user.organizationId, id, body.status, user.sub);
  }

  // ─── Dosage forms ────────────────────────────────────────────────────────

  @Get("masters/dosage-forms")
  @RequirePermissions("distribution.masters", "pharmacy.view", "pops.read")
  listDosageForms(@CurrentUser() user: AccessJwtPayload, @Query() query: Record<string, string | undefined>) {
    return this.masters.listDosageForms(user.organizationId, this.pageFilters(query));
  }

  @Post("masters/dosage-forms")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  createDosageForm(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.masters.createDosageForm(user.organizationId, body as never, user.sub);
  }

  @Patch("masters/dosage-forms/:id")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  updateDosageForm(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.masters.updateDosageForm(user.organizationId, id, body as never, user.sub);
  }

  @Post("masters/dosage-forms/:id/status")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  setDosageFormStatus(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: { status: string },
  ) {
    return this.masters.setDosageFormStatus(user.organizationId, id, body.status, user.sub);
  }

  // ─── Units ───────────────────────────────────────────────────────────────

  @Get("masters/units")
  @RequirePermissions("distribution.masters", "pharmacy.view", "pops.read")
  listUnits(@CurrentUser() user: AccessJwtPayload, @Query() query: Record<string, string | undefined>) {
    return this.masters.listUnits(user.organizationId, this.pageFilters(query));
  }

  @Post("masters/units")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  createUnit(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.masters.createUnit(user.organizationId, body as never, user.sub);
  }

  @Patch("masters/units/:id")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  updateUnit(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.masters.updateUnit(user.organizationId, id, body as never, user.sub);
  }

  @Post("masters/units/:id/status")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  setUnitStatus(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: { status: string },
  ) {
    return this.masters.setUnitStatus(user.organizationId, id, body.status, user.sub);
  }

  // ─── Tax profiles ────────────────────────────────────────────────────────

  @Get("masters/tax-profiles")
  @RequirePermissions("distribution.masters", "pharmacy.view", "pops.read")
  listTaxProfiles(@CurrentUser() user: AccessJwtPayload, @Query() query: Record<string, string | undefined>) {
    return this.masters.listTaxProfiles(user.organizationId, this.pageFilters(query));
  }

  @Post("masters/tax-profiles")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  createTaxProfile(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.masters.createTaxProfile(user.organizationId, body as never, user.sub);
  }

  @Patch("masters/tax-profiles/:id")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  updateTaxProfile(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.masters.updateTaxProfile(user.organizationId, id, body as never, user.sub);
  }

  @Post("masters/tax-profiles/:id/status")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  setTaxProfileStatus(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: { status: string },
  ) {
    return this.masters.setTaxProfileStatus(user.organizationId, id, body.status, user.sub);
  }

  // ─── Medicines (masters hub) ─────────────────────────────────────────────

  @Get("masters/medicines")
  @RequirePermissions("distribution.masters", "pharmacy.view", "pops.read")
  listMedicines(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.masters.listMedicinesPaged(user.organizationId, branchCode?.trim() ?? "", this.pageFilters(query));
  }

  @Get("masters/medicines/:id")
  @RequirePermissions("distribution.masters", "pharmacy.view", "pops.read")
  getMedicine(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.masters.getMedicineDetail(user.organizationId, id);
  }

  @Patch("masters/medicines/:id")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  updateMedicine(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.masters.updateMedicineMasters(user.organizationId, id, body as Record<string, unknown>, user.sub);
  }

  @Post("masters/medicines/:id/status")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  setMedicineStatus(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: { status: string },
  ) {
    return this.masters.setMedicineStatus(user.organizationId, id, body.status, user.sub);
  }

  // ─── Sales force update/status ───────────────────────────────────────────

  @Patch("sales-force/:id")
  @RequirePermissions("distribution.field", "distribution.masters", "pops.inventory.manage")
  updateSalesForce(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.masters.updateSalesForce(user.organizationId, id, body as never, user.sub);
  }

  @Post("sales-force/:id/status")
  @RequirePermissions("distribution.field", "distribution.masters", "pops.inventory.manage")
  setSalesForceStatus(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: { status: string },
  ) {
    return this.masters.setSalesForceStatus(user.organizationId, id, body.status, user.sub);
  }

  // ─── Price lists / schemes ───────────────────────────────────────────────

  @Patch("pricing/lists/:id")
  @RequirePermissions("distribution.pricing", "pops.inventory.manage")
  updatePriceList(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.masters.updatePriceList(user.organizationId, id, body as never, user.sub);
  }

  @Get("pricing/lists/:id/items")
  @RequirePermissions("distribution.pricing", "pharmacy.view", "pops.read")
  listPriceListItems(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.masters.listPriceListItems(user.organizationId, id);
  }

  @Post("pricing/lists/:id/items")
  @RequirePermissions("distribution.pricing", "pops.inventory.manage")
  upsertPriceListItems(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: { items: { medicineId: string; unitPricePkr: number; minQty?: number }[] },
  ) {
    return this.masters.upsertPriceListItems(user.organizationId, id, body.items ?? [], user.sub);
  }

  @Patch("pricing/schemes/:id")
  @RequirePermissions("distribution.pricing", "pops.inventory.manage")
  updateScheme(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.masters.updateScheme(user.organizationId, id, body as never, user.sub);
  }
}
