import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createPharmacyCollectionSchema,
  createPharmacyPromiseToPaySchema,
  pharmacyCollectionAllocateSchema,
  pharmacyCollectionChequeStatusSchema,
  updatePharmacyPromiseStatusSchema,
} from "@platform/contracts";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { CurrentUser } from "../../auth/current-user.decorator";
import type { AccessJwtPayload } from "../../auth/jwt.types";
import { PermissionsGuard } from "../../users/permissions.guard";
import { RequirePermissions } from "../../users/require-permission.decorator";
import { SystemTypeGuard } from "../../users/system-type.guard";
import { RequireSystemType } from "../../users/require-system-type.decorator";
import { AgingService } from "./aging.service";
import { CollectionService } from "./collection.service";
import { RecoveryService } from "./recovery.service";

type Q = Record<string, string | undefined>;

@Controller("v1/pharmacy/collections")
@UseGuards(JwtAuthGuard, PermissionsGuard, SystemTypeGuard)
@RequireSystemType("pharmacy", "distribution")
export class CollectionsController {
  constructor(
    private readonly collections: CollectionService,
    private readonly aging: AgingService,
    private readonly recovery: RecoveryService,
  ) {}

  private num(raw?: string) {
    if (raw === undefined || raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }

  @Get("dashboard")
  @RequirePermissions(
    "collection.view",
    "collection.create",
    "distribution.collections",
    "pharmacy.view",
    "pops.read",
  )
  getDashboard(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode?: string) {
    return this.collections.getDashboard(user.organizationId, branchCode?.trim());
  }

  @Get("aging")
  @RequirePermissions(
    "collection.view",
    "recovery.view",
    "distribution.collections",
    "pharmacy.view",
    "pops.read",
  )
  getAging(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.aging.listCustomers(user.organizationId, {
      branchCode: q.branchCode,
      page: this.num(q.page),
      pageSize: this.num(q.pageSize),
      minOutstanding: this.num(q.minOutstanding),
    });
  }

  @Get("recovery")
  @RequirePermissions("recovery.view", "recovery.action", "distribution.collections", "pops.read")
  getRecovery(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.recovery.getQueue(user.organizationId, {
      branchCode: q.branchCode,
      priority: q.priority,
      page: this.num(q.page),
      pageSize: this.num(q.pageSize),
    });
  }

  @Get("promises")
  @RequirePermissions("recovery.view", "recovery.action", "distribution.collections", "pops.read")
  listPromises(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.recovery.listPromises(user.organizationId, {
      tradeCustomerId: q.tradeCustomerId,
      status: q.status,
      page: this.num(q.page),
      pageSize: this.num(q.pageSize),
    });
  }

  @Post("promises")
  @RequirePermissions("recovery.action", "distribution.collections", "pops.inventory.manage")
  createPromise(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.recovery.createPromise(
      user.organizationId,
      createPharmacyPromiseToPaySchema.parse(body),
      user.sub,
    );
  }

  @Patch("promises/:id")
  @RequirePermissions("recovery.action", "distribution.collections", "pops.inventory.manage")
  updatePromise(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const parsed = updatePharmacyPromiseStatusSchema.parse(body);
    return this.recovery.updatePromiseStatus(user.organizationId, id, parsed.status);
  }

  @Get()
  @RequirePermissions("collection.view", "distribution.collections", "pharmacy.view", "pops.read")
  list(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.collections.list(user.organizationId, {
      branchCode: q.branchCode,
      tradeCustomerId: q.tradeCustomerId,
      paymentMethod: q.paymentMethod,
      chequeStatus: q.chequeStatus,
      from: q.from,
      to: q.to,
      q: q.q,
      page: this.num(q.page),
      pageSize: this.num(q.pageSize),
    });
  }

  @Post()
  @RequirePermissions("collection.create", "distribution.collections", "pops.inventory.manage")
  create(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.collections.create(
      user.organizationId,
      createPharmacyCollectionSchema.parse(body),
      user.sub,
    );
  }

  @Get(":id")
  @RequirePermissions("collection.view", "distribution.collections", "pops.read")
  getById(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.collections.getById(user.organizationId, id);
  }

  @Post(":id/allocate")
  @RequirePermissions("collection.allocate", "collection.create", "distribution.collections", "pops.inventory.manage")
  allocate(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const parsed = pharmacyCollectionAllocateSchema.parse(body);
    return this.collections.allocate(user.organizationId, id, parsed.allocations);
  }

  @Patch(":id/cheque-status")
  @RequirePermissions("collection.allocate", "collection.create", "distribution.collections", "pops.inventory.manage")
  chequeStatus(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const parsed = pharmacyCollectionChequeStatusSchema.parse(body);
    return this.collections.updateChequeStatus(user.organizationId, id, parsed.chequeStatus);
  }
}
