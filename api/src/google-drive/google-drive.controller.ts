import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { GoogleDriveService } from "./google-drive.service";

@Controller("v1/google-drive")
export class GoogleDriveController {
  constructor(private readonly drive: GoogleDriveService) {}

  @Get("status")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  status(@CurrentUser() user: AccessJwtPayload) {
    return this.drive.getStatus(user.organizationId);
  }

  @Post("connect")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.users.manage")
  connect(
    @CurrentUser() user: AccessJwtPayload,
    @Body() body: { returnTo?: string } | undefined,
  ) {
    return this.drive.startConnect(user.organizationId, user.sub, body?.returnTo);
  }

  @Delete("disconnect")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.users.manage")
  disconnect(@CurrentUser() user: AccessJwtPayload) {
    return this.drive.disconnect(user.organizationId);
  }

  /** Browser redirect target after Google consent (no JWT — state is signed). */
  @Get("oauth/callback")
  async oauthCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Res() res: Response,
  ) {
    if (error) {
      res
        .status(400)
        .type("html")
        .send(htmlPage("Google Drive", `Connection cancelled: ${error}`, false, null));
      return;
    }
    if (!code || !state) {
      res
        .status(400)
        .type("html")
        .send(htmlPage("Google Drive", "Missing code or state.", false, null));
      return;
    }
    try {
      const result = await this.drive.handleOAuthCallback(code, state);
      res
        .status(200)
        .type("html")
        .send(
          htmlPage(
            "Google Drive connected",
            `Connected${result.email ? ` as ${escapeHtml(result.email)}` : ""}. This window should close automatically — or tap Return to MobiZone.`,
            true,
            result.returnTo,
          ),
        );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not connect Google Drive";
      res
        .status(400)
        .type("html")
        .send(htmlPage("Google Drive", escapeHtml(message), false, null));
    }
  }

  @Post("upload")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("pops.read")
  upload(
    @CurrentUser() user: AccessJwtPayload,
    @Body() body: { dataUrl?: string; fileName?: string; mimeType?: string },
  ) {
    return this.drive.uploadDataUrl(user.organizationId, {
      dataUrl: body?.dataUrl ?? "",
      fileName: body?.fileName,
      mimeType: body?.mimeType,
    });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlPage(
  title: string,
  message: string,
  ok: boolean,
  returnTo: string | null,
): string {
  const color = ok ? "#0F9B8E" : "#E11D48";
  const payload = ok ? "connected" : "error";
  const deepLink = "mobizone-erp://google-drive";
  const webFallback = "http://127.0.0.1:1420/pops/mobizone/google-drive";
  const primaryHref = returnTo || deepLink;
  const showWebLink = !returnTo || !returnTo.startsWith("mobizone-erp:");
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#0A1218;color:#E8EEF4;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}
.card{max-width:420px;background:#12202B;border:1px solid #243847;border-radius:16px;padding:24px}
h1{font-size:1.15rem;margin:0 0 8px;color:${color}}p{margin:0 0 16px;line-height:1.45;color:#8AA3B0}
.actions{display:flex;flex-wrap:wrap;gap:8px}
a,button{appearance:none;border:0;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer;text-decoration:none;font-size:14px}
.primary{background:#0F9B8E;color:#fff}.secondary{background:#1A2A36;color:#E8EEF4;border:1px solid #243847}</style></head>
<body><div class="card"><h1>${escapeHtml(title)}</h1><p>${message}</p>
<div class="actions">
  <a class="primary" id="mz-return" href="${escapeHtml(primaryHref)}">Return to MobiZone</a>
  ${showWebLink ? `<a class="secondary" href="${escapeHtml(returnTo && returnTo.startsWith("http") ? returnTo : webFallback)}">Open web app</a>` : `<a class="secondary" href="${escapeHtml(deepLink)}">Open app</a>`}
</div></div>
<script>
(function(){
  var payload = ${JSON.stringify(payload)};
  var returnTo = ${JSON.stringify(returnTo)};
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ source: "mz-google-drive", status: payload }, "*");
    }
  } catch (e) {}
  try { localStorage.setItem("mz-google-drive-oauth", payload + ":" + Date.now()); } catch (e) {}
  function goBack(){
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.focus();
        window.close();
        return;
      }
    } catch (e) {}
    var target = returnTo || ${JSON.stringify(deepLink)};
    window.location.href = target;
  }
  window.goBack = goBack;
  var btn = document.getElementById("mz-return");
  if (btn) btn.addEventListener("click", function(ev){
    if (window.opener && !window.opener.closed) {
      ev.preventDefault();
      goBack();
    }
  });
  ${ok ? "setTimeout(function(){ try { if (window.opener && !window.opener.closed) window.close(); } catch(e){} }, 900);" : ""}
  ${ok && returnTo ? `setTimeout(function(){ if (!window.opener || window.opener.closed) { window.location.href = ${JSON.stringify(returnTo)}; } }, 1200);` : ""}
})();
</script></body></html>`;
}
