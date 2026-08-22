import { Module } from "@nestjs/common";
import { PermissionsGuard } from "../users/permissions.guard";
import { SystemTypeGuard } from "../users/system-type.guard";
import { TaxAuthorityModule } from "../tax-authority/tax-authority.module";
import { StoreController } from "./store.controller";
import { StoreGroceryService } from "./store-grocery.service";
import { StoreService } from "./store.service";

@Module({
  imports: [TaxAuthorityModule],
  controllers: [StoreController],
  providers: [StoreService, StoreGroceryService, PermissionsGuard, SystemTypeGuard],
  exports: [StoreService, StoreGroceryService],
})
export class StoreModule {}
