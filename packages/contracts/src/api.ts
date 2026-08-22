import { z } from "zod";

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const pinLoginRequestSchema = z.object({
  branchCode: z.string().min(1).max(64),
  pin: z.string().regex(/^\d{4}$/, "PIN must be 4 digits"),
});

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(10),
});

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
});

export const catalogModuleSchema = z.object({
  slug: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  latestVersion: z.string(),
  publisher: z.string().optional(),
});

export const syncPushBatchSchema = z.object({
  idempotencyKey: z.string().uuid(),
  organizationId: z.string().uuid(),
  mutations: z.array(
    z.object({
      entityType: z.string().min(1),
      operation: z.enum(["create", "update", "delete"]),
      clientMutationId: z.string().uuid(),
      payload: z.record(z.string(), z.unknown()),
    }),
  ),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type PinLoginRequest = z.infer<typeof pinLoginRequestSchema>;
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;
export type TokenPair = z.infer<typeof tokenPairSchema>;
export type CatalogModule = z.infer<typeof catalogModuleSchema>;
export type SyncPushBatch = z.infer<typeof syncPushBatchSchema>;
