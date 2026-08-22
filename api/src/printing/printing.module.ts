import { Module } from "@nestjs/common";
import { PermissionsGuard } from "../users/permissions.guard";
import { PrintingController } from "./printing.controller";
import { PrintingService } from "./printing.service";
import { PrintingEvents } from "./printing.events";
import { PrintingGateway } from "./printing.gateway";
import { PrintingCloudQueue } from "./printing.cloud-queue";

@Module({
  controllers: [PrintingController],
  providers: [
    PrintingService,
    PrintingEvents,
    PrintingGateway,
    PrintingCloudQueue,
    PermissionsGuard,
  ],
  exports: [PrintingService, PrintingEvents, PrintingCloudQueue],
})
export class PrintingModule {}
