import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createEmbroideryCustomerOrderSchema,
  createEmbroideryDeliverySchema,
  createEmbroideryDesignSchema,
  createEmbroideryJobSchema,
  createEmbroideryMachineSchema,
  createEmbroideryMaterialIssueSchema,
  createEmbroideryPieceRateEntrySchema,
  createEmbroideryProductionLogSchema,
  createEmbroideryQcRecordSchema,
  updateEmbroideryCustomerOrderSchema,
  updateEmbroideryDesignSchema,
  updateEmbroideryJobSchema,
  updateEmbroideryMachineSchema,
} from "@platform/contracts";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { SystemTypeGuard } from "../users/system-type.guard";
import { RequireSystemType } from "../users/require-system-type.decorator";
import { EmbroideryService } from "./embroidery.service";

@Controller("v1/embroidery")
@UseGuards(JwtAuthGuard, PermissionsGuard, SystemTypeGuard)
@RequireSystemType("embroidery")
export class EmbroideryController {
  constructor(private readonly embroidery: EmbroideryService) {}

  private orgId(user: AccessJwtPayload): string {
    return user.organizationId;
  }

  @Get("designs")
  @RequirePermissions("embroidery.read", "embroidery.manage", "*")
  listDesigns(@CurrentUser() user: AccessJwtPayload, @Query("branchId") branchId?: string) {
    return this.embroidery.listDesigns(this.orgId(user), branchId);
  }

  @Post("designs")
  @RequirePermissions("embroidery.manage", "*")
  createDesign(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.embroidery.createDesign(this.orgId(user), createEmbroideryDesignSchema.parse(body));
  }

  @Patch("designs/:id")
  @RequirePermissions("embroidery.manage", "*")
  updateDesign(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.embroidery.updateDesign(
      this.orgId(user),
      id,
      updateEmbroideryDesignSchema.parse(body),
    );
  }

  @Delete("designs/:id")
  @RequirePermissions("embroidery.manage", "*")
  deleteDesign(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.embroidery.deleteDesign(this.orgId(user), id);
  }

  @Get("designs/:id/file")
  @RequirePermissions("embroidery.read", "embroidery.manage", "*")
  getDesignFile(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.embroidery.getDesignFile(this.orgId(user), id);
  }

  @Get("machines")
  @RequirePermissions("embroidery.read", "embroidery.manage", "embroidery.production", "*")
  listMachines(@CurrentUser() user: AccessJwtPayload, @Query("branchId") branchId?: string) {
    return this.embroidery.listMachines(this.orgId(user), branchId);
  }

  @Post("machines")
  @RequirePermissions("embroidery.manage", "*")
  createMachine(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.embroidery.createMachine(
      this.orgId(user),
      createEmbroideryMachineSchema.parse(body),
    );
  }

  @Patch("machines/:id")
  @RequirePermissions("embroidery.manage", "embroidery.production", "*")
  updateMachine(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.embroidery.updateMachine(
      this.orgId(user),
      id,
      updateEmbroideryMachineSchema.parse(body),
    );
  }

  @Delete("machines/:id")
  @RequirePermissions("embroidery.manage", "*")
  deleteMachine(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.embroidery.deleteMachine(this.orgId(user), id);
  }

  @Get("orders")
  @RequirePermissions("embroidery.read", "embroidery.manage", "embroidery.production", "*")
  listOrders(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchId") branchId?: string,
    @Query("status") status?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.embroidery.listCustomerOrders(this.orgId(user), {
      branchId,
      status,
      customerId,
    });
  }

  @Post("orders")
  @RequirePermissions("embroidery.manage", "embroidery.production", "*")
  createOrder(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.embroidery.createCustomerOrder(
      this.orgId(user),
      createEmbroideryCustomerOrderSchema.parse(body),
    );
  }

  @Patch("orders/:id")
  @RequirePermissions("embroidery.manage", "embroidery.production", "*")
  updateOrder(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.embroidery.updateCustomerOrder(
      this.orgId(user),
      id,
      updateEmbroideryCustomerOrderSchema.parse(body),
    );
  }

  @Get("jobs")
  @RequirePermissions("embroidery.read", "embroidery.manage", "embroidery.production", "*")
  listJobs(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchId") branchId?: string,
    @Query("stage") stage?: string,
  ) {
    return this.embroidery.listJobs(this.orgId(user), branchId, stage);
  }

  @Get("jobs/:id/costing")
  @RequirePermissions("embroidery.read", "embroidery.manage", "embroidery.production", "*")
  getJobCosting(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.embroidery.getJobCosting(this.orgId(user), id);
  }

