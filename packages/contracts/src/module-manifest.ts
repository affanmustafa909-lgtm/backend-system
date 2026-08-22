import { z } from "zod";

export const federationExposeSchema = z.object({
  name: z.string().min(1),
  entry: z.string().min(1),
});

export const moduleRouteSchema = z.object({
  path: z.string().min(1),
  remoteExpose: z.string().min(1),
});

export const moduleManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  version: z.string().min(1),
  displayName: z.string().min(1),
  federation: z.object({
    remoteName: z.string().min(1),
    remoteEntryUrl: z.string().url().or(z.string().startsWith("file:")),
    exposedModule: z.string().min(1),
  }),
  routes: z.array(moduleRouteSchema).min(1),
  requiredPermissions: z.array(z.string()).default([]),
  integrity: z
    .object({
      algo: z.enum(["sha256"]),
      remoteEntry: z.string().min(16),
    })
    .optional(),
});

export type ModuleManifest = z.infer<typeof moduleManifestSchema>;
