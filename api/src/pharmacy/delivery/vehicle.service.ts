import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { pharmacyVehicles, popsBranches, type PlatformPgDb } from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";

export type VehicleListFilters = {
  branchCode?: string;
  status?: string;
  q?: string;
  page?: number;
  pageSize?: number;
};

@Injectable()
export class VehicleService {
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

  async list(organizationId: string, filters: VehicleListFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    const offset = (page - 1) * pageSize;
    const branch = await this.resolveBranch(organizationId, filters.branchCode);

    const conds: SQL[] = [eq(pharmacyVehicles.organizationId, organizationId)];
    if (branch) conds.push(eq(pharmacyVehicles.branchId, branch.id));
    if (filters.status?.trim()) conds.push(eq(pharmacyVehicles.status, filters.status.trim()));
    if (filters.q?.trim()) {
      const q = `%${filters.q.trim()}%`;
      conds.push(
        or(
          ilike(pharmacyVehicles.code, q),
          ilike(pharmacyVehicles.registrationNo, q),
          ilike(pharmacyVehicles.vehicleType, q),
        )!,
      );
    }
    const where = and(...conds);

    const [totalRow] = await this.db.select({ n: count() }).from(pharmacyVehicles).where(where);
    const items = await this.db
      .select()
      .from(pharmacyVehicles)
      .where(where)
      .orderBy(desc(pharmacyVehicles.createdAt))
      .limit(pageSize)
      .offset(offset);

    return { items, page, pageSize, total: Number(totalRow?.n ?? 0) };
  }

  async getById(organizationId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(pharmacyVehicles)
      .where(and(eq(pharmacyVehicles.id, id), eq(pharmacyVehicles.organizationId, organizationId)))
      .limit(1);
    if (!row) throw new NotFoundException("Vehicle not found");
    return row;
  }

  async create(
    organizationId: string,
    input: {
      branchCode?: string;
      code: string;
      registrationNo: string;
      vehicleType?: string;
      status?: string;
      notes?: string;
    },
  ) {
    if (!input.code?.trim() || !input.registrationNo?.trim()) {
      throw new BadRequestException("code and registrationNo are required");
    }
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    try {
      const [row] = await this.db
        .insert(pharmacyVehicles)
        .values({
          organizationId,
          branchId: branch?.id ?? null,
          code: input.code.trim(),
          registrationNo: input.registrationNo.trim(),
          vehicleType: input.vehicleType?.trim() || null,
          status: input.status?.trim() || "available",
          notes: input.notes ?? null,
        })
        .returning();
      if (!row) throw new BadRequestException("Failed to create vehicle");
      return row;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("duplicate") || msg.includes("unique") || (err as { code?: string })?.code === "23505") {
        throw new ConflictException(`Vehicle code already exists: ${input.code}`);
      }
      throw err;
    }
  }

  async update(
    organizationId: string,
    id: string,
    input: Partial<{
      registrationNo: string;
      vehicleType: string;
      status: string;
      notes: string;
    }>,
  ) {
    await this.getById(organizationId, id);
    const [updated] = await this.db
      .update(pharmacyVehicles)
      .set({
        ...(input.registrationNo !== undefined ? { registrationNo: input.registrationNo.trim() } : {}),
        ...(input.vehicleType !== undefined ? { vehicleType: input.vehicleType?.trim() || null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      })
      .where(and(eq(pharmacyVehicles.id, id), eq(pharmacyVehicles.organizationId, organizationId)))
      .returning();
    return updated;
  }
}
