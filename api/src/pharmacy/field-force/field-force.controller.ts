import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  closeFieldForceDaySchema,
  completeFieldForceVisitSchema,
  createFieldForcePjpSchema,
  createFieldForceTargetSchema,
  fieldForceAssignCustomerSchema,
  fieldForceReorderRouteSchema,
  fieldForceRouteCustomerSchema,
  generateFieldForceVisitsSchema,
  missFieldForceVisitSchema,
  rescheduleFieldForceVisitSchema,
  reviseFieldForcePjpSchema,
  startFieldForceVisitSchema,
  upsertFieldForceSalesmanSchema,
} from "@platform/contracts";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { CurrentUser } from "../../auth/current-user.decorator";
import type { AccessJwtPayload } from "../../auth/jwt.types";
import { PermissionsGuard } from "../../users/permissions.guard";
import { RequirePermissions } from "../../users/require-permission.decorator";
import { SystemTypeGuard } from "../../users/system-type.guard";
import { RequireSystemType } from "../../users/require-system-type.decorator";
import { FieldForceDashboardService } from "./field-force-dashboard.service";
import { FieldForcePjpService } from "./pjp.service";
import { FieldForceRoutePlanService } from "./route-plan.service";
import { FieldForceSalesmanService } from "./salesman.service";
import { FieldForceTargetService } from "./target.service";
import { FieldForceVisitService } from "./visit.service";

type Q = Record<string, string | undefined>;

const VIEW = ["field.view", "field.manage", "distribution.field", "pharmacy.view", "pops.read"] as const;
const MANAGE = ["field.manage", "distribution.field", "pops.inventory.manage"] as const;
const PJP = ["field.pjp", "field.manage", "distribution.field", "pops.inventory.manage"] as const;
const VISIT = ["field.visit", "field.manage", "distribution.field", "pops.inventory.manage"] as const;
const TARGET = ["field.target", "field.manage", "distribution.field", "pops.inventory.manage"] as const;

@Controller("v1/pharmacy/field-force")
@UseGuards(JwtAuthGuard, PermissionsGuard, SystemTypeGuard)
@RequireSystemType("pharmacy", "distribution")
export class FieldForceController {
  constructor(
    private readonly dashboard: FieldForceDashboardService,
    private readonly salesmen: FieldForceSalesmanService,
    private readonly routes: FieldForceRoutePlanService,
    private readonly pjp: FieldForcePjpService,
    private readonly visits: FieldForceVisitService,
    private readonly targets: FieldForceTargetService,
  ) {}

