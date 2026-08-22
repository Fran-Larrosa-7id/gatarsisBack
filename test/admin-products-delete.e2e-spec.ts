import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request = require("supertest");
import { DataSource } from "typeorm";
import { AppModule } from "../src/app.module";
import { AdminRole, AdminUser } from "../src/admin/entities/admin-user.entity";
import { AdminAuditLog } from "../src/admin/entities/admin-audit-log.entity";
import { Inventory } from "../src/inventory/entities/inventory.entity";
import { InventoryMovement, InventoryMovementType } from "../src/inventory/entities/inventory-movement.entity";
import { Order, OrderStatus } from "../src/orders/entities/order.entity";
import { OrderItem } from "../src/orders/entities/order-item.entity";
import { ProductMedia } from "../src/products/entities/product-media.entity";
import { Product } from "../src/products/entities/product.entity";
import { ProductVariant } from "../src/products/entities/product-variant.entity";

describe("admin product and variant deletion (PostgreSQL)", () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    process.env.DATABASE_NAME ??= "gatarsis_test";
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.getHttpAdapter().getInstance().set("trust proxy", 1);
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    ds = app.get(DataSource);
    await ds.runMigrations();
  });

  afterAll(async () => app?.close());

  beforeEach(async () => {
    await ds.query("TRUNCATE admin_audit_logs, admin_sessions, admin_users, refund_operations, inventory_movements, payments, payment_preferences, order_fulfillments, order_items, orders, inventory, product_media, product_variants, products RESTART IDENTITY CASCADE");
    const admin = await ds.getRepository(AdminUser).save({ email: `delete-${crypto.randomUUID()}@example.test`, passwordHash: await bcrypt.hash("CorrectHorseBatteryStaple!", 4), role: AdminRole.ADMIN, active: true, lastLoginAt: null });
    token = (await request(app.getHttpServer()).post("/api/v1/admin/auth/login").set("X-Forwarded-For", crypto.randomUUID()).send({ email: admin.email, password: "CorrectHorseBatteryStaple!" })).body.accessToken;
  });

  async function product() {
    return ds.getRepository(Product).save({ name: "Delete test", slug: `delete-${crypto.randomUUID()}`, active: true, sortOrder: 0 });
  }
  async function variant(productId: string, suffix: string) {
    const value = await ds.getRepository(ProductVariant).save({ productId, sku: `DEL-${suffix}-${crypto.randomUUID()}`, name: suffix, color: null, size: null, attributes: {}, priceInCents: 1000, active: true, sortOrder: 0, lowStockThreshold: null });
    await ds.getRepository(Inventory).save({ variantId: value.id, stockOnHand: 0, reservedStock: 0 });
    return value;
  }
  async function audit(action: string, entityId: string) {
    return ds.getRepository(AdminAuditLog).countBy({ action, entityId });
  }

  it("hard-deletes a product, its variants, inventory and media when it has no history", async () => {
    const p = await product();
    const first = await variant(p.id, "first");
    const second = await variant(p.id, "second");
    const general = await ds.getRepository(ProductMedia).save({ productId: p.id, variantId: null, url: "https://example.test/general.jpg", alt: "general", sortOrder: 0, isCover: true });
    const scoped = await ds.getRepository(ProductMedia).save({ productId: p.id, variantId: first.id, url: "https://example.test/first.jpg", alt: "first", sortOrder: 0, isCover: true });

    await request(app.getHttpServer()).delete(`/api/v1/admin/products/${p.id}`).set(auth()).expect(200).expect({ result: "DELETED" });

    expect(await ds.getRepository(Product).findOneBy({ id: p.id })).toBeNull();
    expect(await ds.getRepository(ProductVariant).countBy({ productId: p.id })).toBe(0);
    expect(await ds.getRepository(Inventory).countBy({ variantId: first.id })).toBe(0);
    expect(await ds.getRepository(Inventory).countBy({ variantId: second.id })).toBe(0);
    expect(await ds.getRepository(ProductMedia).findOneBy({ id: general.id })).toBeNull();
    expect(await ds.getRepository(ProductMedia).findOneBy({ id: scoped.id })).toBeNull();
    expect(await audit("PRODUCT_DELETED", p.id)).toBe(1);
  });

  it("archives a product with historical order items and preserves snapshots, movements and public exclusion", async () => {
    const p = await product();
    const v = await variant(p.id, "historical");
    const order = await ds.getRepository(Order).save({ status: OrderStatus.PAID, idempotencyKey: crypto.randomUUID(), requestFingerprint: null, subtotalInCents: 1000, totalInCents: 1000, reservationExpiresAt: new Date(), paidAt: new Date() });
    const item = await ds.getRepository(OrderItem).save({ orderId: order.id, variantId: v.id, productNameSnapshot: "Historical product", variantNameSnapshot: "Historical variant", skuSnapshot: "HIST-SKU", unitPriceInCents: 1000, quantity: 1, lineTotalInCents: 1000 });
    const movement = await ds.getRepository(InventoryMovement).save({ variantId: v.id, orderId: order.id, type: InventoryMovementType.SALE, onHandDelta: -1, reservedDelta: -1, reason: "sale" });

    await request(app.getHttpServer()).delete(`/api/v1/admin/products/${p.id}`).set(auth()).expect(200).expect({ result: "ARCHIVED" });

    expect(await ds.getRepository(Product).findOneByOrFail({ id: p.id })).toMatchObject({ active: false });
    expect(await ds.getRepository(ProductVariant).findOneByOrFail({ id: v.id })).toMatchObject({ active: false });
    expect(await ds.getRepository(OrderItem).findOneByOrFail({ id: item.id })).toMatchObject({ productNameSnapshot: "Historical product", skuSnapshot: "HIST-SKU" });
    expect(await ds.getRepository(InventoryMovement).findOneByOrFail({ id: movement.id })).toMatchObject({ variantId: v.id });
    expect((await request(app.getHttpServer()).get("/api/v1/products").expect(200)).body.map((entry: { id: string }) => entry.id)).not.toContain(p.id);
    expect(await audit("PRODUCT_ARCHIVED", p.id)).toBe(1);
    expect(await audit("VARIANT_ARCHIVED", v.id)).toBe(1);
  });

  it("hard-deletes a clean variant and archives a historical last active variant without exposing it publicly", async () => {
    const p = await product();
    const clean = await variant(p.id, "clean");
    const scoped = await ds.getRepository(ProductMedia).save({ productId: p.id, variantId: clean.id, url: "https://example.test/clean.jpg", alt: "clean", sortOrder: 0, isCover: true });
    const general = await ds.getRepository(ProductMedia).save({ productId: p.id, variantId: null, url: "https://example.test/general.jpg", alt: "general", sortOrder: 0, isCover: true });

    await request(app.getHttpServer()).delete(`/api/v1/admin/variants/${clean.id}`).set(auth()).expect(200).expect({ result: "DELETED" });
    expect(await ds.getRepository(ProductVariant).findOneBy({ id: clean.id })).toBeNull();
    expect(await ds.getRepository(Inventory).countBy({ variantId: clean.id })).toBe(0);
    expect(await ds.getRepository(ProductMedia).findOneBy({ id: scoped.id })).toBeNull();
    expect(await ds.getRepository(ProductMedia).findOneByOrFail({ id: general.id })).toMatchObject({ variantId: null });
    expect(await ds.getRepository(Product).findOneByOrFail({ id: p.id })).toMatchObject({ active: false });
    await request(app.getHttpServer()).delete(`/api/v1/admin/variants/${clean.id}`).set(auth()).expect(404).expect({ code: "VARIANT_NOT_FOUND", message: "La variante no existe." });

    const historicalProduct = await product();
    const historical = await variant(historicalProduct.id, "movement");
    const movement = await ds.getRepository(InventoryMovement).save({ variantId: historical.id, orderId: null, type: InventoryMovementType.ADJUSTMENT, onHandDelta: 0, reservedDelta: 0, reason: "history" });
    await request(app.getHttpServer()).delete(`/api/v1/admin/variants/${historical.id}`).set(auth()).expect(200).expect({ result: "ARCHIVED" });
    expect(await ds.getRepository(ProductVariant).findOneByOrFail({ id: historical.id })).toMatchObject({ active: false });
    expect(await ds.getRepository(Product).findOneByOrFail({ id: historicalProduct.id })).toMatchObject({ active: false });
    expect(await ds.getRepository(InventoryMovement).findOneByOrFail({ id: movement.id })).toMatchObject({ variantId: historical.id });
    expect(await audit("VARIANT_ARCHIVED", historical.id)).toBe(1);
  });

  it("rolls back a hard product deletion if a database deletion fails", async () => {
    const p = await product();
    const v = await variant(p.id, "rollback");
    await ds.query("CREATE OR REPLACE FUNCTION fail_product_variant_delete() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced variant delete failure'; END; $$ LANGUAGE plpgsql");
    await ds.query("CREATE TRIGGER fail_product_variant_delete BEFORE DELETE ON product_variants FOR EACH ROW EXECUTE FUNCTION fail_product_variant_delete()");
    try {
      await request(app.getHttpServer()).delete(`/api/v1/admin/products/${p.id}`).set(auth()).expect(500);
      expect(await ds.getRepository(Product).findOneBy({ id: p.id })).not.toBeNull();
      expect(await ds.getRepository(ProductVariant).findOneBy({ id: v.id })).not.toBeNull();
      expect(await ds.getRepository(Inventory).findOneBy({ variantId: v.id })).not.toBeNull();
      expect(await audit("PRODUCT_DELETED", p.id)).toBe(0);
    } finally {
      await ds.query("DROP TRIGGER IF EXISTS fail_product_variant_delete ON product_variants");
      await ds.query("DROP FUNCTION IF EXISTS fail_product_variant_delete()");
    }
  });
});
