import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");
import { DataSource } from "typeorm";
import { AppModule } from "../src/app.module";
import { Inventory } from "../src/inventory/entities/inventory.entity";
import {
  InventoryMovement,
  InventoryMovementType,
} from "../src/inventory/entities/inventory-movement.entity";
import { OrdersService } from "../src/orders/orders.service";
import { Order, OrderStatus } from "../src/orders/entities/order.entity";
import {
  Payment,
  PaymentProcessingStatus,
} from "../src/payments/entities/payment.entity";
import { PaymentsService } from "../src/payments/payments.service";
import { MERCADO_PAGO_GATEWAY } from "../src/payments/mercado-pago.gateway";
import { ProductVariant } from "../src/products/entities/product-variant.entity";
import { Product } from "../src/products/entities/product.entity";

describe("checkout reservations (PostgreSQL)", () => {
  const reservePayload = (
    items: { variantId: string; quantity: number }[],
  ) => ({
    items,
    customer: {
      name: "Test Buyer",
      email: "buyer@example.com",
      phone: "2491234567",
    },
    fulfillment: { method: "PICKUP", note: null },
  });
  let app: INestApplication;
  let dataSource: DataSource;
  let ordersService: OrdersService;
  let paymentsService: PaymentsService;
  beforeAll(async () => {
    process.env.DATABASE_NAME ??= "gatarsis_test";
    process.env.MP_ENABLED = "true";
    process.env.MP_ACCESS_TOKEN = "test-token";
    process.env.MP_WEBHOOK_SECRET = "test-secret";
    process.env.MP_FRONTEND_BASE_URL = "https://frontend.test";
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MERCADO_PAGO_GATEWAY)
      .useValue({
        createPreference: jest.fn(async () => ({
          id: "pref-1",
          init_point: "https://mp.test/pref-1",
        })),
        searchPreferencesByExternalReference: jest.fn(async () => []),
        getPayment: jest.fn(),
        searchPaymentsByExternalReference: jest.fn(async () => []),
        validateWebhookSignature: jest.fn(),
      })
      .compile();
    app = module.createNestApplication();
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
    ordersService = app.get(OrdersService);
    paymentsService = app.get(PaymentsService);
    await dataSource.runMigrations();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await dataSource.query(
      "TRUNCATE inventory_movements, order_items, orders, inventory, product_variants, products RESTART IDENTITY CASCADE",
    );
  });
  async function variant(stock: number, suffix = "A") {
    const product = await dataSource.getRepository(Product).save({
      slug: `test-${suffix}-${crypto.randomUUID()}`,
      name: "Test product",
      active: true,
    });
    const value = await dataSource.getRepository(ProductVariant).save({
      productId: product.id,
      sku: `SKU-${suffix}-${crypto.randomUUID()}`,
      name: "Test variant",
      priceInCents: 1000,
      active: true,
      color: null,
      size: null,
    });
    await dataSource
      .getRepository(Inventory)
      .save({ variantId: value.id, stockOnHand: stock, reservedStock: 0 });
    return value;
  }
  it("reserves at most one unit with 20 concurrent requests", async () => {
    const v = await variant(1);
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        request(app.getHttpServer())
          .post("/api/v1/checkout/reserve")
          .set("Idempotency-Key", `concurrent-${index}`)
          .send(reservePayload([{ variantId: v.id, quantity: 1 }])),
      ),
    );
    expect(
      responses.filter((response) => response.status === 201),
    ).toHaveLength(1);
    expect(
      responses.filter(
        (response) =>
          response.status === 409 && response.body.code === "OUT_OF_STOCK",
      ),
    ).toHaveLength(19);
    expect(
      await dataSource
        .getRepository(Inventory)
        .findOneByOrFail({ variantId: v.id }),
    ).toMatchObject({ stockOnHand: 1, reservedStock: 1 });
  });
  it("reserves exactly ten units with 20 concurrent requests when stock is ten", async () => {
    const v = await variant(10);
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        request(app.getHttpServer())
          .post("/api/v1/checkout/reserve")
          .set("Idempotency-Key", `concurrent-ten-${index}`)
          .send(reservePayload([{ variantId: v.id, quantity: 1 }])),
      ),
    );
    expect(
      responses.filter((response) => response.status === 201),
    ).toHaveLength(10);
    expect(
      responses.filter(
        (response) =>
          response.status === 409 && response.body.code === "OUT_OF_STOCK",
      ),
    ).toHaveLength(10);
    expect(
      await dataSource
        .getRepository(Inventory)
        .findOneByOrFail({ variantId: v.id }),
    ).toMatchObject({ stockOnHand: 10, reservedStock: 10 });
  });
  it("is all-or-nothing for a multi-item cart", async () => {
    const available = await variant(1, "available");
    const out = await variant(0, "out");
    await request(app.getHttpServer())
      .post("/api/v1/checkout/reserve")
      .set("Idempotency-Key", "multi-item")
      .send(
        reservePayload([
          { variantId: available.id, quantity: 1 },
          { variantId: out.id, quantity: 1 },
        ]),
      )
      .expect(409);
    expect(
      (
        await dataSource
          .getRepository(Inventory)
          .findOneByOrFail({ variantId: available.id })
      ).reservedStock,
    ).toBe(0);
  });
  it("does not reserve stock twice for concurrent equal idempotency keys", async () => {
    const v = await variant(2);
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post("/api/v1/checkout/reserve")
          .set("Idempotency-Key", "same-key")
          .send(reservePayload([{ variantId: v.id, quantity: 1 }])),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(
      (
        await dataSource
          .getRepository(Inventory)
          .findOneByOrFail({ variantId: v.id })
      ).reservedStock,
    ).toBe(1);
  });
  it("releases an expired reservation exactly once when expiration runs repeatedly", async () => {
    const v = await variant(1);
    const reservation = await request(app.getHttpServer())
      .post("/api/v1/checkout/reserve")
      .set("Idempotency-Key", "expires-once")
      .send(reservePayload([{ variantId: v.id, quantity: 1 }]))
      .expect(201);
    const orderId = reservation.body.orderId as string;
    const expiredAt = new Date(Date.now() - 1_000);
    await dataSource
      .getRepository(Order)
      .update(orderId, { reservationExpiresAt: expiredAt });

    expect(await ordersService.expireReservations(new Date())).toBe(1);
    expect(
      (
        await dataSource
          .getRepository(Inventory)
          .findOneByOrFail({ variantId: v.id })
      ).reservedStock,
    ).toBe(0);
    expect(await ordersService.expireReservations(new Date())).toBe(0);
    expect(
      (
        await dataSource
          .getRepository(Inventory)
          .findOneByOrFail({ variantId: v.id })
      ).reservedStock,
    ).toBe(0);
    expect(
      await dataSource
        .getRepository(InventoryMovement)
        .countBy({ orderId, type: InventoryMovementType.RELEASE }),
    ).toBe(1);
  });
  it("applies an approved provider payment exactly once", async () => {
    const v = await variant(2);
    const reservation = await request(app.getHttpServer())
      .post("/api/v1/checkout/reserve")
      .set("Idempotency-Key", "approved-once")
      .send(reservePayload([{ variantId: v.id, quantity: 2 }]))
      .expect(201);
    const payment = {
      id: "payment-approved-once",
      status: "approved",
      transaction_amount: 20,
      currency_id: "ARS",
      external_reference: reservation.body.orderId,
    };
    await paymentsService.recordAndApply(payment);
    await paymentsService.recordAndApply(payment);
    expect(
      await dataSource
        .getRepository(Inventory)
        .findOneByOrFail({ variantId: v.id }),
    ).toMatchObject({ stockOnHand: 0, reservedStock: 0 });
    expect(
      await dataSource
        .getRepository(Order)
        .findOneByOrFail({ id: reservation.body.orderId }),
    ).toMatchObject({ status: OrderStatus.PAID });
    expect(
      await dataSource
        .getRepository(Payment)
        .findOneByOrFail({ providerPaymentId: payment.id }),
    ).toMatchObject({ processingStatus: PaymentProcessingStatus.APPLIED });
    expect(
      await dataSource
        .getRepository(InventoryMovement)
        .countBy({
          orderId: reservation.body.orderId,
          type: InventoryMovementType.SALE,
        }),
    ).toBe(1);
  });
  it("rejects a non-UUID order status path parameter before PostgreSQL", async () => {
    const response = await request(app.getHttpServer())
      .get(
        "/api/v1/orders/2252402486-d5a1db43-2ed9-498e-805f-a66c1726e88b/status",
      )
      .expect(400);
    expect(response.body.message).toContain("uuid");
  });
  it("returns 404 for a well-formed but unknown order UUID", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/orders/00000000-0000-4000-8000-000000000000/status")
      .expect(404);
    expect(response.body.code).toBe("ORDER_NOT_FOUND");
  });
});
