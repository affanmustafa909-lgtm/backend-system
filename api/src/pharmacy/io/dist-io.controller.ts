import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { CurrentUser } from "../../auth/current-user.decorator";
import type { AccessJwtPayload } from "../../auth/jwt.types";
import { PermissionsGuard } from "../../users/permissions.guard";
import { RequirePermissions } from "../../users/require-permission.decorator";
import { SystemTypeGuard } from "../../users/system-type.guard";
import { RequireSystemType } from "../../users/require-system-type.decorator";
import { DistIoService } from "./dist-io.service";

@Controller("v1/pharmacy/io")
@UseGuards(JwtAuthGuard, PermissionsGuard, SystemTypeGuard)
@RequireSystemType("pharmacy", "distribution")
export class DistIoController {
  constructor(private readonly io: DistIoService) {}

  @Get("modules")
  @RequirePermissions("pops.read", "distribution.masters", "pharmacy.view")
  modules() {
    return this.io.modules();
  }

  @Get("templates/:module")
  @RequirePermissions("pops.read", "distribution.masters", "pharmacy.view")
  template(@Param("module") module: string) {
    return this.io.template(module);
  }

  @Post("validate")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  validate(@CurrentUser() user: AccessJwtPayload, @Body() body: Record<string, unknown>) {
    return this.io.validate(user.organizationId, String(body.branchCode ?? ""), {
      module: String(body.module ?? ""),
      headers: Array.isArray(body.headers) ? (body.headers as string[]) : [],
      rows: Array.isArray(body.rows) ? (body.rows as string[][]) : [],
      mapping: (body.mapping as Record<string, string>) ?? {},
    });
  }

  @Post("commit")
  @RequirePermissions("distribution.masters", "pharmacy.inventory.manage", "pops.inventory.manage")
  commit(@CurrentUser() user: AccessJwtPayload, @Body() body: Record<string, unknown>) {
    return this.io.commit(user.organizationId, user.sub, String(body.branchCode ?? ""), {
      module: String(body.module ?? ""),
      headers: Array.isArray(body.headers) ? (body.headers as string[]) : [],
      rows: Array.isArray(body.rows) ? (body.rows as string[][]) : [],
      mapping: (body.mapping as Record<string, string>) ?? {},
      fileName: typeof body.fileName === "string" ? body.fileName : undefined,
      importValidOnly: body.importValidOnly === true,
    });
  }

  @Get("jobs")
  @RequirePermissions("pops.read", "distribution.masters", "pharmacy.view")
  jobs(
    @CurrentUser() user: AccessJwtPayload,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.io.listJobs(user.organizationId, page ? Number(page) : 1, pageSize ? Number(pageSize) : 25);
  }

  @Get("jobs/:id")
  @RequirePermissions("pops.read", "distribution.masters", "pharmacy.view")
  job(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.io.getJob(user.organizationId, id);
  }

  @Post("export")
  @RequirePermissions("pops.read", "distribution.masters", "pharmacy.view")
  exportCsv(@CurrentUser() user: AccessJwtPayload, @Body() body: Record<string, unknown>) {
    return this.io.exportCsv(
      user.organizationId,
      user.sub,
      String(body.branchCode ?? ""),
      String(body.module ?? ""),
      typeof body.q === "string" ? body.q : undefined,
    );
  }

  @Get("audit")
  @RequirePermissions("pops.read", "pops.users.manage", "distribution.masters")
  audit(
    @CurrentUser() user: AccessJwtPayload,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.io.listAudit(user.organizationId, page ? Number(page) : 1, pageSize ? Number(pageSize) : 50);
  }
}
