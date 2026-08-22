import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createKitchenTicketSchema,
  updateKitchenTicketSchema,
} from "@platform/contracts";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { SystemTypeGuard } from "../users/system-type.guard";
import { RequireSystemType } from "../users/require-system-type.decorator";
import { KitchenService } from "./kitchen.service";

@Controller("v1/kitchen")
@UseGuards(JwtAuthGuard, PermissionsGuard, SystemTypeGuard)
@RequireSystemType("restaurant")
export class KitchenController {
  constructor(private readonly kitchen: KitchenService) {}

  @Get("tickets")
  @RequirePermissions("pops.read")
  listTickets(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("scope") scope?: string,
  ) {
    const parsed =
      scope === "done" || scope === "all" || scope === "active" ? scope : "active";
    return this.kitchen.listTickets(user.organizationId, branchCode?.trim() ?? "", parsed);
  }

  // Kitchen cancellations report (must be deployed).
  @Get("cancellations")
  @RequirePermissions("pops.read")
  listCancellations(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.kitchen.listCancellations(user.organizationId, branchCode?.trim() ?? "", {
      from: from?.trim() || undefined,
      to: to?.trim() || undefined,
    });
  }

  @Post("tickets")
  @RequirePermissions("pops.read")
  createTicket(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.kitchen.createTicket(
      user.organizationId,
      createKitchenTicketSchema.parse(body),
      user.sub,
    );
  }

  @Patch("tickets/:ticketId")
  @RequirePermissions("pops.read")
  updateTicket(
    @CurrentUser() user: AccessJwtPayload,
    @Param("ticketId") ticketId: string,
    @Body() body: unknown,
  ) {
    return this.kitchen.updateTicket(
      user.organizationId,
      ticketId,
      updateKitchenTicketSchema.parse(body),
      { userId: user.sub, role: user.role },
    );
  }

  @Post("tickets/bump-priority")
  @RequirePermissions("pops.kitchen.bump")
  bumpPriority(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.kitchen.bumpPriority(user.organizationId, branchCode?.trim() ?? "");
  }
}
