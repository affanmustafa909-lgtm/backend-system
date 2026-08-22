import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { ReportsService } from "./reports.service";

@Controller("v1/reports")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("catalog")
  @RequirePermissions("pops.read")
  catalog() {
    return this.reports.catalog();
  }

  @Get(":reportId")
  @RequirePermissions("pops.read")
  getReport(
    @CurrentUser() user: AccessJwtPayload,
    @Param("reportId") reportId: string,
    @Query("branchCode") branchCode: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("fromTime") fromTime?: string,
    @Query("toTime") toTime?: string,
  ) {
    return this.reports.getReport(user.organizationId, branchCode?.trim() ?? "", reportId, {
      from: from?.trim() || undefined,
      to: to?.trim() || undefined,
      fromTime: fromTime?.trim() || undefined,
      toTime: toTime?.trim() || undefined,
    });
  }
}

// time filter deploy 2026-07-31T19:04:08.1963758+05:00
