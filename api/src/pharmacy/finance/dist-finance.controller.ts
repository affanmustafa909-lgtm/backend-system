import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { CurrentUser } from "../../auth/current-user.decorator";
import type { AccessJwtPayload } from "../../auth/jwt.types";
import { PermissionsGuard } from "../../users/permissions.guard";
import { RequirePermissions } from "../../users/require-permission.decorator";
import { SystemTypeGuard } from "../../users/system-type.guard";
import { RequireSystemType } from "../../users/require-system-type.decorator";
import { DistFinanceService } from "./dist-finance.service";

@Controller("v1/pharmacy/finance")
@UseGuards(JwtAuthGuard, PermissionsGuard, SystemTypeGuard)
@RequireSystemType("pharmacy", "distribution")
export class DistFinanceController {
  constructor(private readonly finance: DistFinanceService) {}

  @Get("dashboard")
  @RequirePermissions("pops.read", "finance.view", "pops.accounting.manage")
  dashboard(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.finance.getDashboard(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("reconciliation")
  @RequirePermissions("pops.read", "finance.view", "finance.reconcile", "pops.accounting.manage")
  reconciliation(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.finance.getReconciliation(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("customer-ledger/:id")
  @RequirePermissions("pops.read", "finance.view", "collection.view")
  customerLedger(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.finance.getCustomerStatement(user.organizationId, id);
  }

  @Get("supplier-ledger/:id")
  @RequirePermissions("pops.read", "finance.view", "purchase.view", "pharmacy.purchase.view")
  supplierLedger(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Query("branchCode") branchCode?: string,
  ) {
    return this.finance.getSupplierLedger(user.organizationId, id, branchCode?.trim());
  }
}
