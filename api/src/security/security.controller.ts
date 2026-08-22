import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { SecurityService } from "./security.service";

@Controller("v1/security")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get("overview")
  @RequirePermissions("pops.read")
  getOverview(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode?: string) {
    return this.security.getOverview(user.organizationId, branchCode?.trim() || undefined);
  }
}
