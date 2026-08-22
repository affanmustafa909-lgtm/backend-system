import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  sendTestNotificationSchema,
  updateNotificationSettingsSchema,
  updateNotificationTemplateSchema,
} from "@platform/contracts";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { NotificationsService } from "./notifications.service";

@Controller("v1/notifications")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get("overview")
  @RequirePermissions("pops.read")
  getOverview(@CurrentUser() user: AccessJwtPayload) {
    return this.notifications.getOverview(user.organizationId);
  }

  @Get("settings")
  @RequirePermissions("pops.read")
  getSettings(@CurrentUser() user: AccessJwtPayload) {
    return this.notifications.getSettings(user.organizationId);
  }

  @Patch("settings")
  @RequirePermissions("pops.notifications.manage")
  updateSettings(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.notifications.updateSettings(
      user.organizationId,
      updateNotificationSettingsSchema.parse(body),
    );
  }

  @Get("templates")
  @RequirePermissions("pops.read")
  listTemplates(@CurrentUser() user: AccessJwtPayload) {
    return this.notifications.listTemplates(user.organizationId).then((templates) => ({ templates }));
  }

  @Patch("templates/:templateId")
  @RequirePermissions("pops.notifications.manage")
  updateTemplate(
    @CurrentUser() user: AccessJwtPayload,
    @Param("templateId") templateId: string,
    @Body() body: unknown,
  ) {
    return this.notifications.updateTemplate(
      user.organizationId,
      templateId,
      updateNotificationTemplateSchema.parse(body),
    );
  }

  @Get("log")
  @RequirePermissions("pops.read")
  listLog(@CurrentUser() user: AccessJwtPayload, @Query("limit") limit?: string) {
    return this.notifications
      .listLog(user.organizationId, limit ? Number(limit) : 100)
      .then((entries) => ({ entries }));
  }

  @Post("test")
  @RequirePermissions("pops.notifications.manage")
  sendTest(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.notifications.sendTest(user.organizationId, sendTestNotificationSchema.parse(body));
  }
}
