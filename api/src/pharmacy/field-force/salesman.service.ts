import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { UpsertFieldForceSalesman } from "@platform/contracts";
import {
  pharmacySalesForceProfiles,
  pharmacySalesmanRoutes,
  pharmacyTerritories,
  pharmacyTradeCustomers,
  popsEmployees,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { resolveBranch, writeAudit } from "./field-force.shared";

@Injectable()
export class FieldForceSalesmanService {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  async list(
    organizationId: string,
    filters: { q?: string; status?: string; territoryId?: string; branchCode?: string; page?: number; pageSize?: number } = {},
  ) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    const branch = await resolveBranch(this.db, organizationId, filters.branchCode);
    const conds: SQL[] = [eq(pharmacySalesForceProfiles.organizationId, organizationId)];
    if (filters.status) conds.push(eq(pharmacySalesForceProfiles.status, filters.status));
    if (filters.territoryId) conds.push(eq(pharmacySalesForceProfiles.territoryId, filters.territoryId));
    if (branch) conds.push(eq(pharmacySalesForceProfiles.branchId, branch.id));
    if (filters.q?.trim()) {
      const q = `%${filters.q.trim()}%`;
      conds.push(or(ilike(popsEmployees.displayName, q), ilike(popsEmployees.employeeCode, q))!);
    }

    const rows = await this.db
      .select({
        id: pharmacySalesForceProfiles.id,
        employeeId: pharmacySalesForceProfiles.employeeId,
        fieldRole: pharmacySalesForceProfiles.fieldRole,
        status: pharmacySalesForceProfiles.status,
        territoryId: pharmacySalesForceProfiles.territoryId,
        territoryName: pharmacyTerritories.name,
        cityId: pharmacySalesForceProfiles.cityId,
        areaId: pharmacySalesForceProfiles.areaId,
        branchId: pharmacySalesForceProfiles.branchId,
        managerEmployeeId: pharmacySalesForceProfiles.managerEmployeeId,
        primaryRouteId: pharmacySalesForceProfiles.primaryRouteId,
        dailyVisitTarget: pharmacySalesForceProfiles.dailyVisitTarget,
        monthlySalesTargetPkr: pharmacySalesForceProfiles.monthlySalesTargetPkr,
        monthlyCollectionTargetPkr: pharmacySalesForceProfiles.monthlyCollectionTargetPkr,
        visitFrequency: pharmacySalesForceProfiles.visitFrequency,
        workingDays: pharmacySalesForceProfiles.workingDays,
        notes: pharmacySalesForceProfiles.notes,
        employeeCode: popsEmployees.employeeCode,
        employeeName: popsEmployees.displayName,
        phone: popsEmployees.phone,
        email: popsEmployees.email,
        employmentStatus: popsEmployees.employmentStatus,
        joinDate: popsEmployees.joinDate,
        customerCount: sql<number>`(
          select count(*)::int from ${pharmacyTradeCustomers}
          where ${pharmacyTradeCustomers.organizationId} = ${organizationId}
            and ${pharmacyTradeCustomers.salesmanEmployeeId} = ${pharmacySalesForceProfiles.employeeId}
        )`,
      })
      .from(pharmacySalesForceProfiles)
      .innerJoin(popsEmployees, eq(popsEmployees.id, pharmacySalesForceProfiles.employeeId))
      .leftJoin(pharmacyTerritories, eq(pharmacyTerritories.id, pharmacySalesForceProfiles.territoryId))
      .where(and(...conds))
      .orderBy(popsEmployees.displayName);

    const total = rows.length;
    const items = rows.slice((page - 1) * pageSize, page * pageSize);
    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async getByEmployee(organizationId: string, employeeId: string) {
    const list = await this.list(organizationId, { page: 1, pageSize: 1 });
    const found = list.items.find((r) => r.employeeId === employeeId);
    if (found) {
      const extras = await this.db
        .select()
        .from(pharmacySalesmanRoutes)
        .where(
          and(
            eq(pharmacySalesmanRoutes.organizationId, organizationId),
            eq(pharmacySalesmanRoutes.employeeId, employeeId),
          ),
        );
      return { ...found, extraRouteIds: extras.map((e) => e.routeId) };
    }
    const [emp] = await this.db
      .select()
      .from(popsEmployees)
      .where(and(eq(popsEmployees.organizationId, organizationId), eq(popsEmployees.id, employeeId)))
      .limit(1);
    if (!emp) throw new NotFoundException("Salesman / employee not found");
    return {
      id: null,
      employeeId: emp.id,
      fieldRole: "Salesman",
      status: emp.employmentStatus === "active" ? "active" : emp.employmentStatus,
      employeeCode: emp.employeeCode,
      employeeName: emp.displayName,
      phone: emp.phone,
      email: emp.email,
      extraRouteIds: [] as string[],
    };
  }

  async upsert(organizationId: string, input: UpsertFieldForceSalesman, userId?: string) {
    const [emp] = await this.db
      .select()
      .from(popsEmployees)
      .where(and(eq(popsEmployees.organizationId, organizationId), eq(popsEmployees.id, input.employeeId)))
      .limit(1);
    if (!emp) throw new NotFoundException("Employee not found — salesman must be an existing employee");
    const branch = await resolveBranch(this.db, organizationId, input.branchCode);
    const [existing] = await this.db
      .select()
      .from(pharmacySalesForceProfiles)
      .where(
        and(
          eq(pharmacySalesForceProfiles.organizationId, organizationId),
          eq(pharmacySalesForceProfiles.employeeId, input.employeeId),
        ),
      )
      .limit(1);

    const values = {
      fieldRole: input.fieldRole ?? existing?.fieldRole ?? "Salesman",
      territoryId: input.territoryId === undefined ? existing?.territoryId ?? null : input.territoryId,
      cityId: input.cityId === undefined ? existing?.cityId ?? null : input.cityId,
      areaId: input.areaId === undefined ? existing?.areaId ?? null : input.areaId,
      geoTerritoryId: input.geoTerritoryId === undefined ? existing?.geoTerritoryId ?? null : input.geoTerritoryId,
      primaryRouteId: input.primaryRouteId === undefined ? existing?.primaryRouteId ?? null : input.primaryRouteId,
      managerEmployeeId:
        input.managerEmployeeId === undefined ? existing?.managerEmployeeId ?? null : input.managerEmployeeId,
      branchId: branch?.id ?? existing?.branchId ?? emp.branchId ?? null,
      dailyVisitTarget: input.dailyVisitTarget ?? existing?.dailyVisitTarget ?? 0,
      monthlySalesTargetPkr: input.monthlySalesTargetPkr ?? existing?.monthlySalesTargetPkr ?? 0,
      monthlyCollectionTargetPkr: input.monthlyCollectionTargetPkr ?? existing?.monthlyCollectionTargetPkr ?? 0,
      visitFrequency: input.visitFrequency ?? existing?.visitFrequency ?? null,
      workingDays: input.workingDays ?? existing?.workingDays ?? null,
      notes: input.notes ?? existing?.notes ?? null,
      status: input.status ?? existing?.status ?? "active",
    };

    let row = existing;
    if (existing) {
      const [updated] = await this.db
        .update(pharmacySalesForceProfiles)
        .set(values)
        .where(eq(pharmacySalesForceProfiles.id, existing.id))
        .returning();
      row = updated ?? existing;
      await writeAudit(this.db, organizationId, {
        entityType: "salesman",
        entityId: existing.id,
        action: input.status && input.status !== existing.status ? "status" : "update",
        oldValue: existing,
        newValue: row,
        userId,
      });
    } else {
      const [created] = await this.db
        .insert(pharmacySalesForceProfiles)
        .values({ organizationId, employeeId: input.employeeId, ...values })
        .returning();
      if (!created) throw new BadRequestException("Failed to create salesman profile");
      row = created;
      await writeAudit(this.db, organizationId, {
        entityType: "salesman",
        entityId: created.id,
        action: "create",
        newValue: created,
        userId,
      });
    }

    if (input.extraRouteIds) {
      await this.db
        .delete(pharmacySalesmanRoutes)
        .where(
          and(
            eq(pharmacySalesmanRoutes.organizationId, organizationId),
            eq(pharmacySalesmanRoutes.employeeId, input.employeeId),
          ),
        );
      if (input.extraRouteIds.length) {
        await this.db.insert(pharmacySalesmanRoutes).values(
          input.extraRouteIds.map((routeId) => ({
            organizationId,
            employeeId: input.employeeId,
            routeId,
          })),
        );
      }
    }

    return this.getByEmployee(organizationId, input.employeeId);
  }

  async assignCustomer(
    organizationId: string,
    input: {
      tradeCustomerId: string;
      salesmanEmployeeId?: string | null;
      territoryId?: string | null;
      routeId?: string | null;
      reason?: string;
    },
    userId?: string,
  ) {
    const [cust] = await this.db
      .select()
      .from(pharmacyTradeCustomers)
      .where(
        and(
          eq(pharmacyTradeCustomers.organizationId, organizationId),
          eq(pharmacyTradeCustomers.id, input.tradeCustomerId),
        ),
      )
      .limit(1);
    if (!cust) throw new NotFoundException("Customer not found");
    if (cust.status !== "active" && input.salesmanEmployeeId) {
      throw new BadRequestException("Cannot assign an inactive customer");
    }
    const [updated] = await this.db
      .update(pharmacyTradeCustomers)
      .set({
        salesmanEmployeeId:
          input.salesmanEmployeeId === undefined ? cust.salesmanEmployeeId : input.salesmanEmployeeId,
        territoryId: input.territoryId === undefined ? cust.territoryId : input.territoryId,
        routeId: input.routeId === undefined ? cust.routeId : input.routeId,
      })
      .where(eq(pharmacyTradeCustomers.id, cust.id))
      .returning();
    await writeAudit(this.db, organizationId, {
      entityType: "customer_assignment",
      entityId: cust.id,
      action: "assign",
      oldValue: {
        salesmanEmployeeId: cust.salesmanEmployeeId,
        territoryId: cust.territoryId,
        routeId: cust.routeId,
      },
      newValue: {
        salesmanEmployeeId: updated?.salesmanEmployeeId,
        territoryId: updated?.territoryId,
        routeId: updated?.routeId,
      },
      reason: input.reason,
      userId,
    });
    return updated;
  }

  async customersForSalesman(
    organizationId: string,
    employeeId: string,
    page = 1,
    pageSize = 50,
  ) {
    const rows = await this.db
      .select()
      .from(pharmacyTradeCustomers)
      .where(
        and(
          eq(pharmacyTradeCustomers.organizationId, organizationId),
          eq(pharmacyTradeCustomers.salesmanEmployeeId, employeeId),
        ),
      )
      .orderBy(desc(pharmacyTradeCustomers.outstandingPkr));
    const size = Math.min(100, Math.max(1, pageSize));
    const p = Math.max(1, page);
    return {
      items: rows.slice((p - 1) * size, p * size),
      page: p,
      pageSize: size,
      total: rows.length,
      totalPages: Math.max(1, Math.ceil(rows.length / size)),
    };
  }
}
