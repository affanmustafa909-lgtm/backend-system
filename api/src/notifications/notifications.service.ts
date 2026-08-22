import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import type {
  DispatchNotificationInput,
  SendTestNotification,
  UpdateNotificationSettings,
  UpdateNotificationTemplate,
} from "@platform/contracts";
import { CHANNEL_LABELS } from "@platform/contracts";
import {
  popsBranches,
  popsNotificationLog,
  popsNotificationSettings,
  popsNotificationTemplates,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../drizzle/drizzle.tokens";

const DEFAULT_TEMPLATES = [
  {
    templateKey: "rider_assigned",
    name: "Rider assigned",
    channel: "sms",
    body: "Your order {{orderRef}} is on the way. Rider: {{riderName}}.",
    description: "Sent when a delivery rider is assigned",
  },
  {
    templateKey: "birthday_offer",
    name: "Birthday offer",
    channel: "whatsapp",
    body: "Happy birthday {{customerName}}! Enjoy 20% off at POPS today.",
    description: "CRM birthday promotion",
  },
  {
    templateKey: "printer_offline",
    name: "Printer offline",
    channel: "app",
    body: "Printer offline — {{stationLabel}}",
    description: "Kitchen printer alert",
  },
  {
    templateKey: "invoice_delivery",
    name: "Invoice delivery",
    channel: "sms",
    body: "Invoice {{invoiceRef}} for Rs {{amount}} is ready. Thank you for your business.",
    description: "Send invoice link to customer",
  },
  {
    templateKey: "nps_feedback",
    name: "Feedback NPS",
    channel: "app",
    body: "How was your visit? Rate us 1–10: {{surveyLink}}",
    description: "Post-visit feedback request",
  },
] as const;

@Injectable()
export class NotificationsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.seedIfEmpty();
    } catch (err) {
      this.logger.warn(
        `Notification seed skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async getOverview(organizationId: string) {
    await this.ensureOrgSeeded(organizationId);

    const settings = await this.getSettings(organizationId);
    const templates = await this.listTemplates(organizationId);
    const recentLog = await this.listLog(organizationId, 50);

    const today = new Date().toISOString().slice(0, 10);
    const todayRows = await this.db
      .select({ status: popsNotificationLog.status })
      .from(popsNotificationLog)
      .where(
        and(
          eq(popsNotificationLog.organizationId, organizationId),
          sql`date(${popsNotificationLog.createdAt}) = ${today}`,
        ),
      );

    return {
      settings,
      templates,
      recentLog,
      stats: {
        sentToday: todayRows.filter((r) => r.status === "sent").length,
        failedToday: todayRows.filter((r) => r.status === "failed").length,
        skippedToday: todayRows.filter((r) => r.status === "skipped").length,
      },
    };
  }

  async getSettings(organizationId: string) {
    await this.ensureOrgSeeded(organizationId);
    const rows = await this.db
      .select()
      .from(popsNotificationSettings)
      .where(eq(popsNotificationSettings.organizationId, organizationId))
      .limit(1);

    const row = rows[0]!;
    return {
      smsEnabled: row.smsEnabled,
      whatsappEnabled: row.whatsappEnabled,
      printerAlertsEnabled: row.printerAlertsEnabled,
    };
  }

  async updateSettings(organizationId: string, input: UpdateNotificationSettings) {
    await this.ensureOrgSeeded(organizationId);
    const rows = await this.db
      .select()
      .from(popsNotificationSettings)
      .where(eq(popsNotificationSettings.organizationId, organizationId))
      .limit(1);

    const existing = rows[0];
    if (!existing) throw new NotFoundException("Notification settings not found");

    await this.db
      .update(popsNotificationSettings)
      .set({
        smsEnabled: input.smsEnabled ?? existing.smsEnabled,
        whatsappEnabled: input.whatsappEnabled ?? existing.whatsappEnabled,
        printerAlertsEnabled: input.printerAlertsEnabled ?? existing.printerAlertsEnabled,
        updatedAt: new Date(),
      })
      .where(eq(popsNotificationSettings.id, existing.id));

    return this.getSettings(organizationId);
  }

  async listTemplates(organizationId: string) {
    await this.ensureOrgSeeded(organizationId);
    const rows = await this.db
      .select()
      .from(popsNotificationTemplates)
      .where(eq(popsNotificationTemplates.organizationId, organizationId))
      .orderBy(popsNotificationTemplates.name);

    return rows.map((r) => this.mapTemplate(r));
  }

  async updateTemplate(
    organizationId: string,
    templateId: string,
    input: UpdateNotificationTemplate,
  ) {
    const rows = await this.db
      .select()
      .from(popsNotificationTemplates)
      .where(
        and(
          eq(popsNotificationTemplates.id, templateId),
          eq(popsNotificationTemplates.organizationId, organizationId),
        ),
      )
      .limit(1);

    const existing = rows[0];
    if (!existing) throw new NotFoundException("Template not found");

    const [row] = await this.db
      .update(popsNotificationTemplates)
      .set({
        name: input.name?.trim() ?? existing.name,
        body: input.body?.trim() ?? existing.body,
        description:
          input.description !== undefined ? input.description.trim() || null : existing.description,
        updatedAt: new Date(),
      })
      .where(eq(popsNotificationTemplates.id, templateId))
      .returning();

    if (!row) throw new BadRequestException("Failed to update template");
    return this.mapTemplate(row);
  }

  async listLog(organizationId: string, limit = 50) {
    const rows = await this.db
      .select()
      .from(popsNotificationLog)
      .where(eq(popsNotificationLog.organizationId, organizationId))
      .orderBy(desc(popsNotificationLog.createdAt))
      .limit(limit);

    return rows.map((r) => this.mapLogEntry(r));
  }

  async sendTest(organizationId: string, input: SendTestNotification) {
    const templates = await this.db
      .select()
      .from(popsNotificationTemplates)
      .where(
        and(
          eq(popsNotificationTemplates.organizationId, organizationId),
          eq(popsNotificationTemplates.templateKey, input.templateKey),
        ),
      )
      .limit(1);

    const template = templates[0];
    if (!template) throw new NotFoundException("Template not found");

    return this.dispatch({
      organizationId,
      channel: template.channel as DispatchNotificationInput["channel"],
      recipientLabel: input.recipientLabel.trim(),
      templateKey: template.templateKey,
      variables: { customerName: "Test User", orderRef: "DL-TEST", riderName: "Usman" },
      source: "manual",
      sourceRef: "test",
    });
  }

  async dispatch(input: DispatchNotificationInput) {
    await this.ensureOrgSeeded(input.organizationId);
    const settings = await this.getSettings(input.organizationId);

    const channelEnabled =
      input.channel === "sms"
        ? settings.smsEnabled
        : input.channel === "whatsapp"
          ? settings.whatsappEnabled
          : settings.printerAlertsEnabled;

    const templates = await this.db
      .select()
      .from(popsNotificationTemplates)
      .where(
        and(
          eq(popsNotificationTemplates.organizationId, input.organizationId),
          eq(popsNotificationTemplates.templateKey, input.templateKey),
        ),
      )
      .limit(1);

    const template = templates[0];
    const templateName = template?.name ?? input.templateKey;
    const body = template
      ? this.renderTemplate(template.body, input.variables ?? {})
      : input.templateKey;

    const status = channelEnabled ? "sent" : "skipped";
    if (channelEnabled) {
      this.logger.log(
        `[${input.channel.toUpperCase()}] → ${input.recipientLabel}: ${body.slice(0, 80)}`,
      );
    }

    const [row] = await this.db
      .insert(popsNotificationLog)
      .values({
        organizationId: input.organizationId,
        branchId: input.branchId ?? null,
        channel: input.channel,
        recipientLabel: input.recipientLabel,
        templateKey: input.templateKey,
        templateName,
        bodyPreview: body.slice(0, 500),
        status,
        source: input.source,
        sourceRef: input.sourceRef ?? null,
      })
      .returning();

    return row ? this.mapLogEntry(row) : null;
  }

  async notifyRiderAssigned(
    organizationId: string,
    branchId: string,
    input: { orderRef: string; riderName: string; customerLabel: string; ticketRef: string },
  ): Promise<void> {
    await this.dispatch({
      organizationId,
      branchId,
      channel: "sms",
      recipientLabel: input.customerLabel,
      templateKey: "rider_assigned",
      variables: {
        orderRef: input.orderRef,
        riderName: input.riderName,
      },
      source: "delivery",
      sourceRef: input.ticketRef,
    });
  }

  async notifyPrinterOffline(
    organizationId: string,
    branchId: string,
    stationLabel: string,
  ): Promise<void> {
    await this.dispatch({
      organizationId,
      branchId,
      channel: "app",
      recipientLabel: "Kitchen",
      templateKey: "printer_offline",
      variables: { stationLabel },
      source: "kitchen",
      sourceRef: stationLabel,
    });
  }

  private renderTemplate(body: string, variables: Record<string, string>): string {
    return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? `{{${key}}}`);
  }

  private mapTemplate(row: typeof popsNotificationTemplates.$inferSelect) {
    return {
      id: row.id,
      templateKey: row.templateKey,
      name: row.name,
      channel: row.channel as "sms" | "whatsapp" | "app",
      body: row.body,
      description: row.description,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapLogEntry(row: typeof popsNotificationLog.$inferSelect) {
    const channel = row.channel as "sms" | "whatsapp" | "app";
    const created = row.createdAt;
    return {
      id: row.id,
      timeLabel: created.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" }),
      channel,
      channelLabel: CHANNEL_LABELS[channel] ?? row.channel,
      recipientLabel: row.recipientLabel,
      templateName: row.templateName,
      bodyPreview: row.bodyPreview,
      status: row.status as "queued" | "sent" | "failed" | "skipped",
      source: row.source,
      createdAt: created.toISOString(),
    };
  }

  private async ensureOrgSeeded(organizationId: string): Promise<void> {
    const existing = await this.db
      .select({ id: popsNotificationSettings.id })
      .from(popsNotificationSettings)
      .where(eq(popsNotificationSettings.organizationId, organizationId))
      .limit(1);
    if (existing[0]) return;
    await this.seedOrg(organizationId);
  }

  private async seedIfEmpty(): Promise<void> {
    const orgRows = await this.db.select({ id: popsBranches.organizationId }).from(popsBranches).limit(1);
    const orgId = orgRows[0]?.id;
    if (!orgId) return;
    await this.ensureOrgSeeded(orgId);
  }

  private async seedOrg(organizationId: string): Promise<void> {
    await this.db.insert(popsNotificationSettings).values({
      organizationId,
      smsEnabled: true,
      whatsappEnabled: true,
      printerAlertsEnabled: false,
    });

    for (const t of DEFAULT_TEMPLATES) {
      await this.db.insert(popsNotificationTemplates).values({
        organizationId,
        templateKey: t.templateKey,
        name: t.name,
        channel: t.channel,
        body: t.body,
        description: t.description,
      });
    }

    const branchRows = await this.db
      .select()
      .from(popsBranches)
      .where(eq(popsBranches.organizationId, organizationId))
      .limit(1);
    const branchId = branchRows[0]?.id ?? null;

    const seedLog = [
      {
        channel: "sms",
        recipientLabel: "Customer DL-2201",
        templateKey: "rider_assigned",
        templateName: "Rider assigned",
        bodyPreview: "Your order DL-2201 is on the way. Rider: Usman.",
        source: "delivery",
        sourceRef: "DL-2201",
      },
      {
        channel: "whatsapp",
        recipientLabel: "C-5001",
        templateKey: "birthday_offer",
        templateName: "Birthday offer",
        bodyPreview: "Happy birthday Walk-in VIP! Enjoy 20% off at POPS today.",
        source: "crm",
        sourceRef: "C-5001",
      },
      {
        channel: "app",
        recipientLabel: "Kitchen",
        templateKey: "printer_offline",
        templateName: "Printer offline",
        bodyPreview: "Printer offline — counter 2",
        source: "kitchen",
        sourceRef: "counter-2",
      },
    ];

    for (const entry of seedLog) {
      await this.db.insert(popsNotificationLog).values({
        organizationId,
        branchId,
        channel: entry.channel,
        recipientLabel: entry.recipientLabel,
        templateKey: entry.templateKey,
        templateName: entry.templateName,
        bodyPreview: entry.bodyPreview,
        status: "sent",
        source: entry.source,
        sourceRef: entry.sourceRef,
        createdAt: new Date(Date.now() - Math.random() * 3_600_000),
      });
    }
  }
}
