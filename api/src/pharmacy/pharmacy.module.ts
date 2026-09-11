import { Module } from "@nestjs/common";
import { AccountingModule } from "../accounting/accounting.module";
import { PermissionsGuard } from "../users/permissions.guard";
import { SystemTypeGuard } from "../users/system-type.guard";
import { TaxAuthorityModule } from "../tax-authority/tax-authority.module";
import { PharmacyController } from "./pharmacy.controller";
import { PharmacyDashboardService } from "./pharmacy-dashboard.service";
import { PharmacyErpController } from "./pharmacy-erp.controller";
import { PharmacyErpService } from "./pharmacy-erp.service";
import { PharmacyMastersController } from "./pharmacy-masters.controller";
import { PharmacyMastersService } from "./pharmacy-masters.service";
import { PharmacyService } from "./pharmacy.service";
import { PharmacyStockEngine } from "./pharmacy-stock.engine";

@Module({
  imports: [TaxAuthorityModule, AccountingModule],
  controllers: [PharmacyController, PharmacyErpController, PharmacyMastersController],
  providers: [
    PharmacyService,
    PharmacyErpService,
    PharmacyMastersService,
    PharmacyDashboardService,
    PharmacyStockEngine,
    PermissionsGuard,
    SystemTypeGuard,
  ],
  exports: [
    PharmacyService,
    PharmacyErpService,
    PharmacyMastersService,
    PharmacyDashboardService,
    PharmacyStockEngine,
  ],
})
export class PharmacyModule {}
