import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request = require("supertest");
import { DataSource } from "typeorm";
import { AppModule } from "../src/app.module";
import { AdminAuditLog } from "../src/admin/entities/admin-audit-log.entity";
import { AdminRole, AdminUser } from "../src/admin/entities/admin-user.entity";
import { Inventory } from "../src/inventory/entities/inventory.entity";
import {
  InventoryMovement,
  InventoryMovementType,
} from "../src/inventory/entities/inventory-movement.entity";
import { Order, OrderStatus } from "../src/orders/entities/order.entity";
import {
  OrderFulfillment,
  FulfillmentStatus,
} from "../src/orders/entities/order-fulfillment.entity";
import { Product } from "../src/products/entities/product.entity";
import { ProductVariant } from "../src/products/entities/product-variant.entity";

describe("fulfillment (PostgreSQL)", () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;

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
      "TRUNCATE admin_audit_logs, admin_sessions, admin_users, refund_operations, inventory_movements, payments, payment_preferences, order_fulfillments, order_items, orders, inventory, product_media, product_variants, products RESTART IDENTITY CASCADE",
    );
    const admin = await ds.getRepository(AdminUser).save({
      email: "fulfillment@example.test",
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

  async function variant(stock = 5) {
    const product = await ds.getRepository(Product).save({
      name: "Fulfillment product",
      slug: `fulfillment-${crypto.randomUUID()}`,
      active: true,
      sortOrder: 0,
    });
    const value = await ds.getRepository(ProductVariant).save({
      productId: product.id,
      sku: `FUL-${crypto.randomUUID()}`,
      name: "Fulfillment variant",
      color: null,
      size: null,
      priceInCents: 1000,
      active: true,
      sortOrder: 0,
      lowStockThreshold: null,
    });
    await ds.getRepository(Inventory).save({
      variantId: value.id,
      stockOnHand: stock,
      reservedStock: 0,
    });
    return value;
  }

  function payload(variantId: string, overrides: Record<string, unknown> = {}) {
    return {
      items: [{ variantId, quantity: 1 }],
      customer: {
        name: "Test Buyer",
        email: "buyer@example.com",
        phone: "2491234567",
      },
      fulfillment: { method: "PICKUP", note: "Customer note" },
      ...overrides,
    };
  }

  function reserve(
    body: Record<string, unknown>,
    key: string = crypto.randomUUID(),
  ) {
    return request(app.getHttpServer())
      .post("/api/v1/checkout/reserve")
      .set("Idempotency-Key", key)
      .send(body);
  }

  async function reserveOrder(stock = 5) {
    const v = await variant(stock);
    const response = await reserve(payload(v.id), crypto.randomUUID()).expect(
      201,
    );
    return { v, orderId: response.body.orderId as string };
  }

  async function historicalOrder(status = OrderStatus.AWAITING_PAYMENT) {
    return ds.getRepository(Order).save({
      status,
      idempotencyKey: crypto.randomUUID(),
      requestFingerprint: null,
      subtotalInCents: 0,
      totalInCents: 0,
      reservationExpiresAt: new Date(Date.now() + 60_000),
      paidAt: status === OrderStatus.PAID ? new Date() : null,
    });
  }

  it("requires customer and fulfillment objects with 400 responses", async () => {
    const v = await variant();
    const withoutCustomer = payload(v.id);
    delete (withoutCustomer as { customer?: unknown }).customer;
    const withoutFulfillment = payload(v.id);
    delete (withoutFulfillment as { fulfillment?: unknown }).fulfillment;

    await reserve(withoutCustomer).expect(400);
    await reserve(withoutFulfillment).expect(400);
    expect(await ds.getRepository(Order).count()).toBe(0);
  });

  it("creates order, items, fulfillment, reservation and reserve movement atomically", async () => {
    const v = await variant();
    const response = await reserve(
      payload(v.id, {
        customer: {
          name: "  Test Buyer  ",
          email: "  TEST@Example.COM  ",
          phone: "  2491234567  ",
        },
        fulfillment: { method: "PICKUP", note: "  Customer note  " },
      }),
      "valid-reserve",
    ).expect(201);
    const orderId = response.body.orderId as string;
    const fulfillment = await ds
      .getRepository(OrderFulfillment)
      .findOneByOrFail({ orderId });

    expect(response.body).toMatchObject({
      orderId,
      status: "awaiting_payment",
      totalInCents: 1000,
      items: [expect.objectContaining({ variantId: v.id, quantity: 1 })],
    });
    expect(await ds.getRepository(Order).countBy({ id: orderId })).toBe(1);
    expect(
      await ds.getRepository(Inventory).findOneByOrFail({ variantId: v.id }),
    ).toMatchObject({
      stockOnHand: 5,
      reservedStock: 1,
    });
    expect(
      await ds.getRepository(InventoryMovement).countBy({
        orderId,
        variantId: v.id,
        type: InventoryMovementType.RESERVE,
      }),
    ).toBe(1);
    expect(fulfillment).toMatchObject({
      orderId,
      customerName: "Test Buyer",
      customerEmail: "test@example.com",
      customerPhone: "2491234567",
      customerNote: "Customer note",
      method: "PICKUP",
      status: FulfillmentStatus.PENDING,
      adminNote: null,
      readyAt: null,
      completedAt: null,
    });
  });

  it.each([
    [
      "empty name",
      {
        customer: { name: "", email: "buyer@example.com", phone: "2491234567" },
      },
    ],
    [
      "blank name",
      {
        customer: {
          name: "   ",
          email: "buyer@example.com",
          phone: "2491234567",
        },
      },
    ],
    [
      "invalid email",
      { customer: { name: "Buyer", email: "invalid", phone: "2491234567" } },
    ],
    [
      "blank phone",
      { customer: { name: "Buyer", email: "buyer@example.com", phone: "" } },
    ],
    ["invalid method", { fulfillment: { method: "DELIVERY", note: null } }],
  ])("returns 400 for %s", async (_name, overrides) => {
    const v = await variant();
    await reserve(payload(v.id, overrides)).expect(400);
    expect(await ds.getRepository(Order).count()).toBe(0);
  });

  it("rolls back order, reservation, movement and items when fulfillment persistence fails", async () => {
    const v = await variant();
    await ds.query(
      "CREATE FUNCTION fail_fulfillment_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test fulfillment failure'; END; $$",
    );
    await ds.query(
      "CREATE TRIGGER fail_fulfillment_test BEFORE INSERT ON order_fulfillments FOR EACH ROW EXECUTE FUNCTION fail_fulfillment_test()",
    );
    try {
      await reserve(payload(v.id), "fulfillment-rollback").expect(500);
      expect(await ds.getRepository(Order).count()).toBe(0);
      expect(await ds.getRepository(OrderFulfillment).count()).toBe(0);
      expect(await ds.getRepository(InventoryMovement).count()).toBe(0);
      expect(
        await ds.getRepository(Inventory).findOneByOrFail({ variantId: v.id }),
      ).toMatchObject({
        stockOnHand: 5,
        reservedStock: 0,
      });
    } finally {
      await ds.query(
        "DROP TRIGGER IF EXISTS fail_fulfillment_test ON order_fulfillments",
      );
      await ds.query("DROP FUNCTION IF EXISTS fail_fulfillment_test()");
    }
  });

  it("creates exactly one order and fulfillment for 20 concurrent identical idempotent reserves", async () => {
    const v = await variant(2);
    const body = payload(v.id);
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => reserve(body, "same-fulfillment-key")),
    );
    expect(responses.map((response) => response.status)).toEqual(
      Array(20).fill(201),
    );
    const orders = await ds
      .getRepository(Order)
      .findBy({ idempotencyKey: "same-fulfillment-key" });
    expect(orders).toHaveLength(1);
    expect(
      await ds
        .getRepository(OrderFulfillment)
        .countBy({ orderId: orders[0].id }),
    ).toBe(1);
    expect(
      await ds.getRepository(InventoryMovement).countBy({
        orderId: orders[0].id,
        type: InventoryMovementType.RESERVE,
      }),
    ).toBe(1);
    expect(
      await ds.getRepository(Inventory).findOneByOrFail({ variantId: v.id }),
    ).toMatchObject({
      stockOnHand: 2,
      reservedStock: 1,
    });
  });

  it("rejects reused idempotency keys with different customer or fulfillment payloads", async () => {
    const v = await variant();
    const key = "fulfillment-conflict";
    const first = await reserve(payload(v.id), key).expect(201);

    const customerConflict = await reserve(
      payload(v.id, {
        customer: {
          name: "Other Buyer",
          email: "other@example.com",
          phone: "2491234567",
        },
      }),
      key,
    ).expect(409);
    const fulfillmentConflict = await reserve(
      payload(v.id, {
        fulfillment: { method: "PICKUP", note: "Different note" },
      }),
      key,
    ).expect(409);
    expect(customerConflict.body).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect(fulfillmentConflict.body).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect(await ds.getRepository(Order).countBy({ idempotencyKey: key })).toBe(
      1,
    );
    expect(
      await ds
        .getRepository(OrderFulfillment)
        .countBy({ orderId: first.body.orderId }),
    ).toBe(1);
  });

  it("does not expose fulfillment PII from the public order status endpoint", async () => {
    const { orderId } = await reserveOrder();
    const response = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderId}/status`)
      .expect(200);
    const serialized = JSON.stringify(response.body);
    for (const field of [
      "customer",
      "customerName",
      "customerEmail",
      "customerPhone",
      "customerNote",
      "adminNote",
    ]) {
      expect(response.body).not.toHaveProperty(field);
      expect(serialized).not.toContain(field);
    }
  });

  it("returns the explicit fulfillment read model to authenticated admin detail and null for historical orders", async () => {
    const { orderId } = await reserveOrder();
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/admin/orders/${orderId}`)
      .set(headers())
      .expect(200);
    expect(detail.body.fulfillment).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        method: "PICKUP",
        status: "PENDING",
        customer: {
          name: "Test Buyer",
          email: "buyer@example.com",
          phone: "2491234567",
        },
        customerNote: "Customer note",
        adminNote: null,
        readyAt: null,
        completedAt: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      }),
    );

    const historical = await historicalOrder();
    const historicalDetail = await request(app.getHttpServer())
      .get(`/api/v1/admin/orders/${historical.id}`)
      .set(headers())
      .expect(200);
    expect(historicalDetail.body.fulfillment).toBeNull();
  });

  it("requires admin authentication for fulfillment detail and mutation", async () => {
    const { orderId } = await reserveOrder();
    await request(app.getHttpServer())
      .get(`/api/v1/admin/orders/${orderId}`)
      .expect(401);
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/orders/${orderId}/fulfillment`)
      .send({ status: "READY_FOR_PICKUP" })
      .expect(401);
  });

  it("rejects READY_FOR_PICKUP for an unpaid order without changing fulfillment", async () => {
    const { orderId } = await reserveOrder();
    const response = await request(app.getHttpServer())
      .patch(`/api/v1/admin/orders/${orderId}/fulfillment`)
      .set(headers())
      .send({ status: "READY_FOR_PICKUP" })
      .expect(409);
    expect(response.body).toMatchObject({ code: "ORDER_NOT_PAID" });
    expect(
      (await ds.getRepository(OrderFulfillment).findOneByOrFail({ orderId }))
        .status,
    ).toBe(FulfillmentStatus.PENDING);
  });

  it("allows PAID to READY_FOR_PICKUP and then COMPLETED, with operational audit metadata only", async () => {
    const { orderId } = await reserveOrder();
    await ds
      .getRepository(Order)
      .update(orderId, { status: OrderStatus.PAID, paidAt: new Date() });
    const ready = await request(app.getHttpServer())
      .patch(`/api/v1/admin/orders/${orderId}/fulfillment`)
      .set(headers())
      .send({ status: "READY_FOR_PICKUP", adminNote: "  Ready at reception  " })
      .expect(200);
    expect(ready.body).toMatchObject({
      status: "READY_FOR_PICKUP",
      adminNote: "Ready at reception",
      readyAt: expect.any(String),
      completedAt: null,
    });
    const completed = await request(app.getHttpServer())
      .patch(`/api/v1/admin/orders/${orderId}/fulfillment`)
      .set(headers())
      .send({ status: "COMPLETED", adminNote: "Collected" })
      .expect(200);
    expect(completed.body).toMatchObject({
      status: "COMPLETED",
      adminNote: "Collected",
      readyAt: expect.any(String),
      completedAt: expect.any(String),
    });
    const audit = await ds
      .getRepository(AdminAuditLog)
      .findBy({ action: "FULFILLMENT_STATUS_CHANGED" });
    expect(audit).toHaveLength(2);
    for (const entry of audit) {
      expect(entry.metadata).toEqual(
        expect.objectContaining({
          orderId,
          fulfillmentId: expect.any(String),
          previousStatus: expect.any(String),
          newStatus: expect.any(String),
        }),
      );
      const serialized = JSON.stringify(entry.metadata);
      for (const pii of [
        "Test Buyer",
        "buyer@example.com",
        "2491234567",
        "Customer note",
        "Ready at reception",
        "Collected",
      ]) {
        expect(serialized).not.toContain(pii);
      }
    }
  });

  it("rejects invalid transitions and refuses mutations of refunded or historical orders", async () => {
    const { orderId } = await reserveOrder();
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/orders/${orderId}/fulfillment`)
      .set(headers())
      .send({ status: "COMPLETED" })
      .expect(409);
    await ds
      .getRepository(Order)
      .update(orderId, { status: OrderStatus.PAID, paidAt: new Date() });
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/orders/${orderId}/fulfillment`)
      .set(headers())
      .send({ status: "READY_FOR_PICKUP" })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/orders/${orderId}/fulfillment`)
      .set(headers())
      .send({ status: "COMPLETED" })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/orders/${orderId}/fulfillment`)
      .set(headers())
      .send({ status: "READY_FOR_PICKUP" })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/orders/${orderId}/fulfillment`)
      .set(headers())
      .send({ status: "PENDING" })
      .expect(409);

    await ds
      .getRepository(Order)
      .update(orderId, { status: OrderStatus.REFUNDED });
    const refunded = await request(app.getHttpServer())
      .patch(`/api/v1/admin/orders/${orderId}/fulfillment`)
      .set(headers())
      .send({ status: "COMPLETED" })
      .expect(409);
    expect(refunded.body).toMatchObject({ code: "FULFILLMENT_NOT_ALLOWED" });

    const historical = await historicalOrder();
    const missing = await request(app.getHttpServer())
      .patch(`/api/v1/admin/orders/${historical.id}/fulfillment`)
      .set(headers())
      .send({ status: "READY_FOR_PICKUP" })
      .expect(404);
    expect(missing.body).toMatchObject({ code: "FULFILLMENT_NOT_FOUND" });
  });
});
