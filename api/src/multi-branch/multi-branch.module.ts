import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { OperationsModule } from "../operations/operations.module";
import { PermissionsGuard } from "../users/permissions.guard";
import { MultiBranchController } from "./multi-branch.controller";
import { MultiBranchService } from "./multi-branch.service";

@Module({
  imports: [OperationsModule, BillingModule],
  controllers: [MultiBranchController],
  providers: [MultiBranchService, PermissionsGuard],
  exports: [MultiBranchService],
})
export class MultiBranchModule {}
