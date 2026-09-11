import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type {
  CompleteFieldForceVisit,
  GenerateFieldForceVisits,
} from "@platform/contracts";
import {
  pharmacyCollections,
  pharmacyDistOrders,
  pharmacyTradeCustomers,
  pharmacyVisits,
  popsEmployees,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import type { AccessJwtPayload } from "../../auth/jwt.types";
import { FieldForceNumberingService } from "./field-force-numbering.service";
import { FieldForcePjpService } from "./pjp.service";
import {
  assertVisitOwner,
  resolveBranch,
  writeAudit,
} from "./field-force.shared";

const OPEN = new Set(["planned", "started"]);

@Injectable()
export class FieldForceVisitService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly numbering: FieldForceNumberingService,
    private readonly pjp: FieldForcePjpService,
  ) {}

  async list(
    organizationId: string,
    filters: {
      from?: string;
      to?: string;
      date?: string;
      employeeId?: string;
      tradeCustomerId?: string;
      territoryId?: string;
      routeId?: string;
      status?: string;
      outcome?: string;
      branchCode?: string;
      q?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    const branch = await resolveBranch(this.db, organizationId, filters.branchCode);
    const conds: SQL[] = [eq(pharmacyVisits.organizationId, organizationId)];
    if (filters.date) conds.push(eq(pharmacyVisits.plannedDate, filters.date));
    if (filters.from) conds.push(sql`coalesce(${pharmacyVisits.plannedDate}, ${pharmacyVisits.visitedAt}::date) >= ${filters.from}`);
    if (filters.to) conds.push(sql`coalesce(${pharmacyVisits.plannedDate}, ${pharmacyVisits.visitedAt}::date) <= ${filters.to}`);
    if (filters.employeeId) conds.push(eq(pharmacyVisits.employeeId, filters.employeeId));
    if (filters.tradeCustomerId) conds.push(eq(pharmacyVisits.tradeCustomerId, filters.tradeCustomerId));
    if (filters.territoryId) conds.push(eq(pharmacyVisits.territoryId, filters.territoryId));
    if (filters.routeId) conds.push(eq(pharmacyVisits.routeId, filters.routeId));
    if (filters.status) conds.push(eq(pharmacyVisits.status, filters.status));
    if (filters.outcome) conds.push(eq(pharmacyVisits.outcome, filters.outcome));
    if (branch) conds.push(eq(pharmacyVisits.branchId, branch.id));
    if (filters.q?.trim()) {
      const q = `%${filters.q.trim()}%`;
      conds.push(
        or(
          ilike(pharmacyVisits.visitNumber, q),
          ilike(pharmacyTradeCustomers.name, q),
          ilike(popsEmployees.displayName, q),
        )!,
      );
    }

    const [countRow] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(pharmacyVisits)
      .leftJoin(pharmacyTradeCustomers, eq(pharmacyTradeCustomers.id, pharmacyVisits.tradeCustomerId))
      .leftJoin(popsEmployees, eq(popsEmployees.id, pharmacyVisits.employeeId))
      .where(and(...conds));

    const items = await this.db
      .select({
        id: pharmacyVisits.id,
        visitNumber: pharmacyVisits.visitNumber,
        status: pharmacyVisits.status,
        outcome: pharmacyVisits.outcome,
        plannedDate: pharmacyVisits.plannedDate,
        plannedSequence: pharmacyVisits.plannedSequence,
        visitedAt: pharmacyVisits.visitedAt,
        startedAt: pharmacyVisits.startedAt,
        completedAt: pharmacyVisits.completedAt,
        employeeId: pharmacyVisits.employeeId,
        employeeName: popsEmployees.displayName,
        tradeCustomerId: pharmacyVisits.tradeCustomerId,
        customerName: pharmacyTradeCustomers.name,
        customerCode: pharmacyTradeCustomers.code,
        outstandingPkr: pharmacyTradeCustomers.outstandingPkr,
        address: pharmacyTradeCustomers.address,
        phone: pharmacyTradeCustomers.phone,
        routeId: pharmacyVisits.routeId,
        territoryId: pharmacyVisits.territoryId,
        pjpId: pharmacyVisits.pjpId,
        pjpVersion: pharmacyVisits.pjpVersion,
        orderId: pharmacyVisits.orderId,
        collectionId: pharmacyVisits.collectionId,
        followUpRequired: pharmacyVisits.followUpRequired,
        followUpDate: pharmacyVisits.followUpDate,
        notes: pharmacyVisits.notes,
        reason: pharmacyVisits.reason,
      })
      .from(pharmacyVisits)
      .leftJoin(pharmacyTradeCustomers, eq(pharmacyTradeCustomers.id, pharmacyVisits.tradeCustomerId))
      .leftJoin(popsEmployees, eq(popsEmployees.id, pharmacyVisits.employeeId))
      .where(and(...conds))
      .orderBy(pharmacyVisits.plannedSequence, desc(pharmacyVisits.plannedDate), desc(pharmacyVisits.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const total = Number(countRow?.n ?? 0);
    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async getById(organizationId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(pharmacyVisits)
      .where(and(eq(pharmacyVisits.organizationId, organizationId), eq(pharmacyVisits.id, id)))
      .limit(1);
    if (!row) throw new NotFoundException("Visit not found");
    return row;
  }

  async generate(organizationId: string, input: GenerateFieldForceVisits, user: AccessJwtPayload) {
    const date = input.date;
    const plans = await this.pjp.activeForGenerate(organizationId, date, input.employeeId, input.pjpId);
    let created = 0;
    let skipped = 0;
    const visits = [];
    for (const { pjp, lines } of plans) {
      for (const line of lines) {
        try {
          const row = await this.numbering.withNumber(organizationId, "visit", async (visitNumber) => {
            const [inserted] = await this.db
              .insert(pharmacyVisits)
              .values({
                organizationId,
                visitNumber,
                employeeId: pjp.employeeId,
                tradeCustomerId: line.tradeCustomerId,
                plannedDate: date,
                plannedSequence: line.sequenceNo,
                status: "planned",
                purpose: "pjp",
                pjpId: pjp.id,
                pjpVersion: pjp.version,
                routeId: line.routeId ?? pjp.routeId,
                territoryId: pjp.territoryId,
                branchId: pjp.branchId,
                idempotencyKey: input.idempotencyKey
                  ? `${input.idempotencyKey}:${pjp.id}:${line.tradeCustomerId}:${date}`
                  : `${pjp.id}:${line.tradeCustomerId}:${date}`,
                createdByUserId: user.sub,
              })
              .returning();
            return inserted;
          });
          if (row) {
            created += 1;
            visits.push(row);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/unique|duplicate/i.test(msg)) {
            skipped += 1;
            continue;
          }
          throw err;
        }
      }
    }
    return { date, created, skipped, visits: visits.length, plans: plans.length };
  }

  async start(
    organizationId: string,
    id: string,
    input: { latitude?: string; longitude?: string; locationAccuracy?: string; idempotencyKey?: string },
    user: AccessJwtPayload,
  ) {
    const visit = await this.getById(organizationId, id);
    await assertVisitOwner(this.db, user, visit.employeeId);
    if (visit.status === "started") return visit;
    if (visit.status !== "planned") throw new BadRequestException(`Cannot start a ${visit.status} visit`);
    const now = new Date();
    const [updated] = await this.db
      .update(pharmacyVisits)
      .set({
        status: "started",
        startedAt: now,
        visitedAt: now,
        latitude: input.latitude ?? visit.latitude,
        longitude: input.longitude ?? visit.longitude,
        locationAccuracy: input.locationAccuracy ?? visit.locationAccuracy,
        locationCapturedAt: input.latitude ? now : visit.locationCapturedAt,
      })
      .where(eq(pharmacyVisits.id, id))
      .returning();
    await writeAudit(this.db, organizationId, {
      entityType: "visit",
      entityId: id,
      action: "start",
      oldValue: { status: visit.status },
      newValue: { status: "started" },
      userId: user.sub,
    });
    return updated;
  }

  async complete(organizationId: string, id: string, input: CompleteFieldForceVisit, user: AccessJwtPayload) {
    const visit = await this.getById(organizationId, id);
    await assertVisitOwner(this.db, user, visit.employeeId);
    if (visit.status === "completed" && input.idempotencyKey) return visit;
    if (!OPEN.has(visit.status)) throw new BadRequestException(`Cannot complete a ${visit.status} visit`);
    if (!visit.startedAt && visit.status !== "started") {
      throw new BadRequestException("Start the visit before completing it");
    }
    if (input.followUpRequired && !input.followUpDate) {
      throw new BadRequestException("Follow-up date is required when follow-up is required");
    }
    if (input.orderId) {
      const [ord] = await this.db
        .select({ id: pharmacyDistOrders.id })
        .from(pharmacyDistOrders)
        .where(and(eq(pharmacyDistOrders.organizationId, organizationId), eq(pharmacyDistOrders.id, input.orderId)))
        .limit(1);
      if (!ord) throw new BadRequestException("Linked order not found");
    }
    if (input.collectionId) {
      const [col] = await this.db
        .select({ id: pharmacyCollections.id })
        .from(pharmacyCollections)
        .where(and(eq(pharmacyCollections.organizationId, organizationId), eq(pharmacyCollections.id, input.collectionId)))
        .limit(1);
      if (!col) throw new BadRequestException("Linked collection not found");
    }
    const now = new Date();
    const [updated] = await this.db
      .update(pharmacyVisits)
      .set({
        status: "completed",
        outcome: input.outcome,
        notes: input.notes ?? visit.notes,
        contactPerson: input.contactPerson ?? visit.contactPerson,
        customerFeedback: input.customerFeedback ?? visit.customerFeedback,
        orderId: input.orderId ?? visit.orderId,
        collectionId: input.collectionId ?? visit.collectionId,
        followUpRequired: input.followUpRequired ?? false,
        followUpDate: input.followUpDate ?? null,
        followUpAction: input.followUpAction ?? null,
        nextVisitDate: input.nextVisitDate ?? null,
        completedAt: now,
        visitedAt: visit.visitedAt ?? now,
        startedAt: visit.startedAt ?? now,
        productive: ["order_taken", "collection_received", "order_and_collection"].includes(input.outcome),
        latitude: input.latitude ?? visit.latitude,
        longitude: input.longitude ?? visit.longitude,
        locationAccuracy: input.locationAccuracy ?? visit.locationAccuracy,
        locationCapturedAt: input.latitude ? now : visit.locationCapturedAt,
      })
      .where(eq(pharmacyVisits.id, id))
      .returning();
    await writeAudit(this.db, organizationId, {
      entityType: "visit",
      entityId: id,
      action: "complete",
      oldValue: { status: visit.status },
      newValue: { status: "completed", outcome: input.outcome },
      userId: user.sub,
    });
    return updated;
  }

  async miss(organizationId: string, id: string, reason: string | undefined, user: AccessJwtPayload) {
    const visit = await this.getById(organizationId, id);
    await assertVisitOwner(this.db, user, visit.employeeId);
    if (!OPEN.has(visit.status) && visit.status !== "planned") {
      throw new BadRequestException(`Cannot miss a ${visit.status} visit`);
    }
    const [updated] = await this.db
      .update(pharmacyVisits)
      .set({ status: "missed", reason: reason ?? "missed" })
      .where(eq(pharmacyVisits.id, id))
      .returning();
    await writeAudit(this.db, organizationId, {
      entityType: "visit",
      entityId: id,
      action: "miss",
      reason,
      userId: user.sub,
    });
    return updated;
  }

  async cancel(organizationId: string, id: string, reason: string | undefined, user: AccessJwtPayload) {
    const visit = await this.getById(organizationId, id);
    if (!OPEN.has(visit.status)) throw new BadRequestException(`Cannot cancel a ${visit.status} visit`);
    const [updated] = await this.db
      .update(pharmacyVisits)
      .set({ status: "cancelled", reason: reason ?? "cancelled" })
      .where(eq(pharmacyVisits.id, id))
      .returning();
    await writeAudit(this.db, organizationId, {
      entityType: "visit",
      entityId: id,
      action: "cancel",
      reason,
      userId: user.sub,
    });
    return updated;
  }

  async reschedule(organizationId: string, id: string, newDate: string, reason: string, user: AccessJwtPayload) {
    const visit = await this.getById(organizationId, id);
    if (!OPEN.has(visit.status) && visit.status !== "missed") {
      throw new BadRequestException(`Cannot reschedule a ${visit.status} visit`);
    }
    const created = await this.numbering.withNumber(organizationId, "visit", async (visitNumber) => {
      const [row] = await this.db
        .insert(pharmacyVisits)
        .values({
          organizationId,
          visitNumber,
          employeeId: visit.employeeId,
          tradeCustomerId: visit.tradeCustomerId,
          plannedDate: newDate,
          plannedSequence: visit.plannedSequence,
          status: "planned",
          purpose: visit.purpose,
          pjpId: visit.pjpId,
          pjpVersion: visit.pjpVersion,
          routeId: visit.routeId,
          territoryId: visit.territoryId,
          branchId: visit.branchId,
          rescheduledFromId: visit.id,
          reason,
          createdByUserId: user.sub,
        })
        .returning();
      return row;
    });
    await this.db
      .update(pharmacyVisits)
      .set({ status: "rescheduled", reason })
      .where(eq(pharmacyVisits.id, id));
    await writeAudit(this.db, organizationId, {
      entityType: "visit",
      entityId: id,
      action: "reschedule",
      oldValue: { plannedDate: visit.plannedDate },
      newValue: { plannedDate: newDate, newVisitId: created?.id },
      reason,
      userId: user.sub,
    });
    return { originalId: id, visit: created };
  }

  async closeDay(organizationId: string, date: string, employeeId?: string, branchCode?: string) {
    const today = new Date().toISOString().slice(0, 10);
    if (date >= today) throw new BadRequestException("Only past planned dates can be auto-missed");
    const branch = await resolveBranch(this.db, organizationId, branchCode);
    const conds: SQL[] = [
      eq(pharmacyVisits.organizationId, organizationId),
      eq(pharmacyVisits.plannedDate, date),
      eq(pharmacyVisits.status, "planned"),
    ];
    if (employeeId) conds.push(eq(pharmacyVisits.employeeId, employeeId));
    if (branch) conds.push(eq(pharmacyVisits.branchId, branch.id));
    const updated = await this.db
      .update(pharmacyVisits)
      .set({ status: "missed", reason: "auto_missed" })
      .where(and(...conds))
      .returning();
    return { date, missed: updated.length };
  }

  async context(organizationId: string, id: string, user: AccessJwtPayload) {
    const visit = await this.getById(organizationId, id);
    if (!user.permissions.includes("*") && !user.permissions.includes("field.manage") && !user.permissions.includes("distribution.field")) {
      try {
        await assertVisitOwner(this.db, user, visit.employeeId);
      } catch {
        throw new ForbiddenException("You cannot view this visit");
      }
    }
    let customer = null;
    if (visit.tradeCustomerId) {
      const [c] = await this.db
        .select()
        .from(pharmacyTradeCustomers)
        .where(eq(pharmacyTradeCustomers.id, visit.tradeCustomerId))
        .limit(1);
      customer = c ?? null;
    }
    return { visit, customer };
  }
}
