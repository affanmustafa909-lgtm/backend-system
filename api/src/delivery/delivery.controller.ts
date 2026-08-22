import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createRiderSchema,
  riderDeliveryStatusUpdateSchema,
  updateDeliveryOrderSchema,
  updateRiderSchema,
} from "@platform/contracts";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { SystemTypeGuard } from "../users/system-type.guard";
import { RequireSystemType } from "../users/require-system-type.decorator";
import { DeliveryService } from "./delivery.service";

@Controller("v1/delivery")
@UseGuards(JwtAuthGuard, PermissionsGuard, SystemTypeGuard)
@RequireSystemType("restaurant")
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get("orders")
  @RequirePermissions("pops.read")
  listOrders(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.delivery.listDeliveryOrders(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("my-orders")
  @RequirePermissions("pops.delivery.manage")
  listMyOrders(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.delivery.listMyDeliveries(user, branchCode?.trim() ?? "");
  }

  @Patch("my-orders/:ticketId/status")
  @RequirePermissions("pops.delivery.manage")
  updateMyOrderStatus(
    @CurrentUser() user: AccessJwtPayload,
    @Param("ticketId") ticketId: string,
    @Body() body: unknown,
  ) {
    return this.delivery.updateRiderDeliveryStatus(
      user,
      ticketId,
      riderDeliveryStatusUpdateSchema.parse(body),
    );
  }

  @Get("riders")
  @RequirePermissions("pops.read")
  listRiders(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.delivery.listRiders(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("riders")
  @RequirePermissions("pops.read")
  createRider(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.delivery.createRider(user.organizationId, createRiderSchema.parse(body));
  }

  @Patch("riders/:riderId")
  @RequirePermissions("pops.read")
  updateRider(
    @CurrentUser() user: AccessJwtPayload,
    @Param("riderId") riderId: string,
    @Body() body: unknown,
  ) {
    return this.delivery.updateRider(user.organizationId, riderId, updateRiderSchema.parse(body));
  }

  @Patch("orders/:ticketId")
  @RequirePermissions("pops.read")
  updateOrder(
    @CurrentUser() user: AccessJwtPayload,
    @Param("ticketId") ticketId: string,
    @Body() body: unknown,
  ) {
    return this.delivery.updateDeliveryOrder(
      user.organizationId,
      ticketId,
      updateDeliveryOrderSchema.parse(body),
    );
  }
}
