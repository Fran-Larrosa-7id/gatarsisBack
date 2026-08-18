import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes } from "crypto";
import * as bcrypt from "bcryptjs";
import { DataSource, IsNull, MoreThan } from "typeorm";
import { AdminAuditLog } from "./entities/admin-audit-log.entity";
import { AdminSession } from "./entities/admin-session.entity";
import { AdminUser } from "./entities/admin-user.entity";

const hashToken = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const invalid = () =>
  new UnauthorizedException({
    code: "INVALID_CREDENTIALS",
    message: "Credenciales inválidas.",
  });

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
  ) {}
  private accessTokenMinutes() {
    return Number(process.env.ADMIN_ACCESS_TOKEN_MINUTES ?? 15);
  }
  private refreshTokenHours() {
    return Number(process.env.ADMIN_REFRESH_TOKEN_HOURS ?? 8);
  }

  private async issue(user: AdminUser, previousSession?: AdminSession) {
    const refreshToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      Date.now() + this.refreshTokenHours() * 3_600_000,
    );
    const sessions = this.dataSource.getRepository(AdminSession);
    const session = previousSession
      ? await sessions.save({
          ...previousSession,
          refreshTokenHash: hashToken(refreshToken),
          expiresAt,
          revokedAt: null,
          lastUsedAt: new Date(),
        })
      : await sessions.save({
          adminUserId: user.id,
          refreshTokenHash: hashToken(refreshToken),
          expiresAt,
          revokedAt: null,
          lastUsedAt: null,
        });
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      role: user.role,
      sid: session.id,
    });
    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt: new Date(
        Date.now() + this.accessTokenMinutes() * 60_000,
      ),
      admin: { id: user.id, email: user.email, role: user.role },
    };
  }

  async login(email: string, password: string) {
    const users = this.dataSource.getRepository(AdminUser);
    const user = await users.findOneBy({ email: email.trim().toLowerCase() });
    if (
      !user ||
      !user.active ||
      !(await bcrypt.compare(password, user.passwordHash))
    )
      throw invalid();
    user.lastLoginAt = new Date();
    await users.save(user);
    await this.dataSource
      .getRepository(AdminAuditLog)
      .save({
        adminUserId: user.id,
        action: "ADMIN_LOGIN",
        entityType: null,
        entityId: null,
        metadata: null,
      });
    return this.issue(user);
  }

  async refresh(refreshToken: string) {
    const sessions = this.dataSource.getRepository(AdminSession);
    const session = await sessions.findOneBy({
      refreshTokenHash: hashToken(refreshToken),
      revokedAt: IsNull(),
      expiresAt: MoreThan(new Date()),
    });
    if (!session) throw invalid();
    const user = await this.dataSource
      .getRepository(AdminUser)
      .findOneBy({ id: session.adminUserId });
    if (!user?.active) throw invalid();
    return this.issue(user, session);
  }

  async logout(sessionId: string, userId: string) {
    await this.dataSource
      .getRepository(AdminSession)
      .update(
        { id: sessionId, adminUserId: userId, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
    await this.dataSource
      .getRepository(AdminAuditLog)
      .save({
        adminUserId: userId,
        action: "ADMIN_LOGOUT",
        entityType: null,
        entityId: null,
        metadata: null,
      });
  }
}
