import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { StoreModule } from "../store/store.module";
import { SyncController } from "./sync.controller";
import { SyncService } from "./sync.service";

@Module({
  imports: [AuthModule, StoreModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
