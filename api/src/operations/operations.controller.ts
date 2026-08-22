import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createPopsBranchSchema,
  orgDataResetSchema,
  updatePopsBranchSchema,
} from "@platform/contracts";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { OperationsService } from "./operations.service";

@Controller("v1/operations")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get("branches")
  @RequirePermissions("pops.read")
  listBranches(@CurrentUser() user: AccessJwtPayload) {
    return this.operations.listBranches(user.organizationId);
  }

  @Post("branches")
  @RequirePermissions("pops.menu.manage")
  createBranch(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.operations.createBranch(user.organizationId, createPopsBranchSchema.parse(body));
  }

  @Patch("branches/:branchId")
  @RequirePermissions("pops.menu.manage")
  updateBranch(
    @CurrentUser() user: AccessJwtPayload,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    return this.operations.updateBranch(
      user.organizationId,
      branchId,
      updatePopsBranchSchema.parse(body),
    );
  }

  @Get("dashboard")
  @RequirePermissions("pops.read")
  getDashboard(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.operations.getDashboard(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("business-profile")
  @RequirePermissions("pops.read")
  getBusinessProfile(@CurrentUser() user: AccessJwtPayload) {
    return this.operations.getBusinessProfile(user.organizationId);
  }

  @Post("data-reset")
  @RequirePermissions("pops.users.manage")
  resetOrgData(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const input = orgDataResetSchema.parse(body);
    return this.operations.resetOrgData(user, input);
  }
}
