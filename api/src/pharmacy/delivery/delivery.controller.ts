import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createPharmacyDeliverySchema,
  createPharmacyDriverSchema,
  createPharmacyVehicleSchema,
  pharmacyDeliveryAssignSchema,
  pharmacyDeliveryDispatchSchema,
  pharmacyDeliveryPodSchema,
  updatePharmacyDriverSchema,
  updatePharmacyVehicleSchema,
} from "@platform/contracts";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { CurrentUser } from "../../auth/current-user.decorator";
import type { AccessJwtPayload } from "../../auth/jwt.types";
import { PermissionsGuard } from "../../users/permissions.guard";
import { RequirePermissions } from "../../users/require-permission.decorator";
import { SystemTypeGuard } from "../../users/system-type.guard";
import { RequireSystemType } from "../../users/require-system-type.decorator";
import { DeliveryDashboardService } from "./delivery-dashboard.service";
import { DeliveryService } from "./delivery.service";
import { DriverService } from "./driver.service";
import { VehicleService } from "./vehicle.service";

type Q = Record<string, string | undefined>;

@Controller("v1/pharmacy/delivery")
@UseGuards(JwtAuthGuard, PermissionsGuard, SystemTypeGuard)
@RequireSystemType("pharmacy", "distribution")
export class DeliveryController {
  constructor(
    private readonly dashboard: DeliveryDashboardService,
    private readonly deliveries: DeliveryService,
    private readonly drivers: DriverService,
    private readonly vehicles: VehicleService,
  ) {}

  private num(raw?: string) {
    if (raw === undefined || raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }

  // ── Dashboard ────────────────────────────────────────────────────────────

  @Get("dashboard")
  @RequirePermissions(
    "delivery.view",
    "delivery.manage",
    "distribution.deliveries",
    "pharmacy.view",
    "pops.read",
  )
  getDashboard(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode?: string) {
    return this.dashboard.getDashboard(user.organizationId, branchCode?.trim());
  }

  // ── Drivers ──────────────────────────────────────────────────────────────

  @Get("drivers")
  @RequirePermissions("delivery.view", "delivery.manage", "distribution.deliveries", "pops.read")
  listDrivers(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.drivers.list(user.organizationId, {
      branchCode: q.branchCode,
      status: q.status,
      q: q.q,
      page: this.num(q.page),
      pageSize: this.num(q.pageSize),
    });
  }

  @Post("drivers")
  @RequirePermissions("delivery.manage", "distribution.deliveries", "pops.inventory.manage")
  createDriver(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.drivers.create(user.organizationId, createPharmacyDriverSchema.parse(body));
  }

  @Get("drivers/:id")
  @RequirePermissions("delivery.view", "delivery.manage", "distribution.deliveries", "pops.read")
  getDriver(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.drivers.getById(user.organizationId, id);
  }

  @Patch("drivers/:id")
  @RequirePermissions("delivery.manage", "distribution.deliveries", "pops.inventory.manage")
  updateDriver(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.drivers.update(user.organizationId, id, updatePharmacyDriverSchema.parse(body));
  }

  // ── Vehicles ─────────────────────────────────────────────────────────────

  @Get("vehicles")
  @RequirePermissions("delivery.view", "delivery.manage", "distribution.deliveries", "pops.read")
  listVehicles(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.vehicles.list(user.organizationId, {
      branchCode: q.branchCode,
      status: q.status,
      q: q.q,
      page: this.num(q.page),
      pageSize: this.num(q.pageSize),
    });
  }

  @Post("vehicles")
  @RequirePermissions("delivery.manage", "distribution.deliveries", "pops.inventory.manage")
  createVehicle(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.vehicles.create(user.organizationId, createPharmacyVehicleSchema.parse(body));
  }

  @Get("vehicles/:id")
  @RequirePermissions("delivery.view", "delivery.manage", "distribution.deliveries", "pops.read")
  getVehicle(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.vehicles.getById(user.organizationId, id);
  }

  @Patch("vehicles/:id")
  @RequirePermissions("delivery.manage", "distribution.deliveries", "pops.inventory.manage")
  updateVehicle(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.vehicles.update(user.organizationId, id, updatePharmacyVehicleSchema.parse(body));
  }

  // ── Delivery orders ──────────────────────────────────────────────────────

  @Get("orders")
  @RequirePermissions("delivery.view", "delivery.manage", "distribution.deliveries", "pharmacy.view", "pops.read")
  listOrders(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.deliveries.list(user.organizationId, {
      branchCode: q.branchCode,
      status: q.status,
      driverId: q.driverId,
      routeId: q.routeId,
      from: q.from,
      to: q.to,
      q: q.q,
      page: this.num(q.page),
      pageSize: this.num(q.pageSize),
    });
  }

  @Post("orders")
  @RequirePermissions("delivery.manage", "distribution.deliveries", "pops.inventory.manage")
  createOrder(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const parsed = createPharmacyDeliverySchema.parse(body);
    return this.deliveries.create(user.organizationId, parsed);
  }

  @Get("orders/:id")
  @RequirePermissions("delivery.view", "delivery.manage", "distribution.deliveries", "pops.read")
  getOrder(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.deliveries.getById(user.organizationId, id);
  }

  @Post("orders/:id/assign")
  @RequirePermissions("delivery.dispatch", "delivery.manage", "distribution.deliveries", "pops.inventory.manage")
  assign(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.deliveries.assign(user.organizationId, id, pharmacyDeliveryAssignSchema.parse(body));
  }

  @Post("orders/dispatch")
  @RequirePermissions("delivery.dispatch", "delivery.manage", "distribution.deliveries", "pops.inventory.manage")
  dispatch(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const parsed = pharmacyDeliveryDispatchSchema.parse(body);
    return this.deliveries.dispatch(user.organizationId, parsed.ids);
  }

  @Post("orders/:id/out-for-delivery")
  @RequirePermissions("delivery.dispatch", "delivery.manage", "distribution.deliveries", "pops.inventory.manage")
  outForDelivery(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.deliveries.markOutForDelivery(user.organizationId, id);
  }

  @Post("orders/:id/pod")
  @RequirePermissions("delivery.pod", "delivery.manage", "distribution.deliveries", "pops.inventory.manage")
  completePod(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.deliveries.completePod(user.organizationId, id, pharmacyDeliveryPodSchema.parse(body));
  }
}
