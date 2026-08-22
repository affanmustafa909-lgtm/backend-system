import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { OrgAlertsService } from "./org-alerts.service";

@Controller("v1/org/alerts")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrgAlertsController {
  constructor(private readonly alerts: OrgAlertsService) {}

  @Get()
  @RequirePermissions("pops.read")
  list(@CurrentUser() user: AccessJwtPayload) {
    return this.alerts.listActive(user);
  }

  @Post(":alertId/dismiss")
  @RequirePermissions("pops.read")
  dismiss(@CurrentUser() user: AccessJwtPayload, @Param("alertId") alertId: string) {
    return this.alerts.dismiss(user, alertId);
  }
}
