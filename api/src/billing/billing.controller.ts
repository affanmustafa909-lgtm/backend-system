import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  completeBillSchema,
  createBillSchema,
  createWaiterSchema,
  updateBillSchema,
  updateWaiterSchema,
} from "@platform/contracts";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { BillingService } from "./billing.service";

@Controller("v1/billing")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get("waiters")
  @RequirePermissions("pops.read")
  listWaiters(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode?: string) {
    return this.billing.listWaiters(user.organizationId, branchCode?.trim());
  }

  @Post("waiters")
  @RequirePermissions("pops.users.manage")
  createWaiter(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.billing.createWaiter(user.organizationId, createWaiterSchema.parse(body));
  }

  @Patch("waiters/:waiterId")
  @RequirePermissions("pops.users.manage")
  updateWaiter(
    @CurrentUser() user: AccessJwtPayload,
    @Param("waiterId") waiterId: string,
    @Body() body: unknown,
  ) {
    return this.billing.updateWaiter(user.organizationId, waiterId, updateWaiterSchema.parse(body));
  }

  @Get("orders")
  @RequirePermissions("pops.read")
  listOrders(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.billing.listOrders(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("bills")
  @RequirePermissions("pops.read")
  createBill(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const input = createBillSchema.parse(body);
    // Staff (waiter/cashier/manager) may close with status completed — same as EXE Close / Pay.
    return this.billing.createBill(user.organizationId, input);
  }

  @Patch("bills/:billId/complete")
  @RequirePermissions("pops.read")
  completeBill(
    @CurrentUser() user: AccessJwtPayload,
    @Param("billId") billId: string,
    @Body() body: unknown,
  ) {
    // Waiters may close held bills (staff app Close) — same as createBill completed.
    return this.billing.completeBill(user.organizationId, billId, completeBillSchema.parse(body));
  }

  @Patch("bills/:billId")
  @RequirePermissions("pops.read")
  updateBill(
    @CurrentUser() user: AccessJwtPayload,
    @Param("billId") billId: string,
    @Body() body: unknown,
  ) {
    return this.billing.updateBill(user.organizationId, billId, updateBillSchema.parse(body), {
      userId: user.sub,
      role: user.role,
    });
  }

  @Patch("bills/:billId/void")
  @RequirePermissions("pops.read")
  voidBill(@CurrentUser() user: AccessJwtPayload, @Param("billId") billId: string) {
    return this.billing.voidBill(user.organizationId, billId);
  }

  @Delete("bills/:billId")
  @RequirePermissions("pops.read")
  deleteBill(@CurrentUser() user: AccessJwtPayload, @Param("billId") billId: string) {
    return this.billing.deleteBill(user.organizationId, billId);
  }
}
