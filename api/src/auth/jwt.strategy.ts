import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { AccessJwtPayload } from "./jwt.types";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        config.get<string>("JWT_ACCESS_SECRET")?.trim() ||
        "railway-boot-placeholder-min-32-chars!!",
    });
  }

  validate(payload: AccessJwtPayload): AccessJwtPayload {
    return payload;
  }
}
