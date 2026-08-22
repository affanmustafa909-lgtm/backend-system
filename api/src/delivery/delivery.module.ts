import { Module } from "@nestjs/common";
import { PermissionsGuard } from "../users/permissions.guard";
import { SystemTypeGuard } from "../users/system-type.guard";
import { DeliveryController } from "./delivery.controller";
import { DeliveryService } from "./delivery.service";

@Module({
  controllers: [DeliveryController],
  providers: [DeliveryService, PermissionsGuard, SystemTypeGuard],
  exports: [DeliveryService],
})
export class DeliveryModule {}
