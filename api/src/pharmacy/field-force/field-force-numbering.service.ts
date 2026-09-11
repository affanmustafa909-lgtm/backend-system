import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { pharmacyPjps, pharmacyTargets, pharmacyVisits, type PlatformPgDb } from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";

export type FieldDocKind = "visit" | "pjp" | "target";

const PREFIX: Record<FieldDocKind, string> = {
  visit: "VIS",
  pjp: "PJP",
  target: "TGT",
};

type Tx = PlatformPgDb;

@Injectable()
export class FieldForceNumberingService {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  private tableMeta(kind: FieldDocKind) {
    switch (kind) {
      case "visit":
        return { table: pharmacyVisits, column: pharmacyVisits.visitNumber, org: pharmacyVisits.organizationId };
      case "pjp":
        return { table: pharmacyPjps, column: pharmacyPjps.pjpNumber, org: pharmacyPjps.organizationId };
      case "target":
        return { table: pharmacyTargets, column: pharmacyTargets.targetNumber, org: pharmacyTargets.organizationId };
    }
  }

  async next(organizationId: string, kind: FieldDocKind, attempt = 0, tx: Tx = this.db): Promise<string> {
    const prefix = `${PREFIX[kind]}-${new Date().getUTCFullYear()}`;
    const { table, column, org } = this.tableMeta(kind);
    const pattern = `${prefix}-%`;
    const [row] = await tx
      .select({
        maxSeq: sql<number>`coalesce(max(nullif(regexp_replace(${column}, '^.*-', ''), '')::bigint), 0)`,
      })
      .from(table)
      .where(and(eq(org, organizationId), sql`${column} like ${pattern}`));
    const seq = Number(row?.maxSeq ?? 0) + 1 + attempt;
    return `${prefix}-${String(seq).padStart(5, "0")}`;
  }

  async withNumber<T>(organizationId: string, kind: FieldDocKind, fn: (number: string) => Promise<T>): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt < 6; attempt++) {
      const number = await this.next(organizationId, kind, attempt);
      try {
        return await fn(number);
      } catch (err) {
        last = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (!/unique|duplicate/i.test(msg)) throw err;
      }
    }
    throw new ConflictException(`Could not allocate ${kind} number: ${last instanceof Error ? last.message : last}`);
  }
}
