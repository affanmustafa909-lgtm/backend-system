import { Inject, Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { moduleVersions, modules, type PlatformPgDb } from "@platform/database-pg";
import { DRIZZLE } from "../drizzle/drizzle.tokens";

@Injectable()
export class CatalogService {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  async listModules(): Promise<
    {
      slug: string;
      displayName: string;
      description: string | null;
      latestVersion: string;
      publisher: string | null;
    }[]
  > {
    const rows = await this.db
      .select({
        slug: modules.slug,
        displayName: modules.displayName,
        description: modules.description,
        publisher: modules.publisher,
        semver: moduleVersions.semver,
        releasedAt: moduleVersions.releasedAt,
      })
      .from(modules)
      .innerJoin(moduleVersions, eq(moduleVersions.moduleId, modules.id))
      .orderBy(desc(moduleVersions.releasedAt));

    const best = new Map<
      string,
      {
        slug: string;
        displayName: string;
        description: string | null;
        latestVersion: string;
        publisher: string | null;
      }
    >();

    for (const r of rows) {
      if (best.has(r.slug)) continue;
      best.set(r.slug, {
        slug: r.slug,
        displayName: r.displayName,
        description: r.description,
        latestVersion: r.semver,
        publisher: r.publisher,
      });
    }

    return [...best.values()];
  }
}
