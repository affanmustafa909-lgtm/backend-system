import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { isSuperAdmin, type AccessJwtPayload } from "../auth/jwt.types";
import { REQUIRED_PERMISSIONS_KEY } from "./require-permission.decorator";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: AccessJwtPayload }>();
    const user = request.user;
    if (!user) throw new ForbiddenException("Not authenticated");

    if (isSuperAdmin(user)) {
      const granted = new Set(user.permissions);
      if (granted.has("*")) return true;
      const ok = required.some((p) => granted.has(p));
      if (!ok) throw new ForbiddenException("Insufficient permissions");
      return true;
    }

    const granted = new Set(user.permissions);
    if (granted.has("*")) return true;

    const ok = required.some((p) => granted.has(p));
    if (!ok) throw new ForbiddenException("Insufficient permissions");
    return true;
  }
}
