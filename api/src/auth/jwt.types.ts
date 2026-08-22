import type { PlatformRole, SystemType } from "@platform/contracts";

/** Sentinel org id for Super Admin JWTs (no real tenant). */
export const PLATFORM_SENTINEL_ORG_ID = "00000000-0000-0000-0000-000000000000";

export type AccessJwtPayload = {
  sub: string;
  organizationId: string;
  permissions: string[];
  /** Membership role (`admin`, `cashier`, …) or `super_admin`. */
  role: string;
  branchScope: string;
  /** Platform control-plane role; only Super Admin has this set. */
  platformRole?: PlatformRole | null;
  /** Permanently assigned business system for tenant users. */
  systemType?: SystemType | null;
  /** null/undefined = all permission-gated paths; otherwise only listed paths. */
  navAllowlist?: string[] | null;
  riderId?: string;
};

export function isSuperAdmin(user: AccessJwtPayload): boolean {
  return user.platformRole === "super_admin" || user.role === "super_admin";
}

export function requireTenantOrganizationId(user: AccessJwtPayload): string {
  if (isSuperAdmin(user) || user.organizationId === PLATFORM_SENTINEL_ORG_ID) {
    throw new Error("Tenant organization context required");
  }
  return user.organizationId;
}
