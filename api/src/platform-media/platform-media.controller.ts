import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { PlatformMediaService } from "./platform-media.service";
import type { PlatformMediaUploadedFile } from "./platform-media.types";

@Controller("v1/platform/media")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PlatformMediaController {
  constructor(private readonly media: PlatformMediaService) {}

  @Get("summary")
  @RequirePermissions("platform.users.manage")
  summary(@CurrentUser() user: AccessJwtPayload) {
    this.media.assertSuperAdmin(user);
    return this.media.summarize();
  }

  @Get()
  @RequirePermissions("platform.users.manage")
  list(
    @CurrentUser() user: AccessJwtPayload,
    @Query("organizationId") organizationId?: string,
    @Query("userId") userId?: string,
    @Query("flagStatus") flagStatus?: string,
    @Query("kind") kind?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    this.media.assertSuperAdmin(user);
    return this.media.list({
      organizationId: organizationId?.trim() || undefined,
      userId: userId?.trim() || undefined,
      flagStatus: flagStatus?.trim() || undefined,
      kind: kind?.trim() || undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /** Authenticated tenants + Super Admin — compresses images server-side. */
  @Post("upload")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
  )
  upload(
    @CurrentUser() user: AccessJwtPayload,
    @UploadedFile() file: PlatformMediaUploadedFile,
    @Body() body: { organizationId?: string; source?: string },
  ) {
    return this.media.upload(user, file, {
      organizationId: body?.organizationId?.trim() || undefined,
      source: body?.source?.trim() || "upload",
    });
  }

  @Post("reindex-menu")
  @RequirePermissions("platform.users.manage")
  reindex(@CurrentUser() user: AccessJwtPayload) {
    this.media.assertSuperAdmin(user);
    return this.media.reindexMenu();
  }

  @Get(":id/download")
  @RequirePermissions("platform.users.manage")
  async download(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Res({ passthrough: true }) _res: Response,
  ) {
    this.media.assertSuperAdmin(user);
    return this.media.download(id);
  }

  @Post(":id/flag")
  @RequirePermissions("platform.users.manage")
  flag(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: { status?: string; note?: string },
  ) {
    this.media.assertSuperAdmin(user);
    const status = (body?.status ?? "flagged") as "none" | "flagged" | "approved" | "rejected";
    if (!["none", "flagged", "approved", "rejected"].includes(status)) {
      return this.media.flag(id, { status: "flagged", note: body?.note }, user);
    }
    return this.media.flag(id, { status, note: body?.note }, user);
  }

  @Delete(":id")
  @RequirePermissions("platform.users.manage")
  remove(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    this.media.assertSuperAdmin(user);
    return this.media.softDelete(id);
  }
}
