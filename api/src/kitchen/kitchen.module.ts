import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { ClosingModule } from "../closing/closing.module";
import { DeliveryModule } from "../delivery/delivery.module";
import { PermissionsGuard } from "../users/permissions.guard";
import { SystemTypeGuard } from "../users/system-type.guard";
import { KitchenController } from "./kitchen.controller";
import { KitchenService } from "./kitchen.service";

@Module({
  imports: [BillingModule, DeliveryModule, ClosingModule],
  controllers: [KitchenController],
  providers: [KitchenService, PermissionsGuard, SystemTypeGuard],
  exports: [KitchenService],
})
export class KitchenModule {}
