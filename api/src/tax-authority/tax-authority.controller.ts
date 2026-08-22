import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { isSuperAdmin, type AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { TaxAuthorityService } from "./tax-authority.service";

/**
 * Org Admin / Incharge may turn FBR·PRA Active / Inactive.
 * Super Admin only grants which sections are Allowed (platform business update).
 */
function assertCanToggleTaxActive(user: AccessJwtPayload): void {
  if (isSuperAdmin(user) || user.permissions?.includes("platform.businesses.manage")) return;
  const perms = user.permissions ?? [];
  if (perms.includes("*")) return;
  if (perms.includes("pops.users.manage") || perms.includes("pops.accounting.manage")) return;
  throw new ForbiddenException(
    "Only business Admin can turn FBR / PRA Active or Inactive. Super Admin decides which tax sections you can see.",
  );
}

@Controller()
export class TaxAuthorityController {
  constructor(private readonly tax: TaxAuthorityService) {}

  // ─── Public QR landing (no auth) ─────────────────────────────────────────

  @Get("v1/pra/public-verify")
  @Header("Content-Type", "text/html; charset=utf-8")
  async publicVerify(@Query("InvoiceNo") invoiceNo: string | undefined, @Res() res: Response) {
    const html = await this.tax.renderPublicPraVerifyHtml(invoiceNo?.trim() ?? "");
    res.status(200).send(html);
  }

  @Get("v1/pra/not-found")
  @Header("Content-Type", "text/html; charset=utf-8")
  notFoundPage(@Res() res: Response) {
    res.status(404).send(
      `<!doctype html><html><head><meta charset="utf-8"/><title>Not Found</title></head><body><h1>Not Found</h1></body></html>`,
    );
  }

  // ─── FBR ─────────────────────────────────────────────────────────────────

  @Post("v1/fbr/connect")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  connectFbr(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.tax.connectFbr(user.organizationId, body);
  }

  @Get("v1/fbr/status")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  fbrStatus(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.tax.getStatus(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("v1/fbr/refresh-token")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  refreshFbr(@CurrentUser() user: AccessJwtPayload, @Body() body: { branchCode?: string }) {
    return this.tax.refreshFbrToken(user.organizationId, body?.branchCode?.trim() ?? "");
  }

  @Post("v1/fbr/send-invoice")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  sendFbrInvoice(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.tax.sendInvoice(user.organizationId, "fbr", body);
  }

  @Get("v1/fbr/invoices")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  listFbrInvoices(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.tax.listInvoices(user.organizationId, branchCode?.trim() ?? "", "fbr");
  }

  // ─── PRA connect / status ────────────────────────────────────────────────

  @Post("v1/pra/connect")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  connectPra(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.tax.connectPra(user.organizationId, body);
  }

  @Post("v1/pra/test-connection")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  testPra(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.tax.testPraConnection(user.organizationId, body);
  }

  @Post("v1/pra/prepare-client-test")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  prepareClientTest(
    @CurrentUser() user: AccessJwtPayload,
    @Body() body: { branchCode?: string },
  ) {
    return this.tax.preparePraClientTest(user.organizationId, body?.branchCode?.trim() ?? "");
  }

  @Post("v1/pra/disconnect")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  disconnectPra(
    @CurrentUser() user: AccessJwtPayload,
    @Body() body: { branchCode?: string },
  ) {
    return this.tax.disconnectPra(user.organizationId, body?.branchCode?.trim() ?? "");
  }

  @Get("v1/pra/status")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  praStatus(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.tax.getStatus(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("v1/pra/refresh-token")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  refreshPra(@CurrentUser() user: AccessJwtPayload, @Body() body: { branchCode?: string }) {
    return this.tax.refreshPraToken(user.organizationId, body?.branchCode?.trim() ?? "");
  }

  @Patch("v1/pra/settings")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  updatePraSettings(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.tax.updatePraSettings(user.organizationId, body);
  }

  @Get("v1/pra/dashboard")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  praDashboard(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("mode") mode?: string,
  ) {
    return this.tax.getPraDashboard(
      user.organizationId,
      branchCode?.trim() ?? "",
      mode === "fake" ? "fake" : "real",
    );
  }

  @Get("v1/pra/reports")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  praReports(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("mode") mode?: string,
    @Query("period") period?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("status") status?: string,
  ) {
    return this.tax.getPraReports(user.organizationId, {
      branchCode: branchCode?.trim() ?? "",
      mode,
      period,
      from,
      to,
      status,
    });
  }

  @Get("v1/pra/activity-logs")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  praActivityLogs(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("limit") limit?: string,
  ) {
    const n = limit ? Number(limit) : 50;
    return this.tax.listActivityLogs(
      user.organizationId,
      branchCode?.trim() ?? "",
      Number.isFinite(n) ? n : 50,
    );
  }

  @Post("v1/pra/retry-failed")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  retryFailed(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.tax.retryFailedInvoices(user.organizationId, body);
  }

  @Post("v1/pra/send-invoice")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  sendPraInvoice(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.tax.sendInvoice(user.organizationId, "pra", body);
  }

  @Post("v1/pra/issue-invoice")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  issuePraInvoice(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.tax.issuePraInvoice(user.organizationId, body);
  }

  @Post("v1/pra/prepare-client-post")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  prepareClientPost(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.tax.preparePraClientPost(user.organizationId, body);
  }

  @Post("v1/pra/confirm-client-post")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  confirmClientPost(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.tax.confirmPraClientPost(user.organizationId, body);
  }

  @Get("v1/pra/fiscal-for-source")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  fiscalForSource(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("sourceType") sourceType: string,
    @Query("sourceId") sourceId: string,
  ) {
    return this.tax.getFiscalForSource(
      user.organizationId,
      branchCode?.trim() ?? "",
      (sourceType?.trim() || "bill") as "bill" | "pharmacy_sale" | "store_sale",
      sourceId?.trim() ?? "",
    );
  }

  @Get("v1/pra/invoices")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  listPraInvoices(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.tax.listInvoices(user.organizationId, branchCode?.trim() ?? "", "pra");
  }

  // ─── Tax features / status ───────────────────────────────────────────────

  @Get("v1/tax-authority/features")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  features(@CurrentUser() user: AccessJwtPayload) {
    return this.tax.getFeatures(user.organizationId);
  }

  /** Org Admin: Active/Inactive only (Allowed is Super Admin via platform). */
  @Patch("v1/tax-authority/features")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  setFeatures(
    @CurrentUser() user: AccessJwtPayload,
    @Body()
    body: {
      praEnabled?: boolean;
      fbrEnabled?: boolean;
      praFakeEnabled?: boolean;
      praRealEnabled?: boolean;
    },
  ) {
    assertCanToggleTaxActive(user);
    return this.tax.setFeatures(user.organizationId, {
      praEnabled: typeof body?.praEnabled === "boolean" ? body.praEnabled : undefined,
      fbrEnabled: typeof body?.fbrEnabled === "boolean" ? body.fbrEnabled : undefined,
      praFakeEnabled: typeof body?.praFakeEnabled === "boolean" ? body.praFakeEnabled : undefined,
      praRealEnabled: typeof body?.praRealEnabled === "boolean" ? body.praRealEnabled : undefined,
    });
  }

  @Get("v1/tax-authority/status")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  status(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.tax.getStatus(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("v1/tax-authority/invoices")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  listAll(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.tax.listInvoices(user.organizationId, branchCode?.trim() ?? "");
  }
}
