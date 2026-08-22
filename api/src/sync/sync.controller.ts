import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { syncPushBatchSchema } from "@platform/contracts";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { SyncService } from "./sync.service";

@Controller("v1/sync")
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post("push")
  @UseGuards(JwtAuthGuard)
  async push(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const batch = syncPushBatchSchema.parse(body);
    return this.sync.push(user.organizationId, batch);
  }
}
