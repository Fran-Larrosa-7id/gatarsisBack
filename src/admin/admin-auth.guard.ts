import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { DataSource, IsNull, MoreThan } from "typeorm";
import { AdminSession } from "./entities/admin-session.entity";
import { AdminUser, AdminRole } from "./entities/admin-user.entity";
import { IS_ADMIN_AUTH_PUBLIC } from "./public.decorator";

export type AdminRequest = Request & {
  admin?: { id: string; email: string; role: AdminRole; sessionId: string };
};

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly dataSource: DataSource,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    if (!request.originalUrl.includes("/api/v1/admin/")) return true;
    if (
      this.reflector.getAllAndOverride<boolean>(IS_ADMIN_AUTH_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const token = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; sid: string }>(
        token,
      );
      if (!payload.sub || !payload.sid) throw new UnauthorizedException();
      const [user, session] = await Promise.all([
        this.dataSource.getRepository(AdminUser).findOneBy({ id: payload.sub }),
        this.dataSource
          .getRepository(AdminSession)
          .findOneBy({
            id: payload.sid,
            adminUserId: payload.sub,
            revokedAt: IsNull(),
            expiresAt: MoreThan(new Date()),
          }),
      ]);
      if (!user?.active || user.role !== AdminRole.ADMIN || !session)
        throw new UnauthorizedException();
      request.admin = {
        id: user.id,
        email: user.email,
        role: user.role,
        sessionId: session.id,
      };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
