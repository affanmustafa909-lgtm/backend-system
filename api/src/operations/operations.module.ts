import { Module } from "@nestjs/common";
import { AccountingModule } from "../accounting/accounting.module";
import { BillingModule } from "../billing/billing.module";
import { PermissionsGuard } from "../users/permissions.guard";
import { OperationsController } from "./operations.controller";
import { OperationsService } from "./operations.service";

@Module({
  imports: [BillingModule, AccountingModule],
  controllers: [OperationsController],
  providers: [OperationsService, PermissionsGuard],
  exports: [OperationsService],
})
export class OperationsModule {}
