import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index";

export type PlatformPgDb = NodePgDatabase<typeof schema>;

function poolSsl(connectionString: string): pg.PoolConfig["ssl"] {
  if (process.env.DATABASE_SSL === "false") return false;
  if (process.env.DATABASE_SSL === "true") return { rejectUnauthorized: false };
  if (/sslmode=require|sslmode=verify-full|ssl=true/i.test(connectionString)) {
    return { rejectUnauthorized: false };
  }
  // Hosted Postgres (Railway, Neon, etc.) — not localhost
  if (
    process.env.NODE_ENV === "production" &&
    !/localhost|127\.0\.0\.1/.test(connectionString)
  ) {
    return { rejectUnauthorized: false };
  }
  return false;
}

export function createPgDb(connectionString: string): { db: PlatformPgDb; pool: pg.Pool } {
  const pool = new pg.Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 30),
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 10_000),
    idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? 30_000),
    ssl: poolSsl(connectionString),
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export * from "./schema/index";
