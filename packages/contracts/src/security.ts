import { z } from "zod";

export const securityAuditEntrySchema = z.object({
  id: z.string(),
  time: z.string(),
  user: z.string(),
  action: z.string(),
  detail: z.string(),
  module: z.string(),
  severity: z.enum(["info", "warning", "danger"]),
});

export const securityDeviceSchema = z.object({
  id: z.string().uuid(),
  userEmail: z.string(),
  role: z.string(),
  sessionStarted: z.string(),
  expiresAt: z.string(),
  lastActivityAt: z.string().nullable(),
  status: z.enum(["active", "expired"]),
});

export const securityOverviewSchema = z.object({
  branchCode: z.string().nullable(),
  metrics: z.object({
    failedLogins24h: z.number(),
    activeDevices: z.number(),
    policyViolations: z.number(),
  }),
  auditTrail: z.array(securityAuditEntrySchema),
  devices: z.array(securityDeviceSchema),
});

export type SecurityAuditEntry = z.infer<typeof securityAuditEntrySchema>;
export type SecurityDevice = z.infer<typeof securityDeviceSchema>;
export type SecurityOverview = z.infer<typeof securityOverviewSchema>;
