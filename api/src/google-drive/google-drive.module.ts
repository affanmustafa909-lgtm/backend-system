import { Module } from "@nestjs/common";
import { PermissionsGuard } from "../users/permissions.guard";
import { GoogleDriveController } from "./google-drive.controller";
import { GoogleDriveService } from "./google-drive.service";

@Module({
  controllers: [GoogleDriveController],
  providers: [GoogleDriveService, PermissionsGuard],
  exports: [GoogleDriveService],
})
export class GoogleDriveModule {}