  private num(raw?: string) {
    if (raw === undefined || raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }

  @Get("dashboard")
  @RequirePermissions(...VIEW)
  getDashboard(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.dashboard.dashboard(user.organizationId, {
      branchCode: q.branchCode,
      employeeId: q.employeeId ?? q.salesmanId,
      territoryId: q.territoryId,
      routeId: q.routeId,
      date: q.date,
    });
  }

  @Get("performance")
  @RequirePermissions(...VIEW)
  getPerformance(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.dashboard.performance(user.organizationId, {
      from: q.from,
      to: q.to,
      branchCode: q.branchCode,
      group: (q.group as "salesman" | "territory" | "route") ?? "salesman",
    });
  }

  @Get("coverage")
  @RequirePermissions(...VIEW)
  getCoverage(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.dashboard.coverage(user.organizationId, {
      employeeId: q.employeeId,
      from: q.from,
      to: q.to,
    });
  }

  @Get("salesmen")
  @RequirePermissions(...VIEW)
  listSalesmen(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.salesmen.list(user.organizationId, {
      q: q.q,
      status: q.status,
      territoryId: q.territoryId,
      branchCode: q.branchCode,
      page: this.num(q.page),
      pageSize: this.num(q.pageSize),
    });
  }

  @Get("salesmen/:employeeId")
  @RequirePermissions(...VIEW)
  getSalesman(@CurrentUser() user: AccessJwtPayload, @Param("employeeId") employeeId: string) {
    return this.salesmen.getByEmployee(user.organizationId, employeeId);
  }

  @Get("salesmen/:employeeId/customers")
  @RequirePermissions(...VIEW)
  salesmanCustomers(
    @CurrentUser() user: AccessJwtPayload,
    @Param("employeeId") employeeId: string,
    @Query() q: Q,
  ) {
    return this.salesmen.customersForSalesman(
      user.organizationId,
      employeeId,
      this.num(q.page) ?? 1,
      this.num(q.pageSize) ?? 50,
    );
  }

  @Post("salesmen")
  @RequirePermissions(...MANAGE)
  upsertSalesman(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.salesmen.upsert(user.organizationId, upsertFieldForceSalesmanSchema.parse(body), user.sub);
  }

  @Post("assignments/customer")
  @RequirePermissions(...MANAGE)
  assignCustomer(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.salesmen.assignCustomer(user.organizationId, fieldForceAssignCustomerSchema.parse(body), user.sub);
  }

  @Get("routes/:routeId")
  @RequirePermissions(...VIEW)
  getRoute(@CurrentUser() user: AccessJwtPayload, @Param("routeId") routeId: string) {
    return this.routes.getRoute(user.organizationId, routeId);
  }

  @Post("routes/:routeId/customers")
  @RequirePermissions(...MANAGE)
  addRouteCustomer(
    @CurrentUser() user: AccessJwtPayload,
    @Param("routeId") routeId: string,
    @Body() body: unknown,
  ) {
    return this.routes.addStop(user.organizationId, routeId, fieldForceRouteCustomerSchema.parse(body), user.sub);
  }

  @Post("routes/:routeId/reorder")
  @RequirePermissions(...MANAGE)
  reorderRoute(@CurrentUser() user: AccessJwtPayload, @Param("routeId") routeId: string, @Body() body: unknown) {
    const parsed = fieldForceReorderRouteSchema.parse(body);
    return this.routes.reorder(user.organizationId, routeId, parsed.customerIds, user.sub);
  }

  @Post("routes/:routeId/customers/:customerId/remove")
  @RequirePermissions(...MANAGE)
  removeRouteCustomer(
    @CurrentUser() user: AccessJwtPayload,
    @Param("routeId") routeId: string,
    @Param("customerId") customerId: string,
  ) {
    return this.routes.removeStop(user.organizationId, routeId, customerId, user.sub);
  }

  @Get("pjp")
  @RequirePermissions(...VIEW)
  listPjp(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.pjp.list(user.organizationId, {
      employeeId: q.employeeId,
      status: q.status,
      branchCode: q.branchCode,
      page: this.num(q.page),
      pageSize: this.num(q.pageSize),
    });
  }

  @Post("pjp")
  @RequirePermissions(...PJP)
  createPjp(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.pjp.create(user.organizationId, createFieldForcePjpSchema.parse(body), user.sub);
  }

  @Get("pjp/:id")
  @RequirePermissions(...VIEW)
  getPjp(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.pjp.getById(user.organizationId, id);
  }

  @Post("pjp/:id/revise")
  @RequirePermissions(...PJP)
  revisePjp(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.pjp.revise(user.organizationId, id, reviseFieldForcePjpSchema.parse(body), user.sub);
  }

  @Post("pjp/:id/cancel")
  @RequirePermissions(...PJP)
  cancelPjp(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: { reason?: string }) {
    return this.pjp.cancel(user.organizationId, id, body.reason ?? "cancelled", user.sub);
  }

  @Get("visits")
  @RequirePermissions(...VIEW)
  listVisits(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.visits.list(user.organizationId, {
      from: q.from,
      to: q.to,
      date: q.date,
      employeeId: q.employeeId ?? q.salesmanId,
      tradeCustomerId: q.tradeCustomerId,
      territoryId: q.territoryId,
      routeId: q.routeId,
      status: q.status,
      outcome: q.outcome,
      branchCode: q.branchCode,
      q: q.q,
      page: this.num(q.page),
      pageSize: this.num(q.pageSize),
    });
  }

  @Post("visits/generate")
  @RequirePermissions(...PJP)
  generate(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.visits.generate(user.organizationId, generateFieldForceVisitsSchema.parse(body), user);
  }

  @Post("visits/close-day")
  @RequirePermissions(...PJP)
  closeDay(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const parsed = closeFieldForceDaySchema.parse(body);
    return this.visits.closeDay(user.organizationId, parsed.date, parsed.employeeId, parsed.branchCode);
  }

  @Get("visits/:id")
  @RequirePermissions(...VIEW)
  getVisit(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.visits.context(user.organizationId, id, user);
  }

  @Post("visits/:id/start")
  @RequirePermissions(...VISIT)
  startVisit(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.visits.start(user.organizationId, id, startFieldForceVisitSchema.parse(body ?? {}), user);
  }

  @Post("visits/:id/complete")
  @RequirePermissions(...VISIT)
  completeVisit(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.visits.complete(user.organizationId, id, completeFieldForceVisitSchema.parse(body), user);
  }

  @Post("visits/:id/miss")
  @RequirePermissions(...VISIT)
  missVisit(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    const parsed = missFieldForceVisitSchema.parse(body ?? {});
    return this.visits.miss(user.organizationId, id, parsed.reason, user);
  }

  @Patch("visits/:id/cancel")
  @RequirePermissions(...VISIT)
  cancelVisit(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: { reason?: string }) {
    return this.visits.cancel(user.organizationId, id, body?.reason, user);
  }

  @Post("visits/:id/reschedule")
  @RequirePermissions(...VISIT)
  rescheduleVisit(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    const parsed = rescheduleFieldForceVisitSchema.parse(body);
    return this.visits.reschedule(user.organizationId, id, parsed.newDate, parsed.reason, user);
  }

  @Get("targets")
  @RequirePermissions(...VIEW)
  listTargets(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.targets.list(user.organizationId, {
      employeeId: q.employeeId,
      territoryId: q.territoryId,
      routeId: q.routeId,
      scopeType: q.scopeType,
      from: q.from,
      to: q.to,
      page: this.num(q.page),
      pageSize: this.num(q.pageSize),
    });
  }

  @Post("targets")
  @RequirePermissions(...TARGET)
  createTarget(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.targets.create(user.organizationId, createFieldForceTargetSchema.parse(body), user.sub);
  }

  @Get("targets/:id")
  @RequirePermissions(...VIEW)
  getTarget(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.targets.getById(user.organizationId, id);
  }
}
