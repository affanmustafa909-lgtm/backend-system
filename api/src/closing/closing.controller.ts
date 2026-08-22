import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { branchCodeBodySchema } from "@platform/contracts";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { ClosingService } from "./closing.service";

@Controller("v1/closing")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ClosingController {
  constructor(private readonly closing: ClosingService) {}

  @Get("status")
  @RequirePermissions("pops.read")
  getStatus(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.closing.getStatus(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("pause-orders")
  @RequirePermissions("pops.closing.report", "pops.accounting.manage")
  pauseOrders(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const parsed = branchCodeBodySchema.parse(body);
    return this.closing.pauseOrders(user.organizationId, parsed.branchCode, user.sub, {
      resume: parsed.resume === true,
    });
  }

  @Post("resume-orders")
  @RequirePermissions("pops.closing.report", "pops.accounting.manage")
  resumeOrders(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const { branchCode } = branchCodeBodySchema.parse(body);
    return this.closing.resumeOrders(user.organizationId, branchCode, user.sub);
  }

  /** Alias for older clients / proxies that block "resume-orders". */
  @Post("unpause-orders")
  @RequirePermissions("pops.closing.report", "pops.accounting.manage")
  unpauseOrders(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const { branchCode } = branchCodeBodySchema.parse(body);
    return this.closing.resumeOrders(user.organizationId, branchCode, user.sub);
  }

  @Post("close-kitchen")
  @RequirePermissions("pops.closing.report", "pops.accounting.manage")
  closeKitchen(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const { branchCode } = branchCodeBodySchema.parse(body);
    return this.closing.closeKitchen(user.organizationId, branchCode, user.sub);
  }

  @Post("run-z-report")
  @RequirePermissions("pops.closing.report", "pops.accounting.manage")
  runZReport(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const { branchCode } = branchCodeBodySchema.parse(body);
    return this.closing.runZReport(user.organizationId, branchCode, user.sub);
  }

  @Post("verify-backup")
  @RequirePermissions("pops.closing.report", "pops.accounting.manage")
  verifyBackup(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const { branchCode } = branchCodeBodySchema.parse(body);
    return this.closing.verifyBackup(user.organizationId, branchCode, user.sub);
  }

  @Post("close-day")
  @RequirePermissions("pops.closing.report", "pops.accounting.manage")
  closeDay(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const { branchCode } = branchCodeBodySchema.parse(body);
    return this.closing.closeDay(user.organizationId, branchCode, user.sub);
  }
}
