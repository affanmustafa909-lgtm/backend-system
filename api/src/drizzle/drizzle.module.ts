import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createPgDb } from "@platform/database-pg";
import { DRIZZLE, DRIZZLE_POOL, PLATFORM_PG } from "./drizzle.tokens";

type PgBundle = ReturnType<typeof createPgDb>;

@Global()
@Module({
  providers: [
    {
      provide: PLATFORM_PG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PgBundle => {
        const url = config.getOrThrow<string>("DATABASE_URL");
        return createPgDb(url);
      },
    },
    {
      provide: DRIZZLE,
      inject: [PLATFORM_PG],
      useFactory: (bundle: PgBundle) => bundle.db,
    },
    {
      provide: DRIZZLE_POOL,
      inject: [PLATFORM_PG],
      useFactory: (bundle: PgBundle) => bundle.pool,
    },
  ],
  exports: [DRIZZLE, DRIZZLE_POOL],
})
export class DrizzleModule {}
