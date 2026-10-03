import { Module } from "@nestjs/common";
import { PermissionsGuard } from "../users/permissions.guard";
import { SystemTypeGuard } from "../users/system-type.guard";
import { EducationController } from "./education.controller";
import { EducationExtraService } from "./education-extra.service";
import { EducationOpsService } from "./education-ops.service";
import { EducationService } from "./education.service";

@Module({
  controllers: [EducationController],
  providers: [EducationService, EducationOpsService, EducationExtraService, PermissionsGuard, SystemTypeGuard],
  exports: [EducationService, EducationOpsService, EducationExtraService],
})
export class EducationModule {}
