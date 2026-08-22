import { Module } from "@nestjs/common";
import { DeliveryModule } from "../delivery/delivery.module";
import { PermissionsGuard } from "./permissions.guard";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [DeliveryModule],
  controllers: [UsersController],
  providers: [UsersService, PermissionsGuard],
  exports: [UsersService],
})
export class UsersModule {}
