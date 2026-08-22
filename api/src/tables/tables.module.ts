import { Module } from "@nestjs/common";
import { PermissionsGuard } from "../users/permissions.guard";
import { SystemTypeGuard } from "../users/system-type.guard";
import { TablesController } from "./tables.controller";
import { TablesService } from "./tables.service";

@Module({
  controllers: [TablesController],
  providers: [TablesService, PermissionsGuard, SystemTypeGuard],
  exports: [TablesService],
})
export class TablesModule {}
