import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import type { FieldForceRouteCustomer } from "@platform/contracts";
import {
  pharmacyRouteCustomers,
  pharmacyRoutes,
  pharmacyTradeCustomers,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { writeAudit } from "./field-force.shared";

@Injectable()
export class FieldForceRoutePlanService {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  async getRoute(organizationId: string, routeId: string) {
    const [route] = await this.db
      .select()
      .from(pharmacyRoutes)
      .where(and(eq(pharmacyRoutes.organizationId, organizationId), eq(pharmacyRoutes.id, routeId)))
      .limit(1);
    if (!route) throw new NotFoundException("Route not found");
    const stops = await this.listStops(organizationId, routeId);
    return { ...route, customers: stops, estimatedVisitCount: stops.length };
  }

  async listStops(organizationId: string, routeId: string) {
    return this.db
      .select({
        id: pharmacyRouteCustomers.id,
        routeId: pharmacyRouteCustomers.routeId,
        tradeCustomerId: pharmacyRouteCustomers.tradeCustomerId,
        sequenceNo: pharmacyRouteCustomers.sequenceNo,
        preferredVisitDay: pharmacyRouteCustomers.preferredVisitDay,
        visitFrequency: pharmacyRouteCustomers.visitFrequency,
        priority: pharmacyRouteCustomers.priority,
        notes: pharmacyRouteCustomers.notes,
        customerCode: pharmacyTradeCustomers.code,
        customerName: pharmacyTradeCustomers.name,
        customerStatus: pharmacyTradeCustomers.status,
        outstandingPkr: pharmacyTradeCustomers.outstandingPkr,
      })
      .from(pharmacyRouteCustomers)
      .innerJoin(pharmacyTradeCustomers, eq(pharmacyTradeCustomers.id, pharmacyRouteCustomers.tradeCustomerId))
      .where(
        and(
          eq(pharmacyRouteCustomers.organizationId, organizationId),
          eq(pharmacyRouteCustomers.routeId, routeId),
        ),
      )
      .orderBy(asc(pharmacyRouteCustomers.sequenceNo));
  }

  async addStop(organizationId: string, routeId: string, input: FieldForceRouteCustomer, userId?: string) {
    const route = await this.getRouteBare(organizationId, routeId);
    if (route.status !== "active") throw new BadRequestException("Cannot add customers to an inactive route");
    const [cust] = await this.db
      .select()
      .from(pharmacyTradeCustomers)
      .where(
        and(eq(pharmacyTradeCustomers.organizationId, organizationId), eq(pharmacyTradeCustomers.id, input.tradeCustomerId)),
      )
      .limit(1);
    if (!cust) throw new NotFoundException("Customer not found");
    if (cust.status !== "active") throw new BadRequestException("Cannot assign an inactive customer to a route");

    const [max] = await this.db
      .select({ n: sql<number>`coalesce(max(${pharmacyRouteCustomers.sequenceNo}), 0)` })
      .from(pharmacyRouteCustomers)
      .where(eq(pharmacyRouteCustomers.routeId, routeId));
    const sequenceNo = input.sequenceNo ?? Number(max?.n ?? 0) + 1;

    const [row] = await this.db
      .insert(pharmacyRouteCustomers)
      .values({
        organizationId,
        routeId,
        tradeCustomerId: input.tradeCustomerId,
        sequenceNo,
        preferredVisitDay: input.preferredVisitDay ?? null,
        visitFrequency: input.visitFrequency ?? "weekly",
        priority: input.priority ?? "normal",
        notes: input.notes ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to add route customer (duplicate?)");

    await this.db
      .update(pharmacyTradeCustomers)
      .set({ routeId })
      .where(eq(pharmacyTradeCustomers.id, cust.id));

    await writeAudit(this.db, organizationId, {
      entityType: "route_customer",
      entityId: row.id,
      action: "add",
      newValue: row,
      userId,
    });
    return row;
  }

  async removeStop(organizationId: string, routeId: string, tradeCustomerId: string, userId?: string) {
    const [removed] = await this.db
      .delete(pharmacyRouteCustomers)
      .where(
        and(
          eq(pharmacyRouteCustomers.organizationId, organizationId),
          eq(pharmacyRouteCustomers.routeId, routeId),
          eq(pharmacyRouteCustomers.tradeCustomerId, tradeCustomerId),
        ),
      )
      .returning();
    if (!removed) throw new NotFoundException("Route customer not found");
    await writeAudit(this.db, organizationId, {
      entityType: "route_customer",
      entityId: removed.id,
      action: "remove",
      oldValue: removed,
      userId,
    });
    return { ok: true };
  }

  async reorder(organizationId: string, routeId: string, customerIds: string[], userId?: string) {
    await this.getRouteBare(organizationId, routeId);
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < customerIds.length; i++) {
        await tx
          .update(pharmacyRouteCustomers)
          .set({ sequenceNo: i + 1 })
          .where(
            and(
              eq(pharmacyRouteCustomers.organizationId, organizationId),
              eq(pharmacyRouteCustomers.routeId, routeId),
              eq(pharmacyRouteCustomers.tradeCustomerId, customerIds[i]!),
            ),
          );
      }
    });
    await writeAudit(this.db, organizationId, {
      entityType: "route",
      entityId: routeId,
      action: "reorder",
      newValue: { customerIds },
      userId,
    });
    return this.listStops(organizationId, routeId);
  }

  private async getRouteBare(organizationId: string, routeId: string) {
    const [route] = await this.db
      .select()
      .from(pharmacyRoutes)
      .where(and(eq(pharmacyRoutes.organizationId, organizationId), eq(pharmacyRoutes.id, routeId)))
      .limit(1);
    if (!route) throw new NotFoundException("Route not found");
    return route;
  }
}
