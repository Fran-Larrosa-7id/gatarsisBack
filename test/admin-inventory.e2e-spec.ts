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
import {
  InventoryMovement,
  InventoryMovementType,
} from "../src/inventory/entities/inventory-movement.entity";
import { OrdersService } from "../src/orders/orders.service";
import { Order } from "../src/orders/entities/order.entity";
import { PaymentsService } from "../src/payments/payments.service";

describe("admin inventory (PostgreSQL)", () => {
  let app: INestApplication, dataSource: DataSource;
  beforeAll(async () => {
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
    await dataSource.runMigrations();
  });
  afterAll(async () => {
    await app.close();
  });
  it("restocks, adjusts and records movement/audit without violating reservations", async () => {
    await dataSource.query(
      "TRUNCATE admin_audit_logs, admin_sessions, admin_users, inventory_movements, order_items, orders, inventory, product_variants, products RESTART IDENTITY CASCADE",
    );
    await dataSource
      .getRepository(AdminUser)
      .save({
        email: "inventory-admin@test.local",
        passwordHash: await bcrypt.hash("CorrectHorseBatteryStaple!", 4),
        role: AdminRole.ADMIN,
        active: true,
        lastLoginAt: null,
      });
    const login = await request(app.getHttpServer())
      .post("/api/v1/admin/auth/login")
      .set("X-Forwarded-For", "203.0.113.100")
      .send({
        email: "inventory-admin@test.local",
        password: "CorrectHorseBatteryStaple!",
      })
      .expect(200);
    const bearer = { Authorization: `Bearer ${login.body.accessToken}` };
    const product = await dataSource
      .getRepository(Product)
      .save({
        slug: `stock-${crypto.randomUUID()}`,
        name: "Stock product",
        active: true,
        shortDescription: null,
        featured: false,
        sortOrder: 0,
      });
    const variant = await dataSource
      .getRepository(ProductVariant)
      .save({
        productId: product.id,
        sku: `STOCK-${crypto.randomUUID()}`,
        name: "Stock variant",
        color: null,
        size: null,
        priceInCents: 100,
        active: true,
        sortOrder: 0,
        lowStockThreshold: 3,
      });
    await dataSource
      .getRepository(Inventory)
      .save({ variantId: variant.id, stockOnHand: 5, reservedStock: 0 });
    await request(app.getHttpServer())
      .get("/api/v1/admin/inventory")
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/inventory/${variant.id}/restock`)
      .set(bearer)
      .send({ quantity: 10, reason: "Nueva tanda" })
      .expect(201);
    await dataSource
      .getRepository(Inventory)
      .update({ variantId: variant.id }, { reservedStock: 3 });
    await request(app.getHttpServer())
      .post(`/api/v1/admin/inventory/${variant.id}/adjust`)
      .set(bearer)
      .send({ stockOnHand: 2, reason: "Conteo" })
      .expect(409);
    expect(
      await dataSource
        .getRepository(Inventory)
        .findOneByOrFail({ variantId: variant.id }),
    ).toMatchObject({ stockOnHand: 15, reservedStock: 3 });
    await request(app.getHttpServer())
      .post(`/api/v1/admin/inventory/${variant.id}/adjust`)
      .set(bearer)
      .send({ stockOnHand: 7, reason: "Conteo" })
      .expect(201);
    const history = await request(app.getHttpServer())
      .get(
        `/api/v1/admin/inventory/${variant.id}/movements?type=ADJUSTMENT&pageSize=1`,
      )
      .set(bearer)
      .expect(200);
    expect(history.body.items).toHaveLength(1);
    expect(
      await dataSource.query(
        "SELECT count(*)::int AS count FROM admin_audit_logs WHERE entity_id = $1 AND action IN ('INVENTORY_RESTOCKED','INVENTORY_ADJUSTED')",
        [variant.id],
      ),
    ).toEqual([{ count: 2 }]);
    await request(app.getHttpServer())
      .post("/api/v1/admin/inventory/not-a-uuid/restock")
      .set(bearer)
      .send({ quantity: 1, reason: "x" })
      .expect(400);
  });

  it("serializes real concurrent RESTOCK and checkout RESERVE on PostgreSQL", async () => {
    await dataSource.query(
      "TRUNCATE admin_audit_logs, admin_sessions, admin_users, inventory_movements, order_items, orders, inventory, product_variants, products RESTART IDENTITY CASCADE",
    );
    await dataSource
      .getRepository(AdminUser)
      .save({
        email: "concurrent-admin@test.local",
        passwordHash: await bcrypt.hash("CorrectHorseBatteryStaple!", 4),
        role: AdminRole.ADMIN,
        active: true,
        lastLoginAt: null,
      });
    const login = await request(app.getHttpServer())
      .post("/api/v1/admin/auth/login")
      .set("X-Forwarded-For", "203.0.113.101")
      .send({
        email: "concurrent-admin@test.local",
        password: "CorrectHorseBatteryStaple!",
      });
    const product = await dataSource
      .getRepository(Product)
      .save({
        slug: `concurrent-${crypto.randomUUID()}`,
        name: "Concurrent",
        active: true,
        shortDescription: null,
        featured: false,
        sortOrder: 0,
      });
    const variant = await dataSource
      .getRepository(ProductVariant)
      .save({
        productId: product.id,
        sku: `CON-${crypto.randomUUID()}`,
        name: "Concurrent",
        color: null,
        size: null,
        priceInCents: 100,
        active: true,
        sortOrder: 0,
        lowStockThreshold: null,
      });
    await dataSource
      .getRepository(Inventory)
      .save({ variantId: variant.id, stockOnHand: 5, reservedStock: 0 });
    const [reserve, restock] = await Promise.all([
      request(app.getHttpServer())
        .post("/api/v1/checkout/reserve")
        .set("Idempotency-Key", `concurrent-${crypto.randomUUID()}`)
        .send({ items: [{ variantId: variant.id, quantity: 1 }] }),
      request(app.getHttpServer())
        .post(`/api/v1/admin/inventory/${variant.id}/restock`)
        .set("Authorization", `Bearer ${login.body.accessToken}`)
        .send({ quantity: 10, reason: "Concurrent batch" }),
    ]);
    expect(reserve.status).toBe(201);
    expect(restock.status).toBe(201);
    expect(
      await dataSource
        .getRepository(Inventory)
        .findOneByOrFail({ variantId: variant.id }),
    ).toMatchObject({ stockOnHand: 15, reservedStock: 1 });
    expect(
      await dataSource
        .getRepository(InventoryMovement)
        .countBy({
          variantId: variant.id,
          type: InventoryMovementType.RESERVE,
        }),
    ).toBe(1);
    expect(
      await dataSource
        .getRepository(InventoryMovement)
        .countBy({
          variantId: variant.id,
          type: InventoryMovementType.RESTOCK,
        }),
    ).toBe(1);
    expect(
      await dataSource.query(
        "SELECT count(*)::int AS count FROM admin_audit_logs WHERE action = 'INVENTORY_RESTOCKED' AND entity_id = $1",
        [variant.id],
      ),
    ).toEqual([{ count: 1 }]);
  });

  it("rolls back restock when the PostgreSQL movement trigger fails", async () => {
    await dataSource.query(
      "TRUNCATE admin_audit_logs, admin_sessions, admin_users, inventory_movements, order_items, orders, inventory, product_variants, products RESTART IDENTITY CASCADE",
    );
    await dataSource
      .getRepository(AdminUser)
      .save({
        email: "atomic-admin@test.local",
        passwordHash: await bcrypt.hash("CorrectHorseBatteryStaple!", 4),
        role: AdminRole.ADMIN,
        active: true,
        lastLoginAt: null,
      });
    const login = await request(app.getHttpServer())
      .post("/api/v1/admin/auth/login")
      .set("X-Forwarded-For", "203.0.113.102")
      .send({
        email: "atomic-admin@test.local",
        password: "CorrectHorseBatteryStaple!",
      });
    const product = await dataSource
      .getRepository(Product)
      .save({
        slug: `atomic-${crypto.randomUUID()}`,
        name: "Atomic",
        active: true,
        shortDescription: null,
        featured: false,
        sortOrder: 0,
      });
    const variant = await dataSource
      .getRepository(ProductVariant)
      .save({
        productId: product.id,
        sku: `ATM-${crypto.randomUUID()}`,
        name: "Atomic",
        color: null,
        size: null,
        priceInCents: 100,
        active: true,
        sortOrder: 0,
        lowStockThreshold: null,
      });
    await dataSource
      .getRepository(Inventory)
      .save({ variantId: variant.id, stockOnHand: 5, reservedStock: 0 });
    await dataSource.query(
      "CREATE OR REPLACE FUNCTION fail_inventory_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test movement failure'; END $$",
    );
    await dataSource.query(
      "CREATE TRIGGER fail_inventory_test_trigger BEFORE INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION fail_inventory_test()",
    );
    try {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/inventory/${variant.id}/restock`)
        .set("Authorization", `Bearer ${login.body.accessToken}`)
        .send({ quantity: 10, reason: "Must rollback" })
        .expect(500);
    } finally {
      await dataSource.query(
        "DROP TRIGGER IF EXISTS fail_inventory_test_trigger ON inventory_movements",
      );
      await dataSource.query("DROP FUNCTION IF EXISTS fail_inventory_test()");
    }
    expect(
      await dataSource
        .getRepository(Inventory)
        .findOneByOrFail({ variantId: variant.id }),
    ).toMatchObject({ stockOnHand: 5, reservedStock: 0 });
  });

  it("serializes ADJUST against a real reservation without breaking invariants", async () => {
    await dataSource.query(
      "TRUNCATE admin_audit_logs, admin_sessions, admin_users, inventory_movements, order_items, orders, inventory, product_variants, products RESTART IDENTITY CASCADE",
    );
    await dataSource
      .getRepository(AdminUser)
      .save({
        email: "adjust-admin@test.local",
        passwordHash: await bcrypt.hash("CorrectHorseBatteryStaple!", 4),
        role: AdminRole.ADMIN,
        active: true,
        lastLoginAt: null,
      });
    const login = await request(app.getHttpServer())
      .post("/api/v1/admin/auth/login")
      .set("X-Forwarded-For", "203.0.113.103")
      .send({
        email: "adjust-admin@test.local",
        password: "CorrectHorseBatteryStaple!",
      });
    const product = await dataSource
      .getRepository(Product)
      .save({
        slug: `adjust-${crypto.randomUUID()}`,
        name: "Adjust",
        active: true,
        shortDescription: null,
        featured: false,
        sortOrder: 0,
      });
    const variant = await dataSource
      .getRepository(ProductVariant)
      .save({
        productId: product.id,
        sku: `ADJ-${crypto.randomUUID()}`,
        name: "Adjust",
        color: null,
        size: null,
        priceInCents: 100,
        active: true,
        sortOrder: 0,
        lowStockThreshold: null,
      });
    await dataSource
      .getRepository(Inventory)
      .save({ variantId: variant.id, stockOnHand: 1, reservedStock: 0 });
    const [reserve, adjust] = await Promise.all([
      request(app.getHttpServer())
        .post("/api/v1/checkout/reserve")
        .set("Idempotency-Key", `adjust-${crypto.randomUUID()}`)
        .send({ items: [{ variantId: variant.id, quantity: 1 }] }),
      request(app.getHttpServer())
        .post(`/api/v1/admin/inventory/${variant.id}/adjust`)
        .set("Authorization", `Bearer ${login.body.accessToken}`)
        .send({ stockOnHand: 0, reason: "Concurrent count" }),
    ]);
    const inv = await dataSource
      .getRepository(Inventory)
      .findOneByOrFail({ variantId: variant.id });
    expect(inv.reservedStock).toBeLessThanOrEqual(inv.stockOnHand);
    expect([reserve.status, adjust.status].sort()).toEqual([201, 409]);
  });

  it("serializes expiration RELEASE against ADJUST using real transactions", async () => {
    const inventory = await dataSource
      .getRepository(Inventory)
      .findOneOrFail({ where: {}, relations: { variant: true } });
    await dataSource
      .getRepository(Inventory)
      .update({ id: inventory.id }, { stockOnHand: 5, reservedStock: 0 });
    const login = await request(app.getHttpServer())
      .post("/api/v1/admin/auth/login")
      .set("X-Forwarded-For", "203.0.113.104")
      .send({
        email: "adjust-admin@test.local",
        password: "CorrectHorseBatteryStaple!",
      });
    const reservation = await request(app.getHttpServer())
      .post("/api/v1/checkout/reserve")
      .set("Idempotency-Key", `release-${crypto.randomUUID()}`)
      .send({ items: [{ variantId: inventory.variantId, quantity: 1 }] })
      .expect(201);
    await dataSource
      .getRepository(Order)
      .update(reservation.body.orderId, {
        reservationExpiresAt: new Date(Date.now() - 1000),
      });
    await Promise.all([
      app.get(OrdersService).expireReservations(new Date()),
      request(app.getHttpServer())
        .post(`/api/v1/admin/inventory/${inventory.variantId}/adjust`)
        .set("Authorization", `Bearer ${login.body.accessToken}`)
        .send({ stockOnHand: 1, reason: "Concurrent count" }),
    ]);
    const final = await dataSource
      .getRepository(Inventory)
      .findOneByOrFail({ variantId: inventory.variantId });
    expect(final.reservedStock).toBeGreaterThanOrEqual(0);
    expect(final.reservedStock).toBeLessThanOrEqual(final.stockOnHand);
  });
  it("serializes approved payment SALE against Admin ADJUST", async () => {
    const inventory = await dataSource.getRepository(Inventory).findOneOrFail({ where: {}, relations: { variant: true } });
    await dataSource.getRepository(Inventory).update({ id: inventory.id }, { stockOnHand: 5, reservedStock: 0 });
    const login = await request(app.getHttpServer()).post("/api/v1/admin/auth/login").set("X-Forwarded-For", "203.0.113.105").send({ email: "adjust-admin@test.local", password: "CorrectHorseBatteryStaple!" });
    const reservation = await request(app.getHttpServer()).post("/api/v1/checkout/reserve").set("Idempotency-Key", `sale-${crypto.randomUUID()}`).send({ items: [{ variantId: inventory.variantId, quantity: 1 }] }).expect(201);
    const [_, adjustment] = await Promise.all([app.get(PaymentsService).recordAndApply({ id: `approved-${crypto.randomUUID()}`, status: "approved", transaction_amount: 1, currency_id: "ARS", external_reference: reservation.body.orderId }), request(app.getHttpServer()).post(`/api/v1/admin/inventory/${inventory.variantId}/adjust`).set("Authorization", `Bearer ${login.body.accessToken}`).send({ stockOnHand: 4, reason: "Concurrent sale" })]);
    const final = await dataSource.getRepository(Inventory).findOneByOrFail({ variantId: inventory.variantId });
    expect(final.stockOnHand).toBeGreaterThanOrEqual(0); expect(final.reservedStock).toBeGreaterThanOrEqual(0); expect(final.reservedStock).toBeLessThanOrEqual(final.stockOnHand); expect(await dataSource.getRepository(InventoryMovement).countBy({ variantId: inventory.variantId, type: InventoryMovementType.SALE })).toBe(1); expect([201, 409]).toContain(adjustment.status);
  });

  it("rolls back restock if the PostgreSQL AdminAuditLog trigger fails", async () => {
    const inventory = await dataSource.getRepository(Inventory).findOneOrFail({ where: {} }); const login = await request(app.getHttpServer()).post("/api/v1/admin/auth/login").set("X-Forwarded-For", "203.0.113.106").send({ email: "adjust-admin@test.local", password: "CorrectHorseBatteryStaple!" }); const before = inventory.stockOnHand;
    await dataSource.query("CREATE OR REPLACE FUNCTION fail_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$"); await dataSource.query("CREATE TRIGGER fail_audit_test_trigger BEFORE INSERT ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION fail_audit_test()");
    try { await request(app.getHttpServer()).post(`/api/v1/admin/inventory/${inventory.variantId}/restock`).set("Authorization", `Bearer ${login.body.accessToken}`).send({ quantity: 2, reason: "rollback audit" }).expect(500); } finally { await dataSource.query("DROP TRIGGER IF EXISTS fail_audit_test_trigger ON admin_audit_logs"); await dataSource.query("DROP FUNCTION IF EXISTS fail_audit_test()"); }
    expect((await dataSource.getRepository(Inventory).findOneByOrFail({ variantId: inventory.variantId })).stockOnHand).toBe(before); expect(await dataSource.getRepository(InventoryMovement).countBy({ variantId: inventory.variantId, type: InventoryMovementType.RESTOCK })).toBe(0);
  });
});
