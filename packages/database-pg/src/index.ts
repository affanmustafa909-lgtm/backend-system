import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index";

export type PlatformPgDb = NodePgDatabase<typeof schema>;

/** pg v8.22 treats sslmode=require as verify-full and rejects Railway's proxy chain. */
export function stripPgSslParams(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    url.searchParams.delete("ssl");
    url.searchParams.delete("uselibpqcompat");
    return url.toString();
  } catch {
    return connectionString
      .replace(/[?&](sslmode|ssl|uselibpqcompat)=[^&]*/gi, "")
      .replace(/\?&/, "?")
      .replace(/[?&]$/, "");
  }
}

function poolSsl(connectionString: string): pg.PoolConfig["ssl"] {
  if (process.env.DATABASE_SSL === "false") return false;
  if (/localhost|127\.0\.0\.1/.test(connectionString) && process.env.DATABASE_SSL !== "true") {
    return false;
  }
  return { rejectUnauthorized: false };
}

export function createPgDb(connectionString: string): { db: PlatformPgDb; pool: pg.Pool } {
  const pool = new pg.Pool({
    connectionString: stripPgSslParams(connectionString),
    max: Number(process.env.DATABASE_POOL_MAX ?? 30),
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 10_000),
    idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? 30_000),
    ssl: poolSsl(connectionString),
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export * from "./schema/index";
