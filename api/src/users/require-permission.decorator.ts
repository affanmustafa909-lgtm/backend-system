import { SetMetadata } from "@nestjs/common";

export const REQUIRED_PERMISSIONS_KEY = "required_permissions";

export function RequirePermissions(...permissions: string[]): MethodDecorator & ClassDecorator {
  return SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
}
