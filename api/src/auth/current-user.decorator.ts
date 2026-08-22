import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AccessJwtPayload } from "./jwt.types";

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AccessJwtPayload => {
  const req = ctx.switchToHttp().getRequest<{ user?: AccessJwtPayload }>();
  const user = req.user;
  if (!user) {
    throw new Error("Missing authenticated user");
  }
  return user;
});
