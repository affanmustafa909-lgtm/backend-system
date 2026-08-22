import { SetMetadata } from "@nestjs/common";
import type { SystemType } from "@platform/contracts";

export const REQUIRED_SYSTEM_TYPE_KEY = "required_system_type";

/**
 * Restrict a controller/handler to tenants whose JWT `systemType` matches.
 * Super Admins are denied on tenant routes — they must use platform APIs.
 */
export function RequireSystemType(
  ...systemTypes: SystemType[]
): MethodDecorator & ClassDecorator {
  return SetMetadata(REQUIRED_SYSTEM_TYPE_KEY, systemTypes);
}
