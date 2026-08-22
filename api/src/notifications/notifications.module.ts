import { Global, Module } from "@nestjs/common";
import { PermissionsGuard } from "../users/permissions.guard";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, PermissionsGuard],
  exports: [NotificationsService],
})
export class NotificationsModule {}
