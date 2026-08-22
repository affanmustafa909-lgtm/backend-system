import { Module } from "@nestjs/common";
import { PermissionsGuard } from "../users/permissions.guard";
import { SystemTypeGuard } from "../users/system-type.guard";
import { TaxAuthorityModule } from "../tax-authority/tax-authority.module";
import { PharmacyController } from "./pharmacy.controller";
import { PharmacyService } from "./pharmacy.service";

@Module({
  imports: [TaxAuthorityModule],
  controllers: [PharmacyController],
  providers: [PharmacyService, PermissionsGuard, SystemTypeGuard],
  exports: [PharmacyService],
})
export class PharmacyModule {}
