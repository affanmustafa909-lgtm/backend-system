import { Module } from "@nestjs/common";
import { PermissionsGuard } from "../users/permissions.guard";
import { SystemTypeGuard } from "../users/system-type.guard";
import { EmbroideryController } from "./embroidery.controller";
import { EmbroideryService } from "./embroidery.service";
import { FactoryController } from "./factory.controller";
import { FactoryService } from "./factory.service";

@Module({
  controllers: [EmbroideryController, FactoryController],
  providers: [EmbroideryService, FactoryService, PermissionsGuard, SystemTypeGuard],
  exports: [EmbroideryService, FactoryService],
})
export class EmbroideryModule {}
