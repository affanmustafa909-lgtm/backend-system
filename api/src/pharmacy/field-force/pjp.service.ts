import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { CreateFieldForcePjp } from "@platform/contracts";
import {
  pharmacyPjpLines,
  pharmacyPjps,
  pharmacyRouteCustomers,
  pharmacySalesForceProfiles,
  pharmacyTradeCustomers,
  popsEmployees,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { FieldForceNumberingService } from "./field-force-numbering.service";
import { resolveBranch, weekdayOf, writeAudit } from "./field-force.shared";

@Injectable()
export class FieldForcePjpService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly numbering: FieldForceNumberingService,
  ) {}

  async list(
    organizationId: string,
    filters: { employeeId?: string; status?: string; branchCode?: string; page?: number; pageSize?: number } = {},
  ) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    const branch = await resolveBranch(this.db, organizationId, filters.branchCode);
    const conds: SQL[] = [eq(pharmacyPjps.organizationId, organizationId)];
    if (filters.employeeId) conds.push(eq(pharmacyPjps.employeeId, filters.employeeId));
    if (filters.status) conds.push(eq(pharmacyPjps.status, filters.status));
    if (branch) conds.push(eq(pharmacyPjps.branchId, branch.id));

    const rows = await this.db
      .select({
        id: pharmacyPjps.id,
        pjpNumber: pharmacyPjps.pjpNumber,
        name: pharmacyPjps.name,
        employeeId: pharmacyPjps.employeeId,
        employeeName: popsEmployees.displayName,
        territoryId: pharmacyPjps.territoryId,
        routeId: pharmacyPjps.routeId,
        effectiveFrom: pharmacyPjps.effectiveFrom,
        effectiveTo: pharmacyPjps.effectiveTo,
        status: pharmacyPjps.status,
        frequency: pharmacyPjps.frequency,
        version: pharmacyPjps.version,
        previousPjpId: pharmacyPjps.previousPjpId,
        lineCount: sql<number>`(select count(*)::int from ${pharmacyPjpLines} where ${pharmacyPjpLines.pjpId} = ${pharmacyPjps.id})`,
      })
      .from(pharmacyPjps)
      .innerJoin(popsEmployees, eq(popsEmployees.id, pharmacyPjps.employeeId))
      .where(and(...conds))
      .orderBy(desc(pharmacyPjps.createdAt));

    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total: rows.length,
      totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
    };
  }

  async getById(organizationId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(pharmacyPjps)
      .where(and(eq(pharmacyPjps.organizationId, organizationId), eq(pharmacyPjps.id, id)))
      .limit(1);
    if (!row) throw new NotFoundException("PJP not found");
    const lines = await this.db
      .select({
        id: pharmacyPjpLines.id,
        dayOfWeek: pharmacyPjpLines.dayOfWeek,
        tradeCustomerId: pharmacyPjpLines.tradeCustomerId,
        routeId: pharmacyPjpLines.routeId,
        sequenceNo: pharmacyPjpLines.sequenceNo,
        visitType: pharmacyPjpLines.visitType,
        priority: pharmacyPjpLines.priority,
        plannedDurationMin: pharmacyPjpLines.plannedDurationMin,
        notes: pharmacyPjpLines.notes,
        customerName: pharmacyTradeCustomers.name,
        customerCode: pharmacyTradeCustomers.code,
      })
      .from(pharmacyPjpLines)
      .innerJoin(pharmacyTradeCustomers, eq(pharmacyTradeCustomers.id, pharmacyPjpLines.tradeCustomerId))
      .where(eq(pharmacyPjpLines.pjpId, id))
      .orderBy(pharmacyPjpLines.dayOfWeek, pharmacyPjpLines.sequenceNo);
    return { ...row, lines };
  }

  async create(organizationId: string, input: CreateFieldForcePjp, userId?: string, previous?: { id: string; version: number }) {
    await this.assertSalesmanActive(organizationId, input.employeeId);
    const branch = await resolveBranch(this.db, organizationId, input.branchCode);
    return this.numbering.withNumber(organizationId, "pjp", async (pjpNumber) => {
      const [row] = await this.db
        .insert(pharmacyPjps)
        .values({
          organizationId,
          branchId: branch?.id ?? null,
          pjpNumber,
          name: input.name,
          employeeId: input.employeeId,
          territoryId: input.territoryId ?? null,
          routeId: input.routeId ?? null,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo ?? null,
          frequency: input.frequency ?? "weekly",
          workingDays: input.workingDays ?? null,
          notes: input.notes ?? null,
          version: previous ? previous.version + 1 : 1,
          previousPjpId: previous?.id ?? null,
          changeReason: "changeReason" in input ? (input as { changeReason?: string }).changeReason ?? null : null,
          createdByUserId: userId ?? null,
        })
        .returning();
      if (!row) throw new BadRequestException("Failed to create PJP");
      await this.db.insert(pharmacyPjpLines).values(
        input.lines.map((line, i) => ({
          pjpId: row.id,
          dayOfWeek: line.dayOfWeek ?? null,
          tradeCustomerId: line.tradeCustomerId,
          routeId: line.routeId ?? input.routeId ?? null,
          sequenceNo: line.sequenceNo ?? i + 1,
          visitType: line.visitType ?? "regular",
          priority: line.priority ?? "normal",
          plannedDurationMin: line.plannedDurationMin ?? null,
          notes: line.notes ?? null,
        })),
      );
      await writeAudit(this.db, organizationId, {
        entityType: "pjp",
        entityId: row.id,
        action: previous ? "revise" : "create",
        newValue: { pjpNumber, version: row.version },
        reason: previous ? (input as { changeReason?: string }).changeReason : null,
        userId,
      });
      return this.getById(organizationId, row.id);
    });
  }

  async revise(organizationId: string, id: string, input: CreateFieldForcePjp & { changeReason: string }, userId?: string) {
    const current = await this.getById(organizationId, id);
    if (current.status !== "active") throw new BadRequestException("Only an active PJP can be revised");
    await this.db
      .update(pharmacyPjps)
      .set({ status: "superseded", effectiveTo: input.effectiveFrom })
      .where(eq(pharmacyPjps.id, id));
    return this.create(organizationId, input, userId, { id: current.id, version: current.version });
  }

  async cancel(organizationId: string, id: string, reason: string, userId?: string) {
    const current = await this.getById(organizationId, id);
    await this.db.update(pharmacyPjps).set({ status: "cancelled" }).where(eq(pharmacyPjps.id, id));
    await writeAudit(this.db, organizationId, {
      entityType: "pjp",
      entityId: id,
      action: "cancel",
      oldValue: { status: current.status },
      newValue: { status: "cancelled" },
      reason,
      userId,
    });
    return this.getById(organizationId, id);
  }

  /** Lines that apply on a calendar date for an active PJP. */
  linesForDate(
    pjp: { frequency: string; workingDays: string | null; effectiveFrom: string; effectiveTo: string | null },
    lines: { dayOfWeek: number | null; tradeCustomerId: string; routeId: string | null; sequenceNo: number; priority: string }[],
    dateIso: string,
  ) {
    if (pjp.effectiveFrom > dateIso) return [];
    if (pjp.effectiveTo && pjp.effectiveTo < dateIso) return [];
    const dow = weekdayOf(dateIso);
    if (pjp.workingDays) {
      const allowed = pjp.workingDays.split(",").map((s) => Number(s.trim()));
      if (allowed.length && !allowed.includes(dow)) return [];
    }
    if (pjp.frequency === "daily") return lines;
    if (pjp.frequency === "weekly" || pjp.frequency === "custom") {
      return lines.filter((l) => l.dayOfWeek == null || l.dayOfWeek === dow);
    }
    if (pjp.frequency === "biweekly") {
      const start = new Date(`${pjp.effectiveFrom}T00:00:00Z`);
      const cur = new Date(`${dateIso}T00:00:00Z`);
      const weeks = Math.floor((cur.getTime() - start.getTime()) / 604_800_000);
      if (weeks % 2 !== 0) return [];
      return lines.filter((l) => l.dayOfWeek == null || l.dayOfWeek === dow);
    }
    if (pjp.frequency === "monthly") {
      const day = Number(dateIso.slice(8, 10));
      return lines.filter((l) => l.dayOfWeek == null || l.dayOfWeek === day % 7);
    }
    return lines.filter((l) => l.dayOfWeek == null || l.dayOfWeek === dow);
  }

  async activeForGenerate(organizationId: string, dateIso: string, employeeId?: string, pjpId?: string) {
    const conds: SQL[] = [
      eq(pharmacyPjps.organizationId, organizationId),
      eq(pharmacyPjps.status, "active"),
      sql`${pharmacyPjps.effectiveFrom} <= ${dateIso}`,
      sql`(${pharmacyPjps.effectiveTo} is null or ${pharmacyPjps.effectiveTo} >= ${dateIso})`,
    ];
    if (employeeId) conds.push(eq(pharmacyPjps.employeeId, employeeId));
    if (pjpId) conds.push(eq(pharmacyPjps.id, pjpId));
    const headers = await this.db.select().from(pharmacyPjps).where(and(...conds));
    const out = [];
    for (const pjp of headers) {
      const lines = await this.db.select().from(pharmacyPjpLines).where(eq(pharmacyPjpLines.pjpId, pjp.id));
      out.push({ pjp, lines: this.linesForDate(pjp, lines, dateIso) });
    }
    return out;
  }

  async seedLinesFromRoute(organizationId: string, routeId: string) {
    return this.db
      .select()
      .from(pharmacyRouteCustomers)
      .where(
        and(eq(pharmacyRouteCustomers.organizationId, organizationId), eq(pharmacyRouteCustomers.routeId, routeId)),
      );
  }

  private async assertSalesmanActive(organizationId: string, employeeId: string) {
    const [profile] = await this.db
      .select()
      .from(pharmacySalesForceProfiles)
      .where(
        and(
          eq(pharmacySalesForceProfiles.organizationId, organizationId),
          eq(pharmacySalesForceProfiles.employeeId, employeeId),
        ),
      )
      .limit(1);
    if (profile && profile.status !== "active") {
      throw new BadRequestException("Inactive salesmen cannot receive new PJP assignments");
    }
  }
}
