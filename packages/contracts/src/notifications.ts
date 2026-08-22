import { z } from "zod";

export const NOTIFICATION_CHANNEL_VALUES = ["sms", "whatsapp", "app"] as const;

export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNEL_VALUES);

export const notificationSettingsSchema = z.object({
  smsEnabled: z.boolean(),
  whatsappEnabled: z.boolean(),
  printerAlertsEnabled: z.boolean(),
});

export const updateNotificationSettingsSchema = notificationSettingsSchema.partial();

export const notificationTemplateSchema = z.object({
  id: z.string().uuid(),
  templateKey: z.string(),
  name: z.string(),
  channel: notificationChannelSchema,
  body: z.string(),
  description: z.string().nullable(),
  updatedAt: z.string(),
});

export const updateNotificationTemplateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  body: z.string().min(1).max(2000).optional(),
  description: z.string().max(300).optional(),
});

export const notificationLogEntrySchema = z.object({
  id: z.string().uuid(),
  timeLabel: z.string(),
  channel: notificationChannelSchema,
  channelLabel: z.string(),
  recipientLabel: z.string(),
  templateName: z.string(),
  bodyPreview: z.string().nullable(),
  status: z.enum(["queued", "sent", "failed", "skipped"]),
  source: z.string(),
  createdAt: z.string(),
});

export const notificationsOverviewSchema = z.object({
  settings: notificationSettingsSchema,
  templates: z.array(notificationTemplateSchema),
  recentLog: z.array(notificationLogEntrySchema),
  stats: z.object({
    sentToday: z.number(),
    failedToday: z.number(),
    skippedToday: z.number(),
  }),
});

export const sendTestNotificationSchema = z.object({
  templateKey: z.string().min(1),
  recipientLabel: z.string().min(1).max(120),
});

export const CHANNEL_LABELS: Record<(typeof NOTIFICATION_CHANNEL_VALUES)[number], string> = {
  sms: "SMS",
  whatsapp: "WhatsApp",
  app: "App",
};

export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export type UpdateNotificationSettings = z.infer<typeof updateNotificationSettingsSchema>;
export type NotificationTemplate = z.infer<typeof notificationTemplateSchema>;
export type UpdateNotificationTemplate = z.infer<typeof updateNotificationTemplateSchema>;
export type NotificationLogEntry = z.infer<typeof notificationLogEntrySchema>;
export type NotificationsOverview = z.infer<typeof notificationsOverviewSchema>;
export type SendTestNotification = z.infer<typeof sendTestNotificationSchema>;

export type DispatchNotificationInput = {
  organizationId: string;
  branchId?: string | null;
  channel: (typeof NOTIFICATION_CHANNEL_VALUES)[number];
  recipientLabel: string;
  templateKey: string;
  variables?: Record<string, string>;
  source: string;
  sourceRef?: string;
};
