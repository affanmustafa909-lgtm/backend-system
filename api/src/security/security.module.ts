import { Module } from "@nestjs/common";
import { PermissionsGuard } from "../users/permissions.guard";
import { SecurityController } from "./security.controller";
import { SecurityService } from "./security.service";

@Module({
  controllers: [SecurityController],
  providers: [SecurityService, PermissionsGuard],
  exports: [SecurityService],
})
export class SecurityModule {}
