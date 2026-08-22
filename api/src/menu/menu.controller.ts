import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  createMenuCategorySchema,
  createMenuItemSchema,
  updateMenuCategorySchema,
  updateMenuItemSchema,
} from "@platform/contracts";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { SystemTypeGuard } from "../users/system-type.guard";
import { RequireSystemType } from "../users/require-system-type.decorator";
import { MenuService } from "./menu.service";
import { MenuUploadService } from "./menu-upload.service";
import type { MenuUploadedFile } from "./menu-upload.types";

@Controller("v1/menu")
@UseGuards(JwtAuthGuard, PermissionsGuard, SystemTypeGuard)
@RequireSystemType("restaurant")
export class MenuController {
  constructor(
    private readonly menu: MenuService,
    private readonly uploads: MenuUploadService,
  ) {}

  @Get()
  @RequirePermissions("pops.read")
  getMenu(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.menu.getBranchMenu(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("admin")
  @RequirePermissions("pops.menu.manage")
  getMenuAdmin(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.menu.getBranchMenuAdmin(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("categories")
  @RequirePermissions("pops.menu.manage")
  createCategory(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.menu.createCategory(user.organizationId, createMenuCategorySchema.parse(body));
  }

  @Patch("categories/:categoryId")
  @RequirePermissions("pops.menu.manage")
  updateCategory(
    @CurrentUser() user: AccessJwtPayload,
    @Param("categoryId") categoryId: string,
    @Body() body: unknown,
  ) {
    return this.menu.updateCategory(
      user.organizationId,
      categoryId,
      updateMenuCategorySchema.parse(body),
    );
  }

  @Delete("categories/:categoryId")
  @RequirePermissions("pops.menu.manage")
  deleteCategory(@CurrentUser() user: AccessJwtPayload, @Param("categoryId") categoryId: string) {
    return this.menu.deleteCategory(user.organizationId, categoryId);
  }

  @Post("items")
  @RequirePermissions("pops.menu.manage")
  createItem(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.menu.createItem(user.organizationId, createMenuItemSchema.parse(body));
  }

  @Patch("items/:itemId")
  @RequirePermissions("pops.menu.manage")
  updateItem(
    @CurrentUser() user: AccessJwtPayload,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
  ) {
    return this.menu.updateItem(user.organizationId, itemId, updateMenuItemSchema.parse(body));
  }

  @Delete("items/:itemId")
  @RequirePermissions("pops.menu.manage")
  deleteItem(@CurrentUser() user: AccessJwtPayload, @Param("itemId") itemId: string) {
    return this.menu.deleteItem(user.organizationId, itemId);
  }

  @Post("upload-image")
  @RequirePermissions("pops.menu.manage")
  @UseInterceptors(
    FileInterceptor("image", {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadImage(@CurrentUser() user: AccessJwtPayload, @UploadedFile() file: MenuUploadedFile) {
    return this.uploads.saveMenuImage(user.organizationId, file).then((imageUrl) => ({ imageUrl }));
  }
}
