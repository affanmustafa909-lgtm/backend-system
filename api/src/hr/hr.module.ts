import { Module } from "@nestjs/common";
import { AccountingModule } from "../accounting/accounting.module";
import { PermissionsGuard } from "../users/permissions.guard";
import { HrController } from "./hr.controller";
import { HrService } from "./hr.service";

@Module({
  imports: [AccountingModule],
  controllers: [HrController],
  providers: [HrService, PermissionsGuard],
  exports: [HrService],
})
export class HrModule {}
