import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request = require("supertest");
import { DataSource } from "typeorm";
import { AppModule } from "../src/app.module";
import { AdminUser, AdminRole } from "../src/admin/entities/admin-user.entity";

describe("admin auth (PostgreSQL)", () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let jwt: JwtService;
  let requestNumber = 1;
  const email = "admin@example.test";
  const password = "CorrectHorseBatteryStaple!";

  beforeAll(async () => {
    process.env.DATABASE_NAME ??= "gatarsis_test";
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.getHttpAdapter().getInstance().set("trust proxy", 1);
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    dataSource = app.get(DataSource);
    jwt = app.get(JwtService);
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await dataSource.query(
      "TRUNCATE admin_audit_logs, admin_sessions, admin_users RESTART IDENTITY CASCADE",
    );
    await dataSource.getRepository(AdminUser).save({
      email,
      passwordHash: await bcrypt.hash(password, 4),
      role: AdminRole.ADMIN,
      active: true,
      lastLoginAt: null,
    });
  });

  const login = () =>
    request(app.getHttpServer())
      .post("/api/v1/admin/auth/login")
      .set("X-Forwarded-For", `198.51.100.${requestNumber++}`)
      .send({ email, password });

  it("accepts valid login without exposing passwordHash and protects admin endpoints", async () => {
    await request(app.getHttpServer()).get("/api/v1/admin/auth/me").expect(401);
    const response = await login().expect(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        admin: { id: expect.any(String), email, role: AdminRole.ADMIN },
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");
    await request(app.getHttpServer())
      .get("/api/v1/admin/auth/me")
      .set("Authorization", `Bearer ${response.body.accessToken}`)
      .expect(200);
  });

  it("rejects incorrect password, unknown email and inactive administrators", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/admin/auth/login")
      .set("X-Forwarded-For", `198.51.100.${requestNumber++}`)
      .send({ email, password: "WrongPasswordWhichIsLongEnough!" })
      .expect(401);
    await request(app.getHttpServer())
      .post("/api/v1/admin/auth/login")
      .set("X-Forwarded-For", `198.51.100.${requestNumber++}`)
      .send({ email: "missing@example.test", password })
      .expect(401);
    await dataSource
      .getRepository(AdminUser)
      .update({ email }, { active: false });
    await request(app.getHttpServer())
      .post("/api/v1/admin/auth/login")
      .set("X-Forwarded-For", crypto.randomUUID())
      .send({ email, password })
      .expect(401);
  });

  it("rejects expired access tokens", async () => {
    const user = await dataSource
      .getRepository(AdminUser)
      .findOneByOrFail({ email });
    const session = await dataSource.query(
      "INSERT INTO admin_sessions (id, admin_user_id, refresh_token_hash, expires_at, revoked_at, last_used_at) VALUES (gen_random_uuid(), $1, 'unused', now() + interval '1 hour', NULL, NULL) RETURNING id",
      [user.id],
    );
    const token = await jwt.signAsync(
      { sub: user.id, role: AdminRole.ADMIN, sid: session[0].id },
      { expiresIn: -1 },
    );
    await request(app.getHttpServer())
      .get("/api/v1/admin/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
  });

  it("rotates refresh tokens and rejects replay of the previous token", async () => {
    const initial = await login().expect(200);
    const rotated = await request(app.getHttpServer())
      .post("/api/v1/admin/auth/refresh")
      .set("X-Forwarded-For", `198.51.100.${requestNumber++}`)
      .send({ refreshToken: initial.body.refreshToken })
      .expect(200);
    expect(rotated.body.refreshToken).not.toBe(initial.body.refreshToken);
    await request(app.getHttpServer())
      .post("/api/v1/admin/auth/refresh")
      .set("X-Forwarded-For", `198.51.100.${requestNumber++}`)
      .send({ refreshToken: initial.body.refreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .post("/api/v1/admin/auth/refresh")
      .set("X-Forwarded-For", `198.51.100.${requestNumber++}`)
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(200);
  });

  it("revokes the server-side session on logout", async () => {
    const authenticated = await login().expect(200);
    await request(app.getHttpServer())
      .post("/api/v1/admin/auth/logout")
      .set("Authorization", `Bearer ${authenticated.body.accessToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .get("/api/v1/admin/auth/me")
      .set("Authorization", `Bearer ${authenticated.body.accessToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .post("/api/v1/admin/auth/refresh")
      .set("X-Forwarded-For", `198.51.100.${requestNumber++}`)
      .send({ refreshToken: authenticated.body.refreshToken })
      .expect(401);
  });

  it("limits repeated login attempts", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app.getHttpServer())
          .post("/api/v1/admin/auth/login")
          .set("X-Forwarded-For", "198.51.100.99")
          .send({ email, password: "WrongPasswordWhichIsLongEnough!" }),
      ),
    );
    expect(attempts.filter((response) => response.status === 429)).toHaveLength(
      1,
    );
  });

  it("manages products, variants and media while excluding inactive products publicly", async () => {
    const auth = await login().expect(200);
    const bearer = { Authorization: `Bearer ${auth.body.accessToken}` };
    await request(app.getHttpServer()).post("/api/v1/admin/products").send({ name: "No auth", slug: "no-auth" }).expect(401);
    const product = await request(app.getHttpServer()).post("/api/v1/admin/products").set(bearer).send({ name: "Remera", slug: " Remera Premium ", featured: true, sortOrder: 2 }).expect(201);
    expect(product.body.slug).toBe("remera-premium");
    await request(app.getHttpServer()).post("/api/v1/admin/products").set(bearer).send({ name: "Otra", slug: "remera-premium" }).expect(409);
    await request(app.getHttpServer()).get("/api/v1/admin/products/not-a-uuid").set(bearer).expect(400);
    const variant = await request(app.getHttpServer()).post(`/api/v1/admin/products/${product.body.id}/variants`).set(bearer).send({ sku: " rem-001 ", name: "Roja M", priceInCents: 1500000 }).expect(201);
    expect(variant.body.sku).toBe("REM-001");
    await request(app.getHttpServer()).post(`/api/v1/admin/products/${product.body.id}/variants`).set(bearer).send({ sku: "rem-001", name: "Duplicada", priceInCents: 100 }).expect(409);
    await request(app.getHttpServer()).patch(`/api/v1/admin/variants/${variant.body.id}`).set(bearer).send({ priceInCents: 150 }).expect(200);
    const firstMedia = await request(app.getHttpServer()).post(`/api/v1/admin/products/${product.body.id}/media`).set(bearer).send({ url: "https://example.test/a.jpg", alt: "Frente", isCover: true }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/admin/products/${product.body.id}/media`).set(bearer).send({ url: "https://example.test/b.jpg", alt: "Dorso", isCover: true }).expect(201);
    const detailed = await request(app.getHttpServer()).get(`/api/v1/admin/products/${product.body.id}`).set(bearer).expect(200);
    expect(detailed.body.media.filter((media: { isCover: boolean }) => media.isCover)).toHaveLength(1);
    await request(app.getHttpServer()).delete(`/api/v1/admin/product-media/${firstMedia.body.id}`).set(bearer).expect(204);
    await request(app.getHttpServer()).patch(`/api/v1/admin/products/${product.body.id}`).set(bearer).send({ active: false }).expect(200);
    const publicList = await request(app.getHttpServer()).get("/api/v1/products").expect(200);
    expect(publicList.body.find((item: { id: string }) => item.id === product.body.id)).toBeUndefined();
    expect(await dataSource.query("SELECT count(*)::int AS count FROM admin_audit_logs WHERE entity_id = $1", [product.body.id])).toEqual([{ count: 2 }]);
  });
});
