import { Module, forwardRef } from "@nestjs/common";
import { AccountingModule } from "../accounting/accounting.module";
import { SecurityModule } from "../security/security.module";
import { PermissionsGuard } from "../users/permissions.guard";
import { ClosingController } from "./closing.controller";
import { ClosingService } from "./closing.service";

@Module({
  imports: [AccountingModule, forwardRef(() => SecurityModule)],
  controllers: [ClosingController],
  providers: [ClosingService, PermissionsGuard],
  exports: [ClosingService],
})
export class ClosingModule {}
