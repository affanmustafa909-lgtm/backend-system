import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  Sse,
  UseGuards,
  MessageEvent,
} from "@nestjs/common";
import type { Response } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { PrintingService } from "./printing.service";
import { PrintingEvents } from "./printing.events";
import { Observable, interval, map, merge, takeUntil, Subject } from "rxjs";
import { OnModuleDestroy } from "@nestjs/common";

@Controller("v1/printing")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PrintingController implements OnModuleDestroy {
  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly printing: PrintingService,
    private readonly events: PrintingEvents,
  ) {}

  onModuleDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @Post("print-job")
  @RequirePermissions("pops.read")
  createJob(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.printing.createPrintJob(user, body);
  }

  /** Branch EXE claims next pending live/cloud print job for the branch. */
  @Post("jobs/claim")
  @RequirePermissions("pops.read")
  async claimJob(
    @CurrentUser() user: AccessJwtPayload,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const job = await this.printing.claimNextJob(
      user,
      (body ?? {}) as { branchCode?: string; serverId?: string },
    );
    if (!job) {
      res.status(HttpStatus.NO_CONTENT);
      return;
    }
    return job;
  }

  @Post("jobs/:jobId/complete")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("pops.read")
  completeJob(
    @CurrentUser() user: AccessJwtPayload,
    @Param("jobId") jobId: string,
    @Body() body: unknown,
  ) {
    return this.printing.completeJob(
      user,
      jobId,
      (body ?? {}) as { ok?: boolean; error?: string | null; localJobId?: string | null },
    );
  }

  @Get("printers")
  @RequirePermissions("pops.read")
  listPrinters(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode?: string,
  ) {
    return this.printing.listPrinters(user, branchCode);
  }

  @Post("printers")
  @RequirePermissions("pops.read")
  upsertPrinter(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.printing.upsertPrinter(
      user,
      body as {
        id?: string;
        branchCode: string;
        name: string;
        printerType?: string;
        windowsPrinterName?: string | null;
        ipAddress?: string | null;
        macAddress?: string | null;
        hostname?: string | null;
        port?: number | null;
        connectionType?: string;
        paperSize?: string;
        online?: boolean;
        backupPrinterId?: string | null;
        legacyProfileId?: string | null;
      },
    );
  }

  @Get("queue")
  @RequirePermissions("pops.read")
  listQueue(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode?: string,
  ) {
    return this.printing.listQueue(user, branchCode);
  }

  @Post("queue/:jobId/retry")
  @RequirePermissions("pops.read")
  retry(@CurrentUser() user: AccessJwtPayload, @Param("jobId") jobId: string) {
    return this.printing.queueAction(user, jobId, "retry");
  }

  @Post("queue/:jobId/pause")
  @RequirePermissions("pops.read")
  pause(@CurrentUser() user: AccessJwtPayload, @Param("jobId") jobId: string) {
    return this.printing.queueAction(user, jobId, "pause");
  }

  @Post("queue/:jobId/resume")
  @RequirePermissions("pops.read")
  resume(@CurrentUser() user: AccessJwtPayload, @Param("jobId") jobId: string) {
    return this.printing.queueAction(user, jobId, "resume");
  }

  @Post("queue/:jobId/cancel")
  @RequirePermissions("pops.read")
  cancel(@CurrentUser() user: AccessJwtPayload, @Param("jobId") jobId: string) {
    return this.printing.queueAction(user, jobId, "cancel");
  }

  @Post("queue/:jobId/reprint")
  @RequirePermissions("pops.read")
  reprint(@CurrentUser() user: AccessJwtPayload, @Param("jobId") jobId: string) {
    return this.printing.queueAction(user, jobId, "reprint");
  }

  @Post("discover")
  @RequirePermissions("pops.read")
  discover(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode?: string,
    @Query("onlineOnly") onlineOnly?: string,
  ) {
    return this.printing.discover(user, {
      branchCode,
      onlineOnly: onlineOnly !== "false" && onlineOnly !== "0",
    });
  }

  /** Online branch print servers (cloud registry from desktop heartbeats) — for mobile suggestions. */
  @Get("branch-servers")
  @RequirePermissions("pops.read")
  listBranchServers(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode?: string,
    @Query("onlineOnly") onlineOnly?: string,
  ) {
    return this.printing.discover(user, {
      branchCode,
      onlineOnly: onlineOnly !== "false" && onlineOnly !== "0",
    });
  }

  @Get("status")
  @RequirePermissions("pops.read")
  status(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode?: string,
  ) {
    return this.printing.status(user, branchCode);
  }

  @Post("branch-servers/heartbeat")
  @RequirePermissions("pops.read")
  heartbeat(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.printing.heartbeat(user, body);
  }

  @Get("alerts")
  @RequirePermissions("pops.read")
  alerts(@CurrentUser() user: AccessJwtPayload) {
    return this.printing.listAlerts(user);
  }

  /**
   * SSE stream of print events (works without Socket.IO deps).
   * Clients can also use Socket.IO namespace `/printing` when available.
   */
  @Sse("events")
  @RequirePermissions("pops.read")
  eventsStream(@CurrentUser() user: AccessJwtPayload): Observable<MessageEvent> {
    const orgId = user.organizationId;
    const bus$ = new Observable<MessageEvent>((subscriber) => {
      const handler = (msg: { event: string; payload: { organizationId: string } }) => {
        if (msg.payload.organizationId !== orgId) return;
        subscriber.next({
          data: { event: msg.event, ...msg.payload },
        } as MessageEvent);
      };
      this.events.on("*", handler as never);
      return () => this.events.off("*", handler as never);
    });
    const heartbeat$ = interval(25_000).pipe(
      map(() => ({ data: { event: "ping", at: new Date().toISOString() } }) as MessageEvent),
    );
    return merge(bus$, heartbeat$).pipe(takeUntil(this.destroy$));
  }
}
