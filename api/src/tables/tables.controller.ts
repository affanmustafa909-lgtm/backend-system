import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createRestaurantTableSchema,
  createSeatingSectionSchema,
  updateRestaurantTableSchema,
  updateSeatingSectionSchema,
} from "@platform/contracts";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { SystemTypeGuard } from "../users/system-type.guard";
import { RequireSystemType } from "../users/require-system-type.decorator";
import { TablesService } from "./tables.service";

@Controller("v1/tables")
@UseGuards(JwtAuthGuard, PermissionsGuard, SystemTypeGuard)
@RequireSystemType("restaurant")
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get()
  @RequirePermissions("pops.read")
  getFloor(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.tables.getBranchFloor(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("admin")
  @RequirePermissions("pops.menu.manage")
  getFloorAdmin(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.tables.getBranchFloorAdmin(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("sections")
  @RequirePermissions("pops.menu.manage")
  createSection(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.tables.createSection(user.organizationId, createSeatingSectionSchema.parse(body));
  }

  @Patch("sections/:sectionId")
  @RequirePermissions("pops.menu.manage")
  updateSection(
    @CurrentUser() user: AccessJwtPayload,
    @Param("sectionId") sectionId: string,
    @Body() body: unknown,
  ) {
    return this.tables.updateSection(
      user.organizationId,
      sectionId,
      updateSeatingSectionSchema.parse(body),
    );
  }

  @Delete("sections/:sectionId")
  @RequirePermissions("pops.menu.manage")
  deleteSection(@CurrentUser() user: AccessJwtPayload, @Param("sectionId") sectionId: string) {
    return this.tables.deleteSection(user.organizationId, sectionId);
  }

  @Post()
  @RequirePermissions("pops.menu.manage")
  createTable(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.tables.createTable(user.organizationId, createRestaurantTableSchema.parse(body));
  }

  @Patch(":tableId")
  @RequirePermissions("pops.menu.manage")
  updateTable(
    @CurrentUser() user: AccessJwtPayload,
    @Param("tableId") tableId: string,
    @Body() body: unknown,
  ) {
    return this.tables.updateTable(
      user.organizationId,
      tableId,
      updateRestaurantTableSchema.parse(body),
    );
  }

  @Delete(":tableId")
  @RequirePermissions("pops.menu.manage")
  deleteTable(@CurrentUser() user: AccessJwtPayload, @Param("tableId") tableId: string) {
    return this.tables.deleteTable(user.organizationId, tableId);
  }
}
