import { Module } from "@nestjs/common";
import { PermissionsGuard } from "../users/permissions.guard";
import { OrgAlertsController } from "./org-alerts.controller";
import { OrgAlertsService } from "./org-alerts.service";

@Module({
  controllers: [OrgAlertsController],
  providers: [OrgAlertsService, PermissionsGuard],
  exports: [OrgAlertsService],
})
export class OrgAlertsModule {}
