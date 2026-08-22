import { Module } from "@nestjs/common";
import { AccountingModule } from "../accounting/accounting.module";
import { PermissionsGuard } from "../users/permissions.guard";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

@Module({
  imports: [AccountingModule],
  controllers: [ReportsController],
  providers: [ReportsService, PermissionsGuard],
  exports: [ReportsService],
})
export class ReportsModule {}

// deploy bump 2026-07-31T18:56:04.2354940+05:00
