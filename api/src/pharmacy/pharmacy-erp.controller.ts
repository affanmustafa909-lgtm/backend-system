import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createPharmacyCompanySchema,
  createPharmacyDistOrderSchema,
  createPharmacyGrnSchema,
  createPharmacyPurchaseOrderSchema,
  createPharmacySaleReturnSchema,
  createPharmacyTradeCustomerSchema,
  createPharmacyWarehouseSchema,
  PHARMACY_CODE_CATALOG,
  resolvePharmacyPriceSchema,
} from "@platform/contracts";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { SystemTypeGuard } from "../users/system-type.guard";
import { RequireSystemType } from "../users/require-system-type.decorator";
import { PharmacyDashboardService } from "./pharmacy-dashboard.service";
import { PharmacyErpService } from "./pharmacy-erp.service";
import { PharmacyMastersService } from "./pharmacy-masters.service";

@Controller("v1/pharmacy")
@UseGuards(JwtAuthGuard, PermissionsGuard, SystemTypeGuard)
@RequireSystemType("pharmacy", "distribution")
export class PharmacyErpController {
  constructor(
    private readonly erp: PharmacyErpService,
    private readonly dashboard: PharmacyDashboardService,
    private readonly masters: PharmacyMastersService,
  ) {}

  @Get("lookup")
  @RequirePermissions("pharmacy.view", "pops.read")
  lookup(
    @CurrentUser() user: AccessJwtPayload,
    @Query("q") q: string,
    @Query("branchCode") branchCode?: string,
  ) {
    return this.erp.lookupByCode(user.organizationId, branchCode?.trim() ?? "", q ?? "");
  }

  @Get("code-catalog")
  @RequirePermissions("pharmacy.view", "pops.read")
  codeCatalog() {
    return { prefixes: PHARMACY_CODE_CATALOG };
  }

  @Get("companies")
  @RequirePermissions("distribution.masters", "pharmacy.view", "pops.read")
  listCompanies(
    @CurrentUser() user: AccessJwtPayload,
    @Query("q") q?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("status") status?: string,
  ) {
    if (page || pageSize || q || status) {
      return this.masters.listCompaniesPaged(user.organizationId, {
        q,
        status,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      });
    }
    return this.erp.listCompanies(user.organizationId);
  }

  @Post("companies")
  @RequirePermissions("distribution.masters", "pops.inventory.manage")
  createCompany(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.erp.createCompany(user.organizationId, createPharmacyCompanySchema.parse(body));
  }

  @Patch("companies/:id")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  updateCompany(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.masters.updateCompany(user.organizationId, id, body as Record<string, unknown>, user.sub);
  }

  @Post("companies/:id/status")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  setCompanyStatus(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: { status: string },
  ) {
    return this.masters.setCompanyStatus(user.organizationId, id, body.status, user.sub);
  }

