import { Module } from "@nestjs/common";
import { AccountingModule } from "../accounting/accounting.module";
import { PermissionsGuard } from "../users/permissions.guard";
import { InventoryController } from "./inventory.controller";
import { InventoryDeductionService } from "./inventory-deduction.service";
import { InventoryService } from "./inventory.service";

@Module({
  imports: [AccountingModule],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryDeductionService, PermissionsGuard],
  exports: [InventoryService, InventoryDeductionService],
})
export class InventoryModule {}
