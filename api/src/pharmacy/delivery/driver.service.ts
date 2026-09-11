import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import {
  pharmacyDrivers,
  pharmacyVehicles,
  popsBranches,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";

export type DriverListFilters = {
  branchCode?: string;
  status?: string;
  q?: string;
  page?: number;
  pageSize?: number;
};

@Injectable()
export class DriverService {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  private async resolveBranch(organizationId: string, branchCode?: string) {
    if (!branchCode?.trim()) return null;
    const [branch] = await this.db
      .select()
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, branchCode.trim())))
      .limit(1);
    if (!branch) throw new NotFoundException(`Branch not found: ${branchCode}`);
    return branch;
  }

  async list(organizationId: string, filters: DriverListFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    const offset = (page - 1) * pageSize;
    const branch = await this.resolveBranch(organizationId, filters.branchCode);

    const conds: SQL[] = [eq(pharmacyDrivers.organizationId, organizationId)];
    if (branch) conds.push(eq(pharmacyDrivers.branchId, branch.id));
    if (filters.status?.trim()) conds.push(eq(pharmacyDrivers.status, filters.status.trim()));
    if (filters.q?.trim()) {
      const q = `%${filters.q.trim()}%`;
      conds.push(or(ilike(pharmacyDrivers.name, q), ilike(pharmacyDrivers.code, q), ilike(pharmacyDrivers.phone, q))!);
    }
    const where = and(...conds);

    const [totalRow] = await this.db.select({ n: count() }).from(pharmacyDrivers).where(where);
    const items = await this.db
      .select()
      .from(pharmacyDrivers)
      .where(where)
      .orderBy(desc(pharmacyDrivers.createdAt))
      .limit(pageSize)
      .offset(offset);

    return { items, page, pageSize, total: Number(totalRow?.n ?? 0) };
  }

  async getById(organizationId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(pharmacyDrivers)
      .where(and(eq(pharmacyDrivers.id, id), eq(pharmacyDrivers.organizationId, organizationId)))
      .limit(1);
    if (!row) throw new NotFoundException("Driver not found");
    return row;
  }

  async create(
    organizationId: string,
    input: {
      branchCode?: string;
      code: string;
      name: string;
      phone?: string;
      status?: string;
      vehicleId?: string;
      notes?: string;
    },
  ) {
    if (!input.code?.trim() || !input.name?.trim()) {
      throw new BadRequestException("code and name are required");
    }
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    if (input.vehicleId) {
      const [v] = await this.db
        .select({ id: pharmacyVehicles.id })
        .from(pharmacyVehicles)
        .where(
          and(eq(pharmacyVehicles.id, input.vehicleId), eq(pharmacyVehicles.organizationId, organizationId)),
        )
        .limit(1);
      if (!v) throw new BadRequestException("vehicleId not found in organization");
    }
    try {
      const [row] = await this.db
        .insert(pharmacyDrivers)
        .values({
          organizationId,
          branchId: branch?.id ?? null,
          code: input.code.trim(),
          name: input.name.trim(),
          phone: input.phone?.trim() || null,
          status: input.status?.trim() || "active",
          vehicleId: input.vehicleId ?? null,
          notes: input.notes ?? null,
        })
        .returning();
      if (!row) throw new BadRequestException("Failed to create driver");
      return row;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("duplicate") || msg.includes("unique") || (err as { code?: string })?.code === "23505") {
        throw new ConflictException(`Driver code already exists: ${input.code}`);
      }
      throw err;
    }
  }

  async update(
    organizationId: string,
    id: string,
    input: Partial<{
      name: string;
      phone: string;
      status: string;
      vehicleId: string | null;
      notes: string;
    }>,
  ) {
    await this.getById(organizationId, id);
    const [updated] = await this.db
      .update(pharmacyDrivers)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.vehicleId !== undefined ? { vehicleId: input.vehicleId } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      })
      .where(and(eq(pharmacyDrivers.id, id), eq(pharmacyDrivers.organizationId, organizationId)))
      .returning();
    return updated;
  }
}
