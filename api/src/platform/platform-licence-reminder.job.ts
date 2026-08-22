import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PlatformService } from "./platform.service";

/**
 * Lightweight licence payment reminder automation (no @nestjs/schedule dependency).
 * Runs shortly after boot, then every 12 hours.
 * Sends when: Karachi day >= 25 or day <= 3, or any unpaid licence due within 5 days.
 */
@Injectable()
export class PlatformLicenceReminderJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformLicenceReminderJob.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(private readonly platform: PlatformService) {}

  onModuleInit(): void {
    const enabled = (process.env.LICENCE_REMINDER_AUTOMATION ?? "1").trim() !== "0";
    if (!enabled) {
      this.logger.log("Licence reminder automation disabled (LICENCE_REMINDER_AUTOMATION=0)");
      return;
    }

    this.bootTimer = setTimeout(() => {
      void this.safeTick("boot");
    }, 90_000);

    this.timer = setInterval(() => {
      void this.safeTick("interval");
    }, 12 * 60 * 60 * 1000);
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.timer) clearInterval(this.timer);
  }

  private async safeTick(reason: string): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.platform.runAutomatedLicenceReminders();
      if (result) {
        this.logger.log(
          `Licence reminders (${reason}): sent=${result.sent} skipped=${result.skipped} failed=${result.failed}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Licence reminder tick failed (${reason}): ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
