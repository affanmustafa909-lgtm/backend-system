import { Module } from "@nestjs/common";
import { PermissionsGuard } from "../users/permissions.guard";
import { AccountingController } from "./accounting.controller";
import { AccountingHooksService } from "./accounting-hooks.service";
import { AccountingService } from "./accounting.service";

@Module({
  controllers: [AccountingController],
  providers: [AccountingService, AccountingHooksService, PermissionsGuard],
  exports: [AccountingService, AccountingHooksService],
})
export class AccountingModule {}
