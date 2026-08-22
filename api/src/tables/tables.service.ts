import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import type {
  CreateRestaurantTable,
  CreateSeatingSection,
  UpdateRestaurantTable,
  UpdateSeatingSection,
} from "@platform/contracts";
import {
  popsBranches,
  popsSeatingSections,
  popsTables,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../drizzle/drizzle.tokens";
import { dineInTableLabel, loadBranchTableBookings, normalizeTableLabel } from "./table-booking";

const DEFAULT_FLOOR: { section: string; tables: { number: string; seats: number }[] }[] = [
  {
    section: "Main dining",
    tables: [
      { number: "T1", seats: 4 },
      { number: "T2", seats: 2 },
      { number: "T3", seats: 6 },
      { number: "T4", seats: 4 },
    ],
  },
  {
    section: "Rooftop",
    tables: [
      { number: "R1", seats: 4 },
      { number: "R2", seats: 6 },
      { number: "R3", seats: 4 },
    ],
  },
  {
    section: "Outside",
    tables: [
      { number: "O1", seats: 4 },
      { number: "O2", seats: 2 },
    ],
  },
];

@Injectable()
export class TablesService implements OnModuleInit {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.seedDefaultFloor();
    } catch {
      /* schema may not be ready yet */
    }
  }

  async getBranchFloor(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    await this.seedBranchFloorIfEmpty(branch);

    const sections = await this.db
      .select()
      .from(popsSeatingSections)
      .where(
        and(
          eq(popsSeatingSections.branchId, branch.id),
          eq(popsSeatingSections.isActive, true),
        ),
      )
      .orderBy(asc(popsSeatingSections.sortOrder), asc(popsSeatingSections.name));

    const tables = await this.db
      .select()
      .from(popsTables)
      .where(
        and(eq(popsTables.branchId, branch.id), eq(popsTables.isActive, true)),
      )
      .orderBy(asc(popsTables.sortOrder), asc(popsTables.tableNumber));

    const bookings = await loadBranchTableBookings(this.db, branch.id);

    return {
      branchCode: branch.code,
      sections: sections.map((s) => this.mapSection(s)),
      tables: tables.map((t) => this.mapTable(t, bookings)),
    };
  }

  async getBranchFloorAdmin(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    await this.seedBranchFloorIfEmpty(branch);

    const sections = await this.db
      .select()
      .from(popsSeatingSections)
      .where(eq(popsSeatingSections.branchId, branch.id))
      .orderBy(asc(popsSeatingSections.sortOrder), asc(popsSeatingSections.name));

    const tables = await this.db
      .select()
      .from(popsTables)
      .where(eq(popsTables.branchId, branch.id))
      .orderBy(asc(popsTables.sortOrder), asc(popsTables.tableNumber));

    const bookings = await loadBranchTableBookings(this.db, branch.id);

    return {
      branchCode: branch.code,
      sections: sections.map((s) => this.mapSection(s)),
      tables: tables.map((t) => this.mapTable(t, bookings)),
    };
  }

  async createSection(organizationId: string, input: CreateSeatingSection) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(popsSeatingSections)
      .values({
        organizationId,
        branchId: branch.id,
        name: input.name.trim(),
        sortOrder: input.sortOrder ?? 0,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create seating section");
    return this.mapSection(row);
  }

  async updateSection(organizationId: string, sectionId: string, input: UpdateSeatingSection) {
    await this.getSection(organizationId, sectionId);
    const [row] = await this.db
      .update(popsSeatingSections)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      })
      .where(eq(popsSeatingSections.id, sectionId))
      .returning();
    if (!row) throw new NotFoundException("Seating section not found");
    return this.mapSection(row);
  }

  async deleteSection(organizationId: string, sectionId: string) {
    const section = await this.getSection(organizationId, sectionId);
    const tableCount = await this.db
      .select({ id: popsTables.id })
      .from(popsTables)
      .where(eq(popsTables.sectionId, section.id));
    if (tableCount.length > 0) {
      throw new BadRequestException("Remove or reassign tables in this section first.");
    }
    await this.db.delete(popsSeatingSections).where(eq(popsSeatingSections.id, sectionId));
    return { ok: true };
  }

  async createTable(organizationId: string, input: CreateRestaurantTable) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    await this.getSection(organizationId, input.sectionId);

    const [row] = await this.db
      .insert(popsTables)
      .values({
        organizationId,
        branchId: branch.id,
        sectionId: input.sectionId,
        tableNumber: input.tableNumber.trim().toUpperCase(),
        seats: input.seats ?? 4,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create table");
    return this.mapTable(row);
  }

  async updateTable(organizationId: string, tableId: string, input: UpdateRestaurantTable) {
    await this.getTable(organizationId, tableId);
    if (input.sectionId) await this.getSection(organizationId, input.sectionId);

    const [row] = await this.db
      .update(popsTables)
      .set({
        ...(input.tableNumber !== undefined
          ? { tableNumber: input.tableNumber.trim().toUpperCase() }
          : {}),
        ...(input.seats !== undefined ? { seats: input.seats } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.sectionId !== undefined ? { sectionId: input.sectionId } : {}),
      })
      .where(eq(popsTables.id, tableId))
      .returning();
    if (!row) throw new NotFoundException("Table not found");
    return this.mapTable(row);
  }

  async deleteTable(organizationId: string, tableId: string) {
    await this.getTable(organizationId, tableId);
    await this.db.delete(popsTables).where(eq(popsTables.id, tableId));
    return { ok: true };
  }

  private async seedDefaultFloor(): Promise<void> {
    const branches = await this.db.select().from(popsBranches);
    for (const branch of branches) {
      await this.seedBranchFloorIfEmpty(branch);
    }
  }

  private async seedBranchFloorIfEmpty(branch: typeof popsBranches.$inferSelect): Promise<void> {
    const existing = await this.db
      .select({ id: popsSeatingSections.id })
      .from(popsSeatingSections)
      .where(eq(popsSeatingSections.branchId, branch.id))
      .limit(1);
    if (existing.length > 0) return;

    for (let si = 0; si < DEFAULT_FLOOR.length; si++) {
      const def = DEFAULT_FLOOR[si];
      const [section] = await this.db
        .insert(popsSeatingSections)
        .values({
          organizationId: branch.organizationId,
          branchId: branch.id,
          name: def.section,
          sortOrder: si,
        })
        .returning();
      if (!section) continue;

      for (let ti = 0; ti < def.tables.length; ti++) {
        const t = def.tables[ti];
        await this.db.insert(popsTables).values({
          organizationId: branch.organizationId,
          branchId: branch.id,
          sectionId: section.id,
          tableNumber: t.number,
          seats: t.seats,
          sortOrder: ti,
        });
      }
    }
  }

  private mapSection(row: typeof popsSeatingSections.$inferSelect) {
    return {
      id: row.id,
      name: row.name,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
    };
  }

  private mapTable(
    row: typeof popsTables.$inferSelect,
    bookings?: Map<string, { orderRef: string | null }>,
  ) {
    const booking = bookings?.get(normalizeTableLabel(dineInTableLabel(row.tableNumber)));
    return {
      id: row.id,
      sectionId: row.sectionId,
      tableNumber: row.tableNumber,
      seats: row.seats,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      bookingStatus: booking ? ("booked" as const) : ("free" as const),
      bookedOrderRef: booking?.orderRef ?? null,
    };
  }

  private async resolveBranch(organizationId: string, branchCode: string) {
    const code = branchCode.trim();
    const rows = await this.db
      .select()
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, code)))
      .limit(1);
    const branch = rows[0];
    if (!branch) throw new NotFoundException(`Branch not found: ${code}`);
    return branch;
  }

  private async getSection(organizationId: string, sectionId: string) {
    const rows = await this.db
      .select()
      .from(popsSeatingSections)
      .where(eq(popsSeatingSections.id, sectionId))
      .limit(1);
    const row = rows[0];
    if (!row || row.organizationId !== organizationId) {
      throw new NotFoundException("Seating section not found");
    }
    return row;
  }

  private async getTable(organizationId: string, tableId: string) {
    const rows = await this.db
      .select()
      .from(popsTables)
      .where(eq(popsTables.id, tableId))
      .limit(1);
    const row = rows[0];
    if (!row || row.organizationId !== organizationId) {
      throw new NotFoundException("Table not found");
    }
    return row;
  }
}