  @Get("jobs/:id")
  @RequirePermissions("embroidery.read", "embroidery.manage", "embroidery.production", "*")
  getJob(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.embroidery.getJob(this.orgId(user), id);
  }

  @Post("jobs")
  @RequirePermissions("embroidery.manage", "embroidery.production", "*")
  createJob(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.embroidery.createJob(this.orgId(user), createEmbroideryJobSchema.parse(body));
  }

  @Patch("jobs/:id")
  @RequirePermissions("embroidery.manage", "embroidery.production", "*")
  updateJob(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.embroidery.updateJob(this.orgId(user), id, updateEmbroideryJobSchema.parse(body));
  }

  @Delete("jobs/:id")
  @RequirePermissions("embroidery.manage", "*")
  deleteJob(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.embroidery.deleteJob(this.orgId(user), id);
  }

  @Get("production-board")
  @RequirePermissions("embroidery.read", "embroidery.production", "embroidery.manage", "*")
  productionBoard(@CurrentUser() user: AccessJwtPayload, @Query("branchId") branchId?: string) {
    return this.embroidery.productionBoard(this.orgId(user), branchId);
  }

  @Get("production-logs")
  @RequirePermissions("embroidery.read", "embroidery.production", "embroidery.manage", "*")
  listProductionLogs(
    @CurrentUser() user: AccessJwtPayload,
    @Query("jobId") jobId?: string,
    @Query("machineId") machineId?: string,
  ) {
    return this.embroidery.listProductionLogs(this.orgId(user), jobId, machineId);
  }

  @Post("production-logs")
  @RequirePermissions("embroidery.production", "embroidery.manage", "*")
  createProductionLog(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.embroidery.createProductionLog(
      this.orgId(user),
      createEmbroideryProductionLogSchema.parse(body),
    );
  }

  @Get("materials")
  @RequirePermissions("embroidery.read", "embroidery.manage", "*")
  listMaterials(@CurrentUser() user: AccessJwtPayload, @Query("jobId") jobId?: string) {
    return this.embroidery.listMaterialIssues(this.orgId(user), jobId);
  }

  @Post("materials")
  @RequirePermissions("embroidery.manage", "embroidery.production", "*")
  createMaterial(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.embroidery.createMaterialIssue(
      this.orgId(user),
      createEmbroideryMaterialIssueSchema.parse(body),
    );
  }

  @Get("qc")
  @RequirePermissions("embroidery.read", "embroidery.qc", "embroidery.manage", "*")
  listQc(@CurrentUser() user: AccessJwtPayload, @Query("jobId") jobId?: string) {
    return this.embroidery.listQc(this.orgId(user), jobId);
  }

  @Post("qc")
  @RequirePermissions("embroidery.qc", "embroidery.manage", "*")
  createQc(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.embroidery.createQc(
      this.orgId(user),
      createEmbroideryQcRecordSchema.parse(body),
    );
  }

  @Get("deliveries")
  @RequirePermissions("embroidery.read", "embroidery.delivery", "embroidery.manage", "*")
  listDeliveries(@CurrentUser() user: AccessJwtPayload, @Query("jobId") jobId?: string) {
    return this.embroidery.listDeliveries(this.orgId(user), jobId);
  }

  @Post("deliveries")
  @RequirePermissions("embroidery.delivery", "embroidery.manage", "*")
  createDelivery(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.embroidery.createDelivery(
      this.orgId(user),
      createEmbroideryDeliverySchema.parse(body),
      user.sub,
    );
  }

  @Get("piece-rates")
  @RequirePermissions("embroidery.read", "embroidery.production", "embroidery.manage", "*")
  listPieceRates(@CurrentUser() user: AccessJwtPayload, @Query("jobId") jobId?: string) {
    return this.embroidery.listPieceRates(this.orgId(user), jobId);
  }

  @Post("piece-rates")
  @RequirePermissions("embroidery.production", "embroidery.manage", "*")
  createPieceRate(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.embroidery.createPieceRate(
      this.orgId(user),
      createEmbroideryPieceRateEntrySchema.parse(body),
    );
  }

  @Get("reports/summary")
  @RequirePermissions("embroidery.read", "embroidery.manage", "*")
  reportsSummary(@CurrentUser() user: AccessJwtPayload, @Query("branchId") branchId?: string) {
    return this.embroidery.reportsSummary(this.orgId(user), branchId);
  }
}