  @Get("warehouses")
  @RequirePermissions("pharmacy.inventory.view", "pharmacy.view", "pops.read")
  listWarehouses(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("q") q?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("status") status?: string,
  ) {
    if (page || pageSize || q || status) {
      return this.masters.listWarehousesPaged(user.organizationId, {
        branchCode: branchCode?.trim(),
        q,
        status,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      });
    }
    return this.erp.listWarehouses(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("warehouses")
  @RequirePermissions("pharmacy.inventory.manage", "pops.inventory.manage")
  createWarehouse(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.erp.createWarehouse(user.organizationId, createPharmacyWarehouseSchema.parse(body));
  }

  @Patch("warehouses/:id")
  @RequirePermissions("pharmacy.inventory.manage", "pops.inventory.manage")
  updateWarehouse(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.masters.updateWarehouse(user.organizationId, id, body as Record<string, unknown>, user.sub);
  }

  @Post("warehouses/:id/status")
  @RequirePermissions("pharmacy.inventory.manage", "pops.inventory.manage")
  setWarehouseStatus(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: { status: string },
  ) {
    return this.masters.setWarehouseStatus(user.organizationId, id, body.status, user.sub);
  }

  @Get("territories")
  @RequirePermissions("distribution.masters", "pharmacy.view", "pops.read")
  listTerritories(@CurrentUser() user: AccessJwtPayload) {
    return this.erp.listTerritories(user.organizationId);
  }

  @Post("territories")
  @RequirePermissions("distribution.masters", "pops.inventory.manage")
  createTerritory(@CurrentUser() user: AccessJwtPayload, @Body() body: { code: string; name: string; region?: string }) {
    return this.erp.createTerritory(user.organizationId, body);
  }

  @Get("cities")
  @RequirePermissions("distribution.masters", "pharmacy.view", "pops.read")
  listCities(@CurrentUser() user: AccessJwtPayload) {
    return this.erp.listCities(user.organizationId);
  }

  @Post("cities")
  @RequirePermissions("distribution.masters", "pops.inventory.manage")
  createCity(
    @CurrentUser() user: AccessJwtPayload,
    @Body() body: { code: string; name: string; territoryId?: string; districtId?: string },
  ) {
    return this.erp.createCity(user.organizationId, body);
  }

  @Get("provinces")
  @RequirePermissions("distribution.masters", "pharmacy.view", "pops.read")
  listProvinces(@CurrentUser() user: AccessJwtPayload) {
    return this.erp.listProvinces(user.organizationId);
  }

  @Post("provinces")
  @RequirePermissions("distribution.masters", "pops.inventory.manage")
  createProvince(@CurrentUser() user: AccessJwtPayload, @Body() body: { code: string; name: string }) {
    return this.erp.createProvince(user.organizationId, body);
  }

  @Get("divisions")
  @RequirePermissions("distribution.masters", "pharmacy.view", "pops.read")
  listDivisions(@CurrentUser() user: AccessJwtPayload) {
    return this.erp.listDivisions(user.organizationId);
  }

  @Post("divisions")
  @RequirePermissions("distribution.masters", "pops.inventory.manage")
  createDivision(
    @CurrentUser() user: AccessJwtPayload,
    @Body() body: { provinceId: string; code: string; name: string },
  ) {
    return this.erp.createDivision(user.organizationId, body);
  }

  @Get("districts")
  @RequirePermissions("distribution.masters", "pharmacy.view", "pops.read")
  listDistricts(@CurrentUser() user: AccessJwtPayload) {
    return this.erp.listDistricts(user.organizationId);
  }

  @Post("districts")
  @RequirePermissions("distribution.masters", "pops.inventory.manage")
  createDistrict(
    @CurrentUser() user: AccessJwtPayload,
    @Body() body: { divisionId: string; code: string; name: string },
  ) {
    return this.erp.createDistrict(user.organizationId, body);
  }

  @Get("geo-territories")
  @RequirePermissions("distribution.masters", "pharmacy.view", "pops.read")
  listGeoTerritories(@CurrentUser() user: AccessJwtPayload) {
    return this.erp.listGeoTerritories(user.organizationId);
  }

  @Post("geo-territories")
  @RequirePermissions("distribution.masters", "pops.inventory.manage")
  createGeoTerritory(
    @CurrentUser() user: AccessJwtPayload,
    @Body() body: { areaId: string; code: string; name: string; managerEmployeeId?: string },
  ) {
    return this.erp.createGeoTerritory(user.organizationId, body);
  }

  @Get("areas")
  @RequirePermissions("distribution.masters", "pharmacy.view", "pops.read")
  listAreas(@CurrentUser() user: AccessJwtPayload) {
    return this.erp.listAreas(user.organizationId);
  }

  @Post("areas")
  @RequirePermissions("distribution.masters", "pops.inventory.manage")
  createArea(
    @CurrentUser() user: AccessJwtPayload,
    @Body()
    body: {
      cityId: string;
      code: string;
      name: string;
      sector?: string;
      market?: string;
      isOutstation?: boolean;
    },
  ) {
    return this.erp.createArea(user.organizationId, body);
  }

  @Get("routes")
  @RequirePermissions("distribution.masters", "pharmacy.view", "pops.read")
  listRoutes(@CurrentUser() user: AccessJwtPayload) {
    return this.erp.listRoutes(user.organizationId);
  }

  @Post("routes")
  @RequirePermissions("distribution.masters", "pops.inventory.manage")
  createRoute(
    @CurrentUser() user: AccessJwtPayload,
    @Body()
    body: {
      areaId: string;
      code: string;
      name: string;
      station?: string;
      sequenceNo?: number;
      pjpDayOfWeek?: number | null;
      geoTerritoryId?: string;
    },
  ) {
    return this.erp.createRoute(user.organizationId, body);
  }

  @Get("trade-customers")
  @RequirePermissions("distribution.masters", "pharmacy.view", "pops.read")
  listTradeCustomers(
    @CurrentUser() user: AccessJwtPayload,
    @Query("q") q?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("status") status?: string,
  ) {
    if (page || pageSize || q || status) {
      return this.masters.listTradeCustomersPaged(user.organizationId, {
        q,
        status,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      });
    }
    return this.erp.listTradeCustomers(user.organizationId);
  }

  @Get("trade-customers/:id/ledger")
  @RequirePermissions("distribution.masters", "pharmacy.view", "pops.read")
  tradeCustomerLedger(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.erp.getTradeCustomerLedger(user.organizationId, id);
  }

  @Post("trade-customers")
  @RequirePermissions("distribution.masters", "pops.inventory.manage")
  createTradeCustomer(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.erp.createTradeCustomer(user.organizationId, createPharmacyTradeCustomerSchema.parse(body));
  }

  @Patch("trade-customers/:id")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  updateTradeCustomer(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.masters.updateTradeCustomer(user.organizationId, id, body as Record<string, unknown>, user.sub);
  }

  @Post("trade-customers/:id/status")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  setTradeCustomerStatus(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: { status: string },
  ) {
    return this.masters.setTradeCustomerStatus(user.organizationId, id, body.status, user.sub);
  }

  @Get("employees-picker")
  @RequirePermissions("distribution.field", "pharmacy.view", "pops.read")
  employeesPicker(@CurrentUser() user: AccessJwtPayload) {
    return this.erp.listEmployeesForPicker(user.organizationId);
  }

  @Get("sales-force")
  @RequirePermissions("distribution.field", "distribution.masters", "pops.read")
  listSalesForce(@CurrentUser() user: AccessJwtPayload) {
    return this.erp.listSalesForce(user.organizationId);
  }

  @Post("sales-force")
  @RequirePermissions("distribution.field", "distribution.masters", "pops.inventory.manage")
  createSalesForce(
    @CurrentUser() user: AccessJwtPayload,
    @Body()
    body: {
      employeeId: string;
      fieldRole?: string;
      territoryId?: string;
      cityId?: string;
      areaId?: string;
    },
  ) {
    return this.erp.createSalesForceProfile(user.organizationId, body);
  }

  @Get("purchase-orders")
  @RequirePermissions("purchase.view", "purchase.order", "pharmacy.purchase.view", "pharmacy.view", "pops.read")
  listPurchaseOrders(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode?: string) {
    return this.erp.listPurchaseOrders(user.organizationId, branchCode?.trim());
  }

  @Post("purchase-orders")
  @RequirePermissions("purchase.order", "pharmacy.purchase.manage", "pops.inventory.manage")
  createPurchaseOrder(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.erp.createPurchaseOrder(
      user.organizationId,
      createPharmacyPurchaseOrderSchema.parse(body),
      user.sub,
    );
  }

  @Post("purchase-orders/:id/approve")
  @RequirePermissions("purchase.order.approve", "pharmacy.purchase.manage", "pops.inventory.manage")
  approvePurchaseOrder(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.erp.approvePurchaseOrder(user.organizationId, id);
  }

  @Get("grns")
  @RequirePermissions("purchase.view", "purchase.grn", "pharmacy.purchase.view", "pharmacy.view", "pops.read")
  listGrns(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode?: string) {
    return this.erp.listGrns(user.organizationId, branchCode?.trim());
  }

  @Post("grns")
  @RequirePermissions("purchase.grn", "purchase.grn.post", "pharmacy.purchase.manage", "pops.inventory.manage")
  createGrn(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    // `idempotencyKey` is not part of the GRN contract, so it is read off the raw
    // body: callers that omit it keep the exact pre-Phase-4 behaviour.
    const rawKey = (body as { idempotencyKey?: unknown })?.idempotencyKey;
    return this.erp.createGrn(
      user.organizationId,
      {
        ...createPharmacyGrnSchema.parse(body),
        ...(typeof rawKey === "string" && rawKey.trim() ? { idempotencyKey: rawKey.trim() } : {}),
      },
      user.sub,
    );
  }

  @Get("sales/returns")
  @RequirePermissions("pharmacy.sale.return", "pharmacy.view", "pops.read")
  listSaleReturns(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode?: string) {
    return this.erp.listSaleReturns(user.organizationId, branchCode?.trim());
  }

  @Post("sales/returns")
  @RequirePermissions("pharmacy.sale.return", "pops.inventory.manage")
  createSaleReturn(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.erp.createSaleReturn(
      user.organizationId,
      createPharmacySaleReturnSchema.parse(body),
      user.sub,
    );
  }

  @Get("purchase-returns")
  @RequirePermissions("purchase.view", "purchase.return", "pharmacy.purchase.view", "pharmacy.view", "pops.read")
  listPurchaseReturns(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode?: string) {
    return this.erp.listPurchaseReturns(user.organizationId, branchCode?.trim());
  }

  @Post("purchase-returns")
  @RequirePermissions("purchase.return", "pharmacy.purchase.manage", "pops.inventory.manage")
  createPurchaseReturn(
    @CurrentUser() user: AccessJwtPayload,
    @Body()
    body: {
      branchCode: string;
      warehouseId?: string;
      supplierId?: string;
      grnId?: string;
      reason?: string;
      lines: { medicineId: string; batchId?: string; quantity: number; unitCostPkr?: number }[];
    },
  ) {
    return this.erp.createPurchaseReturn(user.organizationId, body, user.sub);
  }

  @Get("distribution/orders")
  @RequirePermissions("distribution.orders", "pharmacy.view", "pops.read")
  listDistOrders(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode?: string) {
    return this.erp.listDistOrders(user.organizationId, branchCode?.trim());
  }

  @Get("distribution/invoices")
  @RequirePermissions("distribution.orders", "pharmacy.view", "pops.read")
  listDistInvoices(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode?: string) {
    return this.erp.listDistInvoices(user.organizationId, branchCode?.trim());
  }

  @Post("distribution/orders")
  @RequirePermissions("distribution.orders", "pops.inventory.manage")
  createDistOrder(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.erp.createDistOrder(user.organizationId, createPharmacyDistOrderSchema.parse(body), user.sub);
  }

  @Post("distribution/orders/:id/approve")
  @RequirePermissions("distribution.orders", "pops.inventory.manage")
  approveDistOrder(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.erp.approveDistOrder(user.organizationId, id);
  }

  @Post("distribution/orders/:id/invoice")
  @RequirePermissions("distribution.orders", "pops.inventory.manage")
  invoiceDistOrder(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.erp.invoiceFromOrder(user.organizationId, id, user.sub);
  }

  @Post("distribution/orders/:id/advance")
  @RequirePermissions("distribution.orders", "pops.inventory.manage")
  advanceDistOrder(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: { status: string },
  ) {
    return this.erp.advanceDistOrderStatus(user.organizationId, id, body.status, user.sub);
  }

  @Get("distribution/ps-window")
  @RequirePermissions("distribution.orders", "pharmacy.view", "pops.read")
  psWindow(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode?: string) {
    return this.erp.getDistributionPsWindow(user.organizationId, branchCode?.trim());
  }

  @Get("distribution/ps-window/widgets")
  @RequirePermissions("distribution.orders", "pharmacy.view", "pops.read")
  psWidgets(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode?: string) {
    return this.erp.getDistributionPsWidgets(user.organizationId, branchCode?.trim());
  }

  private dashboardFilters(query: {
    branchCode?: string;
    warehouseId?: string;
    companyId?: string;
    salesmanId?: string;
    territoryId?: string;
    routeId?: string;
    from?: string;
    to?: string;
    preset?: string;
    limit?: string;
  }) {
    return {
      branchCode: query.branchCode?.trim() || undefined,
      warehouseId: query.warehouseId?.trim() || undefined,
      companyId: query.companyId?.trim() || undefined,
      salesmanId: query.salesmanId?.trim() || undefined,
      territoryId: query.territoryId?.trim() || undefined,
      routeId: query.routeId?.trim() || undefined,
      from: query.from?.trim() || undefined,
      to: query.to?.trim() || undefined,
      preset: query.preset?.trim() || undefined,
      limit: query.limit != null && query.limit !== "" ? Number(query.limit) : undefined,
    };
  }

  @Get("distribution/dashboard/summary")
  @RequirePermissions("distribution.orders", "pharmacy.view", "pops.read")
  dashboardSummary(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode?: string,
    @Query("warehouseId") warehouseId?: string,
    @Query("companyId") companyId?: string,
    @Query("salesmanId") salesmanId?: string,
    @Query("territoryId") territoryId?: string,
    @Query("routeId") routeId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("preset") preset?: string,
    @Query("limit") limit?: string,
  ) {
    return this.dashboard.summary(
      user.organizationId,
      this.dashboardFilters({
        branchCode,
        warehouseId,
        companyId,
        salesmanId,
        territoryId,
        routeId,
        from,
        to,
        preset,
        limit,
      }),
    );
  }

  @Get("distribution/dashboard/sales-trend")
  @RequirePermissions("distribution.orders", "pharmacy.view", "pops.read")
  dashboardSalesTrend(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode?: string,
    @Query("warehouseId") warehouseId?: string,
    @Query("companyId") companyId?: string,
    @Query("salesmanId") salesmanId?: string,
    @Query("territoryId") territoryId?: string,
    @Query("routeId") routeId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("preset") preset?: string,
    @Query("limit") limit?: string,
  ) {
    return this.dashboard.salesTrend(
      user.organizationId,
      this.dashboardFilters({
        branchCode,
        warehouseId,
        companyId,
        salesmanId,
        territoryId,
        routeId,
        from,
        to,
        preset,
        limit,
      }),
    );
  }

  @Get("distribution/dashboard/top-products")
  @RequirePermissions("distribution.orders", "pharmacy.view", "pops.read")
  dashboardTopProducts(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode?: string,
    @Query("warehouseId") warehouseId?: string,
    @Query("companyId") companyId?: string,
    @Query("salesmanId") salesmanId?: string,
    @Query("territoryId") territoryId?: string,
    @Query("routeId") routeId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("preset") preset?: string,
    @Query("limit") limit?: string,
  ) {
    return this.dashboard.topProducts(
      user.organizationId,
      this.dashboardFilters({
        branchCode,
        warehouseId,
        companyId,
        salesmanId,
        territoryId,
        routeId,
        from,
        to,
        preset,
        limit,
      }),
    );
  }

  @Get("distribution/dashboard/top-customers")
  @RequirePermissions("distribution.orders", "pharmacy.view", "pops.read")
  dashboardTopCustomers(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode?: string,
    @Query("warehouseId") warehouseId?: string,
    @Query("companyId") companyId?: string,
    @Query("salesmanId") salesmanId?: string,
    @Query("territoryId") territoryId?: string,
    @Query("routeId") routeId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("preset") preset?: string,
    @Query("limit") limit?: string,
  ) {
    return this.dashboard.topCustomers(
      user.organizationId,
      this.dashboardFilters({
        branchCode,
        warehouseId,
        companyId,
        salesmanId,
        territoryId,
        routeId,
        from,
        to,
        preset,
        limit,
      }),
    );
  }

  @Get("distribution/dashboard/company-performance")
  @RequirePermissions("distribution.orders", "pharmacy.view", "pops.read")
  dashboardCompanyPerformance(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode?: string,
    @Query("warehouseId") warehouseId?: string,
    @Query("companyId") companyId?: string,
    @Query("salesmanId") salesmanId?: string,
    @Query("territoryId") territoryId?: string,
    @Query("routeId") routeId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("preset") preset?: string,
    @Query("limit") limit?: string,
  ) {
    return this.dashboard.companyPerformance(
      user.organizationId,
      this.dashboardFilters({
        branchCode,
        warehouseId,
        companyId,
        salesmanId,
        territoryId,
        routeId,
        from,
        to,
        preset,
        limit,
      }),
    );
  }

  @Get("distribution/dashboard/salesmen")
  @RequirePermissions("distribution.orders", "pharmacy.view", "pops.read")
  dashboardSalesmen(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode?: string,
    @Query("warehouseId") warehouseId?: string,
    @Query("companyId") companyId?: string,
    @Query("salesmanId") salesmanId?: string,
    @Query("territoryId") territoryId?: string,
    @Query("routeId") routeId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("preset") preset?: string,
    @Query("limit") limit?: string,
  ) {
    return this.dashboard.salesmen(
      user.organizationId,
      this.dashboardFilters({
        branchCode,
        warehouseId,
        companyId,
        salesmanId,
        territoryId,
        routeId,
        from,
        to,
        preset,
        limit,
      }),
    );
  }

  @Get("distribution/dashboard/action-center")
  @RequirePermissions("distribution.orders", "pharmacy.view", "pops.read")
  dashboardActionCenter(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode?: string,
    @Query("warehouseId") warehouseId?: string,
    @Query("companyId") companyId?: string,
    @Query("salesmanId") salesmanId?: string,
    @Query("territoryId") territoryId?: string,
    @Query("routeId") routeId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("preset") preset?: string,
    @Query("limit") limit?: string,
  ) {
    return this.dashboard.actionCenter(
      user.organizationId,
      this.dashboardFilters({
        branchCode,
        warehouseId,
        companyId,
        salesmanId,
        territoryId,
        routeId,
        from,
        to,
        preset,
        limit,
      }),
    );
  }

  @Get("distribution/dashboard/stock-health")
  @RequirePermissions("distribution.orders", "pharmacy.view", "pops.read")
  dashboardStockHealth(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode?: string,
    @Query("warehouseId") warehouseId?: string,
    @Query("companyId") companyId?: string,
    @Query("salesmanId") salesmanId?: string,
    @Query("territoryId") territoryId?: string,
    @Query("routeId") routeId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("preset") preset?: string,
    @Query("limit") limit?: string,
  ) {
    return this.dashboard.stockHealth(
      user.organizationId,
      this.dashboardFilters({
        branchCode,
        warehouseId,
        companyId,
        salesmanId,
        territoryId,
        routeId,
        from,
        to,
        preset,
        limit,
      }),
    );
  }

  @Get("distribution/dashboard/recovery")
  @RequirePermissions("distribution.orders", "pharmacy.view", "pops.read")
  dashboardRecovery(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode?: string,
    @Query("warehouseId") warehouseId?: string,
    @Query("companyId") companyId?: string,
    @Query("salesmanId") salesmanId?: string,
    @Query("territoryId") territoryId?: string,
    @Query("routeId") routeId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("preset") preset?: string,
    @Query("limit") limit?: string,
  ) {
    return this.dashboard.recovery(
      user.organizationId,
      this.dashboardFilters({
        branchCode,
        warehouseId,
        companyId,
        salesmanId,
        territoryId,
        routeId,
        from,
        to,
        preset,
        limit,
      }),
    );
  }

  @Get("distribution/dashboard/deliveries")
  @RequirePermissions("distribution.orders", "pharmacy.view", "pops.read")
  dashboardDeliveries(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode?: string,
    @Query("warehouseId") warehouseId?: string,
    @Query("companyId") companyId?: string,
    @Query("salesmanId") salesmanId?: string,
    @Query("territoryId") territoryId?: string,
    @Query("routeId") routeId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("preset") preset?: string,
    @Query("limit") limit?: string,
  ) {
    return this.dashboard.deliveries(
      user.organizationId,
      this.dashboardFilters({
        branchCode,
        warehouseId,
        companyId,
        salesmanId,
        territoryId,
        routeId,
        from,
        to,
        preset,
        limit,
      }),
    );
  }

  @Get("distribution/dashboard/field-force")
  @RequirePermissions("distribution.orders", "pharmacy.view", "pops.read")
  dashboardFieldForce(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode?: string,
    @Query("warehouseId") warehouseId?: string,
    @Query("companyId") companyId?: string,
    @Query("salesmanId") salesmanId?: string,
    @Query("territoryId") territoryId?: string,
    @Query("routeId") routeId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("preset") preset?: string,
    @Query("limit") limit?: string,
  ) {
    return this.dashboard.fieldForce(
      user.organizationId,
      this.dashboardFilters({
        branchCode,
        warehouseId,
        companyId,
        salesmanId,
        territoryId,
        routeId,
        from,
        to,
        preset,
        limit,
      }),
    );
  }

  @Get("distribution/reports/:reportId")
  @RequirePermissions("distribution.orders", "pharmacy.view", "pops.read")
  runReport(
    @CurrentUser() user: AccessJwtPayload,
    @Param("reportId") reportId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("cityId") cityId?: string,
    @Query("areaId") areaId?: string,
    @Query("branchCode") branchCode?: string,
  ) {
    return this.erp.runDistributionReport(user.organizationId, reportId, {
      from,
      to,
      cityId,
      areaId,
      branchCode,
    });
  }

  @Get("distribution/deliveries")
  @RequirePermissions("distribution.deliveries", "pharmacy.view", "pops.read")
  listDeliveries(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode?: string) {
    return this.erp.listDeliveries(user.organizationId, branchCode?.trim());
  }

  @Post("distribution/deliveries")
  @RequirePermissions("distribution.deliveries", "pops.inventory.manage")
  createDelivery(
    @CurrentUser() user: AccessJwtPayload,
    @Body()
    body: {
      branchCode: string;
      orderId?: string;
      invoiceId?: string;
      tradeCustomerId?: string;
      riderName?: string;
      routeId?: string;
    },
  ) {
    return this.erp.createDelivery(user.organizationId, body);
  }

  @Patch("distribution/deliveries/:id")
  @RequirePermissions("distribution.deliveries", "pops.inventory.manage")
  updateDelivery(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body()
    body: {
      status?: string;
      failedReason?: string;
      podNotes?: string;
      collectedPkr?: number;
    },
  ) {
    return this.erp.updateDelivery(user.organizationId, id, body);
  }

  @Get("distribution/collections")
  @RequirePermissions("distribution.collections", "pharmacy.view", "pops.read")
  listCollections(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode?: string) {
    return this.erp.listCollections(user.organizationId, branchCode?.trim());
  }

  @Post("distribution/collections")
  @RequirePermissions("distribution.collections", "pops.inventory.manage")
  createCollection(
    @CurrentUser() user: AccessJwtPayload,
    @Body()
    body: {
      branchCode: string;
      tradeCustomerId: string;
      invoiceId?: string;
      patientId?: string;
      amountPkr: number;
      paymentMethod?: string;
      salesmanEmployeeId?: string;
      notes?: string;
    },
  ) {
    return this.erp.createCollection(user.organizationId, body, user.sub);
  }

  @Get("distribution/assignments")
  @RequirePermissions("distribution.field", "pharmacy.view", "pops.read")
  listAssignments(@CurrentUser() user: AccessJwtPayload) {
    return this.erp.listAssignments(user.organizationId);
  }

  @Post("distribution/assignments")
  @RequirePermissions("distribution.field", "pops.inventory.manage")
  createAssignment(
    @CurrentUser() user: AccessJwtPayload,
    @Body()
    body: {
      branchCode?: string;
      assignmentDate: string;
      employeeId: string;
      cityId?: string;
      areaId?: string;
      routeId?: string;
      tradeCustomerId?: string;
      doctorId?: string;
      taskType?: string;
      targetSalesPkr?: number;
      targetCollectionPkr?: number;
      notes?: string;
    },
  ) {
    return this.erp.createAssignment(user.organizationId, body);
  }

  @Get("distribution/visits")
  @RequirePermissions("distribution.field", "pharmacy.view", "pops.read")
  listVisits(@CurrentUser() user: AccessJwtPayload) {
    return this.erp.listVisits(user.organizationId);
  }

  @Post("distribution/visits")
  @RequirePermissions("distribution.field", "pops.inventory.manage")
  createVisit(
    @CurrentUser() user: AccessJwtPayload,
    @Body()
    body: {
      assignmentId?: string;
      employeeId: string;
      tradeCustomerId?: string;
      doctorId?: string;
      purpose?: string;
      status?: string;
      productive?: boolean;
      isOutstation?: boolean;
      orderId?: string;
      collectionId?: string;
      notes?: string;
    },
  ) {
    return this.erp.createVisit(user.organizationId, body);
  }

  @Get("distribution/targets")
  @RequirePermissions("distribution.field", "pharmacy.view", "pops.read")
  listTargets(@CurrentUser() user: AccessJwtPayload) {
    return this.erp.listTargets(user.organizationId);
  }

  @Post("distribution/targets")
  @RequirePermissions("distribution.field", "pops.inventory.manage")
  createTarget(
    @CurrentUser() user: AccessJwtPayload,
    @Body()
    body: {
      periodType?: string;
      periodStart: string;
      periodEnd: string;
      employeeId?: string;
      cityId?: string;
      companyId?: string;
      medicineId?: string;
      targetSalesPkr?: number;
      targetCollectionPkr?: number;
    },
  ) {
    return this.erp.createTarget(user.organizationId, body);
  }

  @Get("pricing/lists")
  @RequirePermissions("distribution.pricing", "pharmacy.view", "pops.read")
  listPriceLists(@CurrentUser() user: AccessJwtPayload) {
    return this.erp.listPriceLists(user.organizationId);
  }

  @Post("pricing/lists")
  @RequirePermissions("distribution.pricing", "pops.inventory.manage")
  createPriceList(
    @CurrentUser() user: AccessJwtPayload,
    @Body()
    body: {
      name: string;
      priceLevel?: string;
      customerType?: string;
      areaId?: string;
      tradeCustomerId?: string;
      items?: { medicineId: string; unitPricePkr: number; minQty?: number }[];
    },
  ) {
    return this.erp.createPriceList(user.organizationId, body);
  }

  @Get("pricing/schemes")
  @RequirePermissions("distribution.pricing", "pharmacy.view", "pops.read")
  listSchemes(@CurrentUser() user: AccessJwtPayload) {
    return this.erp.listSchemes(user.organizationId);
  }

  @Post("pricing/schemes")
  @RequirePermissions("distribution.pricing", "pops.inventory.manage")
  createScheme(
    @CurrentUser() user: AccessJwtPayload,
    @Body()
    body: {
      name: string;
      schemeType?: string;
      medicineId?: string;
      companyId?: string;
      buyQty?: number;
      freeQty?: number;
      startDate?: string;
      endDate?: string;
    },
  ) {
    return this.erp.createScheme(user.organizationId, body);
  }

  @Get("pricing/resolve")
  @RequirePermissions("distribution.pricing", "distribution.orders", "pharmacy.view", "pops.read")
  resolvePrice(
    @CurrentUser() user: AccessJwtPayload,
    @Query("medicineId") medicineId: string,
    @Query("tradeCustomerId") tradeCustomerId?: string,
    @Query("priceLevel") priceLevel?: string,
    @Query("qty") qty?: string,
  ) {
    const parsed = resolvePharmacyPriceSchema.parse({
      medicineId,
      tradeCustomerId: tradeCustomerId || undefined,
      priceLevel: priceLevel || undefined,
      qty: qty ? Number(qty) : undefined,
    });
    return this.erp.resolvePrice(user.organizationId, parsed.medicineId, {
      tradeCustomerId: parsed.tradeCustomerId,
      priceLevel: parsed.priceLevel,
      qty: parsed.qty,
    });
  }

  @Get("distribution/wholesale-returns")
  @RequirePermissions("distribution.orders", "pharmacy.view", "pops.read")
  listWholesaleReturns(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.erp.listWholesaleReturns(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("distribution/wholesale-returns")
  @RequirePermissions("distribution.orders", "pops.inventory.manage")
  createWholesaleReturn(
    @CurrentUser() user: AccessJwtPayload,
    @Body()
    body: {
      branchCode: string;
      tradeCustomerId: string;
      invoiceId?: string;
      warehouseId?: string;
      reason?: string;
      lines: { medicineId: string; batchId?: string; quantity: number; unitPricePkr?: number }[];
    },
  ) {
    return this.erp.createWholesaleReturn(user.organizationId, body, user.sub);
  }
}
