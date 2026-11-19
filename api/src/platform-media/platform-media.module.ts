import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { PermissionsGuard } from "../users/permissions.guard";
import { PlatformMediaController } from "./platform-media.controller";
import { PlatformMediaService } from "./platform-media.service";

@Module({
  imports: [UsersModule],
  controllers: [PlatformMediaController],
  providers: [PlatformMediaService, PermissionsGuard],
  exports: [PlatformMediaService],
})
export class PlatformMediaModule {}
