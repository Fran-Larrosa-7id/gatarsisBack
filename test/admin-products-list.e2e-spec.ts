import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request = require("supertest");
import { DataSource } from "typeorm";
import { AppModule } from "../src/app.module";
import { AdminRole, AdminUser } from "../src/admin/entities/admin-user.entity";
import { Product } from "../src/products/entities/product.entity";
import { ProductMedia } from "../src/products/entities/product-media.entity";
import { ProductVariant } from "../src/products/entities/product-variant.entity";

describe("admin product list pagination (PostgreSQL)", () => {
  let app: INestApplication, ds: DataSource, token: string;
  const headers = () => ({ Authorization: `Bearer ${token}` });
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
    ds = app.get(DataSource);
    await ds.runMigrations();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await ds.query(
      "TRUNCATE admin_audit_logs, admin_sessions, admin_users, refund_operations, inventory_movements, payments, payment_preferences, order_items, orders, inventory, product_media, product_variants, products RESTART IDENTITY CASCADE",
    );
    const admin = await ds
      .getRepository(AdminUser)
      .save({
        email: "product-list@example.test",
        passwordHash: await bcrypt.hash("CorrectHorseBatteryStaple!", 4),
        role: AdminRole.ADMIN,
        active: true,
        lastLoginAt: null,
      });
    token = (
      await request(app.getHttpServer())
        .post("/api/v1/admin/auth/login")
        .set("X-Forwarded-For", crypto.randomUUID())
        .send({ email: admin.email, password: "CorrectHorseBatteryStaple!" })
    ).body.accessToken;
  });
  async function product(name: string, sortOrder: number, active = true) {
    return ds
      .getRepository(Product)
      .save({ name, slug: name.toLowerCase(), active, sortOrder });
  }
  async function fixture() {
    const alpha = await product("Alpha", 2);
    const bravo = await product("Bravo", 1);
    const charlie = await product("Charlie", 3);
    await product("Hidden", 0, false);
    await ds.query("UPDATE products SET created_at = $1 WHERE id = $2", [
      new Date("2026-01-01T00:00:00.000Z"),
      alpha.id,
    ]);
    await ds.query("UPDATE products SET created_at = $1 WHERE id = $2", [
      new Date("2026-01-02T00:00:00.000Z"),
      bravo.id,
    ]);
    await ds.query("UPDATE products SET created_at = $1 WHERE id = $2", [
      new Date("2026-01-03T00:00:00.000Z"),
      charlie.id,
    ]);
    for (const suffix of ["A", "B"])
      await ds
        .getRepository(ProductVariant)
        .save({
          productId: alpha.id,
          sku: `ALPHA-${suffix}`,
          name: `Alpha ${suffix}`,
          color: null,
          size: null,
          priceInCents: 100,
          active: true,
          lowStockThreshold: null,
        });
    await ds.getRepository(ProductMedia).save([
      {
        productId: alpha.id,
        url: "https://example.test/alpha-a.jpg",
        alt: "Alpha A",
        sortOrder: 0,
        isCover: true,
      },
      {
        productId: alpha.id,
        url: "https://example.test/alpha-b.jpg",
        alt: "Alpha B",
        sortOrder: 1,
        isCover: false,
      },
    ]);
    await ds
      .getRepository(ProductVariant)
      .save({
        productId: bravo.id,
        sku: "BRAVO-A",
        name: "Bravo A",
        color: null,
        size: null,
        priceInCents: 100,
        active: true,
        lowStockThreshold: null,
      });
    await ds
      .getRepository(ProductMedia)
      .save({
        productId: bravo.id,
        url: "https://example.test/bravo.jpg",
        alt: "Bravo",
        sortOrder: 0,
        isCover: true,
      });
  }

  it("serves the production URL with complete relations, no join duplicates and correct totals/pages", async () => {
    await fixture();
    const response = await request(app.getHttpServer())
      .get("/api/v1/admin/products?page=1&pageSize=30")
      .set(headers())
      .expect(200);
    expect(response.body).toMatchObject({ page: 1, pageSize: 30, total: 4 });
    expect(response.body.items.map((p: { id: string }) => p.id)).toHaveLength(
      new Set(response.body.items.map((p: { id: string }) => p.id)).size,
    );
    const alpha = response.body.items.find(
      (p: { name: string }) => p.name === "Alpha",
    );
    expect(alpha.variants).toHaveLength(2);
    expect(alpha.media).toHaveLength(2);
    const second = await request(app.getHttpServer())
      .get("/api/v1/admin/products?page=2&pageSize=2&sort=name:asc")
      .set(headers())
      .expect(200);
    expect(second.body).toMatchObject({ page: 2, pageSize: 2, total: 4 });
    expect(second.body.items.map((p: { name: string }) => p.name)).toEqual([
      "Charlie",
      "Hidden",
    ]);
    const search = await request(app.getHttpServer())
      .get("/api/v1/admin/products?search=alp&active=true")
      .set(headers())
      .expect(200);
    expect(search.body).toMatchObject({ total: 1 });
    expect(search.body.items[0].name).toBe("Alpha");
  });

  it.each([
    ["sortOrder:asc", ["Hidden", "Bravo", "Alpha", "Charlie"]],
    ["sortOrder:desc", ["Charlie", "Alpha", "Bravo", "Hidden"]],
    ["name:asc", ["Alpha", "Bravo", "Charlie", "Hidden"]],
    ["name:desc", ["Hidden", "Charlie", "Bravo", "Alpha"]],
    ["createdAt:asc", ["Alpha", "Bravo", "Charlie", "Hidden"]],
    ["createdAt:desc", ["Hidden", "Charlie", "Bravo", "Alpha"]],
  ])("supports allowed sort %s", async (sort, expected) => {
    await fixture();
    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/products?page=1&pageSize=30&sort=${sort}`)
      .set(headers())
      .expect(200);
    expect(response.body.total).toBe(4);
    expect(response.body.items.map((p: { name: string }) => p.name)).toEqual(
      expected,
    );
  });
});
