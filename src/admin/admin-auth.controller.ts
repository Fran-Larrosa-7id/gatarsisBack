import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { AdminAuthService } from "./admin-auth.service";
import { AdminLoginDto, AdminRefreshDto } from "./admin-auth.dto";
import { AdminRequest } from "./admin-auth.guard";
import { AdminAuthPublic } from "./public.decorator";

@Controller("admin/auth")
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post("login")
  @HttpCode(200)
  @AdminAuthPublic()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  login(@Body() dto: AdminLoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Post("refresh")
  @HttpCode(200)
  @AdminAuthPublic()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  refresh(@Body() dto: AdminRefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Req() request: AdminRequest) {
    await this.auth.logout(request.admin!.sessionId, request.admin!.id);
  }

  @Get("me")
  me(@Req() request: AdminRequest) {
    const { id, email, role } = request.admin!;
    return { id, email, role };
  }
}
