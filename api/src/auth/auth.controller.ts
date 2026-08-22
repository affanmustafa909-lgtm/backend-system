import { BadRequestException, Body, Controller, Get, Post, Query } from "@nestjs/common";
import { acceptInviteSchema, loginRequestSchema, pinLoginRequestSchema, refreshRequestSchema } from "@platform/contracts";
import { AuthService } from "./auth.service";
import { UsersService } from "../users/users.service";

@Controller("v1/auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Post("login")
  async login(@Body() body: unknown) {
    const parsed = loginRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid email or password format");
    }
    return this.auth.login(parsed.data.email, parsed.data.password);
  }

  @Post("pin-login")
  async pinLogin(@Body() body: unknown) {
    const parsed = pinLoginRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid branch code or PIN format");
    }
    return this.auth.pinLogin(parsed.data.branchCode, parsed.data.pin);
  }

  @Post("refresh")
  async refresh(@Body() body: unknown) {
    const parsed = refreshRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid refresh token");
    }
    return this.auth.refresh(parsed.data.refreshToken);
  }

  @Get("invite")
  previewInvite(@Query("token") token: string | undefined) {
    if (!token?.trim()) throw new BadRequestException("Missing invite token");
    return this.users.getInvitePreview(token.trim());
  }

  @Post("accept-invite")
  async acceptInvite(@Body() body: unknown) {
    const parsed = acceptInviteSchema.parse(body);
    const { email } = await this.users.acceptInvite(parsed);
    return this.auth.login(email, parsed.password);
  }
}
