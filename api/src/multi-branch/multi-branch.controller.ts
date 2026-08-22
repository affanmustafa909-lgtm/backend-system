import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  copyBranchPricingSchema,
  createBranchTransferSchema,
  manualBranchReceiveSchema,
  setBranchPriceOverrideSchema,
  updateBranchTransferSchema,
} from "@platform/contracts";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { MultiBranchService } from "./multi-branch.service";

@Controller("v1/multi-branch")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MultiBranchController {
  constructor(private readonly multiBranch: MultiBranchService) {}

  @Get("overview")
  @RequirePermissions("pops.read")
  getOverview(@CurrentUser() user: AccessJwtPayload) {
    return this.multiBranch.getOverview(user.organizationId);
  }

  @Get("report")
  @RequirePermissions("pops.read")
  getReport(@CurrentUser() user: AccessJwtPayload) {
    return this.multiBranch.getConsolidatedReport(user.organizationId);
  }

  @Get("transfers/ingredients")
  @RequirePermissions("pops.read")
  listIngredients(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
  ) {
    return this.multiBranch.listTransferIngredients(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("transfers")
  @RequirePermissions("pops.read")
  listTransfers(@CurrentUser() user: AccessJwtPayload) {
    return this.multiBranch.listTransfers(user.organizationId);
  }

  @Post("transfers")
  @RequirePermissions("pops.multi_branch.manage")
  createTransfer(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.multiBranch.createTransfer(
      user.organizationId,
      user.sub,
      createBranchTransferSchema.parse(body),
    );
  }

  @Post("transfers/receive")
  @RequirePermissions("pops.multi_branch.manage")
  createManualReceive(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.multiBranch.createManualReceive(
      user.organizationId,
      user.sub,
      manualBranchReceiveSchema.parse(body),
    );
  }

  @Patch("transfers/:transferId")
  @RequirePermissions("pops.multi_branch.manage")
  updateTransfer(
    @CurrentUser() user: AccessJwtPayload,
    @Param("transferId") transferId: string,
    @Body() body: unknown,
  ) {
    return this.multiBranch.updateTransfer(
      user.organizationId,
      transferId,
      updateBranchTransferSchema.parse(body),
    );
  }

  @Get("pricing")
  @RequirePermissions("pops.read")
  listPricing(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode?: string,
  ) {
    return this.multiBranch.listPricing(user.organizationId, branchCode?.trim());
  }

  @Post("pricing")
  @RequirePermissions("pops.multi_branch.manage")
  setPricing(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.multiBranch.setPriceOverride(
      user.organizationId,
      user.sub,
      setBranchPriceOverrideSchema.parse(body),
    );
  }

  @Post("pricing/copy")
  @RequirePermissions("pops.multi_branch.manage")
  copyPricing(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.multiBranch.copyPricing(
      user.organizationId,
      user.sub,
      copyBranchPricingSchema.parse(body),
    );
  }
}
