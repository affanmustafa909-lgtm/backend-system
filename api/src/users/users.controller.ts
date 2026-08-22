import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  acceptInviteSchema,
  createOrgUserSchema,
  inviteOrgUserSchema,
  resetUserPasswordSchema,
  setOwnPinSchema,
  updateOrgUserSchema,
} from "@platform/contracts";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "./permissions.guard";
import { RequirePermissions } from "./require-permission.decorator";
import { UsersService } from "./users.service";

@Controller("v1/users")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get("access-control")
  @RequirePermissions("pops.users.manage")
  getAccessControl() {
    return this.users.getAccessControl();
  }

  @Get()
  @RequirePermissions("pops.users.manage")
  list(@CurrentUser() user: AccessJwtPayload) {
    return this.users.listUsers(user.organizationId);
  }

  /** Waiters, cashiers, kitchen, etc. for printer assignment — any pops.read user. */
  @Get("assignable")
  @RequirePermissions("pops.read")
  listAssignable(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode?: string,
  ) {
    return this.users.listAssignableStaff(user.organizationId, branchCode?.trim());
  }

  @Get("invites")
  @RequirePermissions("pops.users.manage")
  listInvites(@CurrentUser() user: AccessJwtPayload) {
    return this.users.listPendingInvites(user.organizationId);
  }

  @Post()
  @RequirePermissions("pops.users.manage")
  create(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const parsed = createOrgUserSchema.parse(body);
    return this.users.createUser(user.organizationId, parsed);
  }

  @Post("invite")
  @RequirePermissions("pops.users.manage")
  invite(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const parsed = inviteOrgUserSchema.parse(body);
    return this.users.inviteUser(user.organizationId, parsed);
  }

  @Patch("me/pin")
  setOwnPin(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const parsed = setOwnPinSchema.parse(body);
    return this.users.setOwnPin(user.organizationId, user.sub, parsed.pin);
  }

  @Patch(":userId")
  @RequirePermissions("pops.users.manage")
  update(
    @CurrentUser() user: AccessJwtPayload,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    const parsed = updateOrgUserSchema.parse(body);
    return this.users.updateUser(user.organizationId, userId, parsed);
  }

  @Delete(":userId")
  @RequirePermissions("pops.users.manage")
  remove(@CurrentUser() user: AccessJwtPayload, @Param("userId") userId: string) {
    return this.users.deleteUser(user.organizationId, user.sub, userId);
  }

  @Post(":userId/reset-password")
  @RequirePermissions("pops.users.manage")
  resetPassword(
    @CurrentUser() user: AccessJwtPayload,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    const parsed = resetUserPasswordSchema.parse(body);
    return this.users.resetPassword(user.organizationId, userId, parsed.password);
  }
}
