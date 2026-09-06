import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { isRestaurantFamilySystemType, type SystemType } from "@platform/contracts";
import { isSuperAdmin, type AccessJwtPayload } from "../auth/jwt.types";
import { REQUIRED_SYSTEM_TYPE_KEY } from "./require-system-type.decorator";

/**
 * Enforces strict system isolation server-side.
 * Restaurant admins cannot call Pharmacy/Store APIs (and vice versa).
 */
@Injectable()
export class SystemTypeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<SystemType[]>(REQUIRED_SYSTEM_TYPE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: AccessJwtPayload }>();
    const user = request.user;
    if (!user) throw new ForbiddenException("Not authenticated");

    // Super Admin manages tenants via /v1/platform — never via tenant module APIs.
    if (isSuperAdmin(user)) {
      throw new ForbiddenException(
        "Access denied. Super Admin must use the platform control plane, not tenant system APIs.",
      );
    }

    if (!user.systemType) {
      throw new ForbiddenException("Access denied. No system assignment on this account.");
    }

    if (!systemTypeAllowed(user.systemType, required)) {
      throw new ForbiddenException(
        `Access denied. This account is restricted to the ${user.systemType} system.`,
      );
    }

    return true;
  }
}

function systemTypeAllowed(userType: SystemType, required: SystemType[]): boolean {
  if (required.includes(userType)) return true;
  return (
    isRestaurantFamilySystemType(userType) && required.some((type) => isRestaurantFamilySystemType(type))
  );
}
