import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request = require("supertest");
import { DataSource } from "typeorm";
import { AppModule } from "../src/app.module";
import { AdminRole, AdminUser } from "../src/admin/entities/admin-user.entity";
import { Inventory } from "../src/inventory/entities/inventory.entity";
import { Product } from "../src/products/entities/product.entity";
import { ProductVariant } from "../src/products/entities/product-variant.entity";

describe("variant attributes (PostgreSQL)", () => {
  let app: INestApplication, ds: DataSource, token: string;
  const headers = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    process.env.DATABASE_NAME ??= "gatarsis_test";
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.getHttpAdapter().getInstance().set("trust proxy", 1);
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init(); ds = app.get(DataSource); await ds.runMigrations();
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(async () => {
    await ds.query("TRUNCATE admin_audit_logs, admin_sessions, admin_users, refund_operations, inventory_movements, payments, payment_preferences, order_fulfillments, order_items, orders, inventory, product_media, product_variants, products RESTART IDENTITY CASCADE");
    const admin = await ds.getRepository(AdminUser).save({ email: "attributes@example.test", passwordHash: await bcrypt.hash("CorrectHorseBatteryStaple!", 4), role: AdminRole.ADMIN, active: true, lastLoginAt: null });
    token = (await request(app.getHttpServer()).post("/api/v1/admin/auth/login").set("X-Forwarded-For", crypto.randomUUID()).send({ email: admin.email, password: "CorrectHorseBatteryStaple!" })).body.accessToken;
  });
  async function product() { return ds.getRepository(Product).save({ name: "Remera Gatarsis", slug: `remera-${crypto.randomUUID()}`, active: true, sortOrder: 0 }); }
  const create = (productId: string, sku: string, attributes: unknown, initialStock = 0) => request(app.getHttpServer()).post(`/api/v1/admin/products/${productId}/variants`).set(headers()).send({ name: sku, sku, priceInCents: 1500, attributes, initialStock });

  it("creates normalized color+size and color-only variants, and exposes attributes publicly", async () => {
    const p = await product();
    const shirt = await create(p.id, "REM-BLA-S", { " Color ": " Blanco ", TALLE: " S " }, 3).expect(201);
    expect(shirt.body).toMatchObject({ color: "Blanco", size: "S", attributes: { color: "Blanco", size: "S" } });
    const keychain = await create(p.id, "LLA-LIL", { color: "Lila" }, 2).expect(201);
    expect(keychain.body).toMatchObject({ color: "Lila", size: null, attributes: { color: "Lila" } });
    await create(p.id, "REM-BLA-S-DUP", { color: "blanco", size: "s" }).expect(409).expect(({ body }) => expect(body.code).toBe("VARIANT_ATTRIBUTE_COMBINATION_CONFLICT"));
    await create(p.id, "INVALID", { color: { label: "Blanco" } }).expect(400).expect(({ body }) => expect(body.code).toBe("INVALID_VARIANT_ATTRIBUTES"));
    const publicProduct = await request(app.getHttpServer()).get(`/api/v1/products/${p.slug}`).expect(200);
    expect(publicProduct.body.variants).toEqual(expect.arrayContaining([expect.objectContaining({ id: shirt.body.id, attributes: { color: "Blanco", size: "S" }, active: true, availableStock: 3 }), expect.objectContaining({ id: keychain.body.id, attributes: { color: "Lila" }, active: true, availableStock: 2 })]));
  });

  it("keeps legacy variants compatible with an empty attributes object", async () => {
    const p = await product();
    const legacy = await ds.getRepository(ProductVariant).save({ productId: p.id, sku: "LEGACY-ONE", name: "Legacy", color: "Negro", size: null, attributes: {}, priceInCents: 1000, active: true, sortOrder: 0, lowStockThreshold: null });
    await ds.getRepository(Inventory).save({ variantId: legacy.id, stockOnHand: 2, reservedStock: 0 });
    const publicProduct = await request(app.getHttpServer()).get(`/api/v1/products/${p.slug}`).expect(200);
    expect(publicProduct.body.variants).toEqual(expect.arrayContaining([expect.objectContaining({ id: legacy.id, attributes: {}, availableStock: 2 })]));
  });

  it("reserves stock only for the exact structured variant", async () => {
    const p = await product();
    const small = await create(p.id, "REM-BLA-S", { color: "Blanco", size: "S" }, 3).expect(201);
    const medium = await create(p.id, "REM-BLA-M", { color: "Blanco", size: "M" }, 1).expect(201);
    await request(app.getHttpServer()).post("/api/v1/checkout/reserve").set("Idempotency-Key", crypto.randomUUID()).send({ items: [{ variantId: small.body.id, quantity: 1 }], customer: { name: "Buyer", email: "buyer@example.test", phone: "2491234567" }, fulfillment: { method: "PICKUP", note: null } }).expect(201);
    expect(await ds.getRepository(Inventory).findOneByOrFail({ variantId: small.body.id })).toMatchObject({ stockOnHand: 3, reservedStock: 1 });
    expect(await ds.getRepository(Inventory).findOneByOrFail({ variantId: medium.body.id })).toMatchObject({ stockOnHand: 1, reservedStock: 0 });
  });
});
