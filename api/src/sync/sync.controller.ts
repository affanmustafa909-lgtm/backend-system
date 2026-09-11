import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import {
  syncPushBatchSchema,
  syncRegisterDeviceSchema,
  syncResolveSchema,
} from "@platform/contracts";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { SyncService } from "./sync.service";

@Controller("v1/sync")
@UseGuards(JwtAuthGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post("push")
  async push(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const batch = syncPushBatchSchema.parse(body);
    return this.sync.push(user.organizationId, user.sub, batch);
  }

  @Get("pull")
  async pull(@CurrentUser() user: AccessJwtPayload, @Query("cursor") cursor?: string) {
    return this.sync.pull(user.organizationId, cursor);
  }

  @Get("status")
  async status(@CurrentUser() user: AccessJwtPayload) {
    return this.sync.status(user.organizationId);
  }

  @Post("register-device")
  async register(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const input = syncRegisterDeviceSchema.parse(body);
    return this.sync.registerDevice(user.organizationId, user.sub, input);
  }

  @Post("initialize")
  async initialize(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const deviceId = typeof (body as { deviceId?: string })?.deviceId === "string" ? (body as { deviceId: string }).deviceId : undefined;
    return this.sync.initialize(user.organizationId, user.sub, deviceId);
  }

  @Post("resolve")
  async resolve(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const input = syncResolveSchema.parse(body);
    return this.sync.resolve(user.organizationId, input.conflictId, input.choice);
  }
}
