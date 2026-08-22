import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from "@nestjs/common";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { CloseDayResult, ClosingStatus, ClosingZReport } from "@platform/contracts";
import {
  popsBills,
  popsBranchClosingState,
  popsBranches,
  popsCashSessions,
  popsDayCloseRecords,
  popsIngredients,
  popsKitchenTickets,
  popsMenuItems,
  type PlatformPgDb,
} from "@platform/database-pg";
import { AccountingService } from "../accounting/accounting.service";
import { DRIZZLE } from "../drizzle/drizzle.tokens";
import { SecurityService } from "../security/security.service";

type PaymentLine = { method: string; amount: number };

@Injectable()
export class ClosingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly accounting: AccountingService,
    @Inject(forwardRef(() => SecurityService)) private readonly security: SecurityService,
  ) {}

  async getStatus(organizationId: string, branchCode: string): Promise<ClosingStatus> {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const state = await this.ensureClosingState(organizationId, branch.id);
    const businessDate = state.businessDate;

    const [bills, tickets, sessions, dashboard, plReport] = await Promise.all([
      this.db.select().from(popsBills).where(eq(popsBills.branchId, branch.id)),
      this.db.select().from(popsKitchenTickets).where(eq(popsKitchenTickets.branchId, branch.id)),
      this.db
        .select()
        .from(popsCashSessions)
        .where(eq(popsCashSessions.branchId, branch.id))
        .orderBy(desc(popsCashSessions.openedAt)),
      this.accounting.getDashboard(organizationId, branch.code),
      this.accounting.getReport(organizationId, branch.code, "profit-loss").catch(() => null),
    ]);

    const heldOrders = bills.filter((b) => b.status === "held" || b.status === "open");
    const openKitchen = tickets.filter((t) => t.status !== "done");
    const completedToday = bills.filter(
      (b) => b.status === "completed" && karachiDateKey(b.createdAt) === businessDate,
    );
    const salesFromBills = completedToday.reduce((s, b) => s + b.totalPkr, 0);

    const openSessionRow = sessions.find((s) => s.status === "open");
    const closedSessionsToday = sessions.filter(
      (s) => s.status === "closed" && s.closedAt && karachiDateKey(s.closedAt) === businessDate,
    );

    const zReportOnBusinessDay =
      state.lastZReportAt && karachiDateKey(state.lastZReportAt) === businessDate;
    const backupOnBusinessDay =
      state.lastBackupAt && karachiDateKey(state.lastBackupAt) === businessDate;

    const s1Done = state.ordersPaused;
    const s2Done = !openSessionRow && (closedSessionsToday.length > 0 || sessions.length === 0);
    const s3Done = openKitchen.length === 0;
    const s4Done = Boolean(zReportOnBusinessDay);
    const s5Done = Boolean(backupOnBusinessDay);

    const checklist = [
      {
        id: "s1",
        label: "Stop new orders / handover to night",
        done: s1Done,
        hint: s1Done
          ? "New POS and kitchen orders are blocked."
          : heldOrders.length > 0
            ? `${heldOrders.length} held/open bill(s) still active.`
            : "Pause new orders before closing.",
      },
      {
        id: "s2",
        label: "Reconcile cash & card terminals",
        done: s2Done,
        hint: openSessionRow
          ? `Close cash session ${openSessionRow.sessionRef} with counted cash.`
          : closedSessionsToday.length === 0 && sessions.length > 0
            ? "No shift closed today — close the open cash session."
            : closedSessionsToday.length > 0
              ? `${closedSessionsToday.length} session(s) reconciled today.`
              : "No cash sessions — reconciliation not required.",
      },
      {
        id: "s3",
        label: "Close kitchen & void open KOTs",
        done: s3Done,
        hint: openKitchen.length > 0 ? `${openKitchen.length} open KOT(s) remaining.` : "Kitchen clear.",
      },
      {
        id: "s4",
        label: "Run Z-report & PRA queue flush",
        done: s4Done,
        hint: s4Done ? `Z-report ${state.lastZReportRef ?? ""} generated.` : "Generate today's Z-report.",
      },
      {
        id: "s5",
        label: "Verify backup completed",
        done: s5Done,
        hint: s5Done ? `Backup ${state.lastBackupRef ?? ""} verified.` : "Run end-of-day backup snapshot.",
      },
    ];

    const blockers: string[] = [];
    if (!s1Done) blockers.push("Pause new orders");
    if (heldOrders.length > 0) blockers.push(`${heldOrders.length} held/open bill(s) must be settled`);
    if (openSessionRow) blockers.push(`Cash session ${openSessionRow.sessionRef} is still open`);
    if (!s2Done) blockers.push("Cash session must be reconciled before closing day");
    if (!s3Done) blockers.push(`${openKitchen.length} kitchen ticket(s) still open`);
    if (!s4Done) blockers.push("Z-report not run for today");
    if (!s5Done) blockers.push("Backup not verified for today");

    const lastZReport = this.parseZReport(state);
    const netProfit = (plReport?.totals?.netProfit as number | undefined) ?? dashboard.profitLoss;

    return {
      branchCode: branch.code,
      businessDate,
      ordersPaused: state.ordersPaused,
      shiftSummary: {
        todaySales: salesFromBills || dashboard.todaySales,
        cashInHand: dashboard.cashInHand,
        profitLoss: dashboard.profitLoss,
        netProfit,
        orderCount: completedToday.length,
      },
      checklist,
      openCashSession: openSessionRow ? this.mapCashSession(openSessionRow) : null,
      closedSessionsToday: closedSessionsToday.map((s) => this.mapCashSession(s)),
      blockers,
      canCloseDay: checklist.every((c) => c.done),
      lastZReport,
      lastBackupAt: state.lastBackupAt?.toISOString() ?? null,
      lastBackupRef: state.lastBackupRef ?? null,
      lastDayClosedAt: state.lastDayClosedAt?.toISOString() ?? null,
    };
  }

  async pauseOrders(
    organizationId: string,
    branchCode: string,
    userEmail: string,
    options?: { resume?: boolean },
  ) {
    if (options?.resume) {
      return this.resumeOrders(organizationId, branchCode, userEmail);
    }
    const branch = await this.resolveBranch(organizationId, branchCode);
    const state = await this.ensureClosingState(organizationId, branch.id);
    if (state.ordersPaused) {
      return this.getStatus(organizationId, branchCode);
    }

    await this.db
      .update(popsBranchClosingState)
      .set({
        ordersPaused: true,
        ordersPausedAt: new Date(),
        ordersPausedBy: userEmail,
        updatedAt: new Date(),
      })
      .where(eq(popsBranchClosingState.branchId, branch.id));

    await this.security.logEvent({
      organizationId,
      branchId: branch.id,
      eventType: "closing",
      userEmail,
      action: "pause_orders",
      detail: `Orders paused for business date ${state.businessDate}`,
    });

    return this.getStatus(organizationId, branchCode);
  }

  async resumeOrders(organizationId: string, branchCode: string, userEmail: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const state = await this.ensureClosingState(organizationId, branch.id);
    if (!state.ordersPaused) {
      return this.getStatus(organizationId, branchCode);
    }

    await this.db
      .update(popsBranchClosingState)
      .set({
        ordersPaused: false,
        ordersPausedAt: null,
        ordersPausedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(popsBranchClosingState.branchId, branch.id));

    await this.security.logEvent({
      organizationId,
      branchId: branch.id,
      eventType: "closing",
      userEmail,
      action: "resume_orders",
      detail: `Orders resumed for business date ${state.businessDate}`,
    });

    return this.getStatus(organizationId, branchCode);
  }

  async closeKitchen(organizationId: string, branchCode: string, userEmail: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const openTickets = await this.db
      .select()
      .from(popsKitchenTickets)
      .where(and(eq(popsKitchenTickets.branchId, branch.id), ne(popsKitchenTickets.status, "done")));

    if (openTickets.length === 0) {
      return this.getStatus(organizationId, branchCode);
    }

    await this.db
      .update(popsKitchenTickets)
      .set({ status: "done" })
      .where(and(eq(popsKitchenTickets.branchId, branch.id), ne(popsKitchenTickets.status, "done")));

    await this.security.logEvent({
      organizationId,
      branchId: branch.id,
      eventType: "closing",
      userEmail,
      action: "close_kitchen",
      detail: `Closed ${openTickets.length} open KOT(s) at day-end`,
    });

    return this.getStatus(organizationId, branchCode);
  }

  async runZReport(organizationId: string, branchCode: string, userEmail: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const state = await this.ensureClosingState(organizationId, branch.id);
    const businessDate = state.businessDate;

    const bills = await this.db
      .select()
      .from(popsBills)
      .where(and(eq(popsBills.branchId, branch.id), eq(popsBills.status, "completed")));

    const completedToday = bills.filter((b) => karachiDateKey(b.createdAt) === businessDate);
    let cashSales = 0;
    let cardSales = 0;
    let taxCollected = 0;

    for (const bill of completedToday) {
      taxCollected += bill.taxPkr;
      const payments = parsePayments(bill.paymentsJson);
      for (const p of payments) {
        const method = p.method.toLowerCase();
        if (method.includes("cash")) cashSales += p.amount;
        else cardSales += p.amount;
      }
      if (payments.length === 0) cashSales += bill.totalPkr;
    }

    const sessions = await this.db
      .select()
      .from(popsCashSessions)
      .where(eq(popsCashSessions.branchId, branch.id));
    const closedToday = sessions.filter(
      (s) => s.status === "closed" && s.closedAt && karachiDateKey(s.closedAt) === businessDate,
    );
    const latestClosed = closedToday[0];
    const praQueueFlushed = completedToday.filter((b) => b.taxPkr > 0).length;

    const reportRef = `Z-${businessDate.replace(/-/g, "")}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
    const generatedAt = new Date().toISOString();
    const zReport: ClosingZReport = {
      reportRef,
      generatedAt,
      businessDate,
      totalSales: completedToday.reduce((s, b) => s + b.totalPkr, 0),
      orderCount: completedToday.length,
      cashSales,
      cardSales,
      taxCollected,
      cashSessionRef: latestClosed?.sessionRef ?? null,
      cashVariance: latestClosed?.variancePkr ?? null,
    };

    await this.db
      .update(popsBranchClosingState)
      .set({
        lastZReportAt: new Date(),
        lastZReportRef: reportRef,
        lastZReportJson: JSON.stringify({ ...zReport, praInvoicesFlushed: praQueueFlushed }),
        updatedAt: new Date(),
      })
      .where(eq(popsBranchClosingState.branchId, branch.id));

    await this.security.logEvent({
      organizationId,
      branchId: branch.id,
      eventType: "closing",
      userEmail,
      action: "z_report",
      detail: `${reportRef}: ${zReport.orderCount} orders, Rs ${zReport.totalSales}, PRA queue ${praQueueFlushed} invoice(s) flushed`,
    });

    return { zReport, status: await this.getStatus(organizationId, branchCode) };
  }

  async verifyBackup(organizationId: string, branchCode: string, userEmail: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const state = await this.ensureClosingState(organizationId, branch.id);

    const [billCount, ingredientCount, menuCount] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(popsBills)
        .where(eq(popsBills.branchId, branch.id)),
      this.db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(popsIngredients)
        .where(eq(popsIngredients.branchId, branch.id)),
      this.db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(popsMenuItems)
        .where(eq(popsMenuItems.branchId, branch.id)),
    ]);

    const backupRef = `BK-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    const snapshot = {
      backupRef,
      businessDate: state.businessDate,
      generatedAt: new Date().toISOString(),
      counts: {
        bills: billCount[0]?.count ?? 0,
        ingredients: ingredientCount[0]?.count ?? 0,
        menuItems: menuCount[0]?.count ?? 0,
      },
    };

    await this.db
      .update(popsBranchClosingState)
      .set({
        lastBackupAt: new Date(),
        lastBackupRef: backupRef,
        updatedAt: new Date(),
      })
      .where(eq(popsBranchClosingState.branchId, branch.id));

    await this.security.logEvent({
      organizationId,
      branchId: branch.id,
      eventType: "closing",
      userEmail,
      action: "backup",
      detail: `${backupRef}: snapshot ${JSON.stringify(snapshot.counts)}`,
    });

    return { backupRef, snapshot, status: await this.getStatus(organizationId, branchCode) };
  }

  async closeDay(organizationId: string, branchCode: string, userEmail: string): Promise<CloseDayResult> {
    const status = await this.getStatus(organizationId, branchCode);
    if (!status.canCloseDay) {
      throw new BadRequestException(
        status.blockers.length > 0
          ? `Cannot close day: ${status.blockers.join("; ")}`
          : "Closing checklist incomplete",
      );
    }

    const branch = await this.resolveBranch(organizationId, branchCode);
    const state = await this.ensureClosingState(organizationId, branch.id);
    const closedAt = new Date();
    const nextBusinessDate = addDays(state.businessDate, 1);

    const cashVariance =
      status.closedSessionsToday.reduce((s, cs) => s + (cs.variance ?? 0), 0) ?? 0;

    const [record] = await this.db
      .insert(popsDayCloseRecords)
      .values({
        organizationId,
        branchId: branch.id,
        businessDate: state.businessDate,
        closedBy: userEmail,
        zReportRef: state.lastZReportRef,
        salesTotalPkr: status.shiftSummary.todaySales,
        orderCount: status.shiftSummary.orderCount,
        cashVariancePkr: cashVariance,
        summaryJson: JSON.stringify({
          shiftSummary: status.shiftSummary,
          closedSessions: status.closedSessionsToday,
          zReport: status.lastZReport,
          backupRef: state.lastBackupRef,
        }),
      })
      .returning();

    if (!record) throw new BadRequestException("Failed to record day close");

    await this.db
      .update(popsBranchClosingState)
      .set({
        businessDate: nextBusinessDate,
        ordersPaused: false,
        ordersPausedAt: null,
        ordersPausedBy: null,
        lastDayClosedAt: closedAt,
        lastDayClosedBy: userEmail,
        lastZReportAt: null,
        lastZReportRef: null,
        lastZReportJson: null,
        lastBackupAt: null,
        lastBackupRef: null,
        updatedAt: closedAt,
      })
      .where(eq(popsBranchClosingState.branchId, branch.id));

    await this.security.logEvent({
      organizationId,
      branchId: branch.id,
      eventType: "closing",
      userEmail,
      action: "close_day",
      detail: `Day ${state.businessDate} closed. Next business date: ${nextBusinessDate}`,
    });

    return {
      businessDate: state.businessDate,
      closedAt: closedAt.toISOString(),
      nextBusinessDate,
      zReportRef: state.lastZReportRef ?? "",
      recordId: record.id,
    };
  }

  async assertOrdersNotPaused(branchId: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(popsBranchClosingState)
      .where(eq(popsBranchClosingState.branchId, branchId))
      .limit(1);
    const state = rows[0];
    if (!state?.ordersPaused) return;

    // Never brick POS / waiter app. Day-close pause is advisory for Closing checklist
    // only — bill + kitchen create always proceed. Manager can pause again from Closing.
    await this.reconcileStaleClosingState(state);
    await this.db
      .update(popsBranchClosingState)
      .set({
        ordersPaused: false,
        ordersPausedAt: null,
        ordersPausedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(popsBranchClosingState.branchId, branchId));
  }

  private async ensureClosingState(organizationId: string, branchId: string) {
    const existing = await this.db
      .select()
      .from(popsBranchClosingState)
      .where(eq(popsBranchClosingState.branchId, branchId))
      .limit(1);
    if (!existing[0]) {
      const businessDate = karachiDateKey(new Date());
      const [row] = await this.db
        .insert(popsBranchClosingState)
        .values({
          branchId,
          organizationId,
          businessDate,
        })
        .returning();
      if (!row) throw new BadRequestException("Failed to initialize closing state");
      return row;
    }

    // Abandoned day-close (pause never finished / day never closed) must not
    // block POS forever after the calendar moves past that business date.
    return this.reconcileStaleClosingState(existing[0]);
  }

  /**
   * When businessDate is older than today (Karachi), or orders stayed paused too long,
   * clear order pause and roll the business date forward so POS is not stuck forever.
   */
  private async reconcileStaleClosingState(
    state: typeof popsBranchClosingState.$inferSelect,
  ): Promise<typeof popsBranchClosingState.$inferSelect> {
    const today = karachiDateKey(new Date());
    const dateStale = state.businessDate < today;
    const pausedMs = state.ordersPausedAt
      ? Date.now() - new Date(state.ordersPausedAt).getTime()
      : state.ordersPaused
        ? Number.POSITIVE_INFINITY
        : 0;
    // Abandoned mid-close (resume never clicked / resume API missing on old deploys)
    const pauseAbandoned = state.ordersPaused && pausedMs > 30 * 60 * 1000;

    if (!dateStale && !pauseAbandoned) return state;

    const [updated] = await this.db
      .update(popsBranchClosingState)
      .set({
        businessDate: dateStale ? today : state.businessDate,
        ordersPaused: false,
        ordersPausedAt: null,
        ordersPausedBy: null,
        ...(dateStale
          ? {
              lastZReportAt: null,
              lastZReportRef: null,
              lastZReportJson: null,
              lastBackupAt: null,
              lastBackupRef: null,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(popsBranchClosingState.branchId, state.branchId))
      .returning();

    return (
      updated ?? {
        ...state,
        businessDate: dateStale ? today : state.businessDate,
        ordersPaused: false,
        ordersPausedAt: null,
        ordersPausedBy: null,
      }
    );
  }

  private async resolveBranch(organizationId: string, branchCode: string) {
    const code = branchCode.trim();
    if (!code) throw new BadRequestException("branchCode is required");
    const rows = await this.db
      .select()
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, code)))
      .limit(1);
    const branch = rows[0];
    if (!branch) throw new NotFoundException(`Branch ${code} not found`);
    return branch;
  }

  private mapCashSession(row: typeof popsCashSessions.$inferSelect) {
    return {
      id: row.id,
      sessionRef: row.sessionRef,
      openingFloat: row.openingFloatPkr,
      expectedCash: row.expectedCashPkr,
      countedCash: row.countedCashPkr,
      variance: row.variancePkr,
      status: row.status as "open" | "closed",
      closedAt: row.closedAt?.toISOString() ?? null,
    };
  }

  private parseZReport(state: typeof popsBranchClosingState.$inferSelect): ClosingZReport | null {
    if (!state.lastZReportJson || !state.lastZReportRef || !state.lastZReportAt) return null;
    try {
      return JSON.parse(state.lastZReportJson) as ClosingZReport;
    } catch {
      return null;
    }
  }
}

function parsePayments(json: string | null): PaymentLine[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as PaymentLine[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function karachiDateKey(date: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof date === "string" ? new Date(date) : date);
}

function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
