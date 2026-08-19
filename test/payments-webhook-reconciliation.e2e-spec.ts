import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");
import { DataSource } from "typeorm";
import { AppModule } from "../src/app.module";
import { Inventory } from "../src/inventory/entities/inventory.entity";
import { InventoryMovement, InventoryMovementType } from "../src/inventory/entities/inventory-movement.entity";
import { Order, OrderStatus } from "../src/orders/entities/order.entity";
import { PaymentPreference, PaymentPreferenceStatus } from "../src/payments/entities/payment-preference.entity";
import { Payment, PaymentProcessingStatus } from "../src/payments/entities/payment.entity";
import { MERCADO_PAGO_GATEWAY, MercadoPagoPayment } from "../src/payments/mercado-pago.gateway";
import { PaymentsService } from "../src/payments/payments.service";
import { Product } from "../src/products/entities/product.entity";
import { ProductVariant } from "../src/products/entities/product-variant.entity";

describe("payments webhook and early reconciliation (PostgreSQL)", () => {
  let app: INestApplication, ds: DataSource, payments: PaymentsService;
  const remoteById = new Map<string, MercadoPagoPayment>();
  const search = jest.fn<Promise<MercadoPagoPayment[]>, [string]>();
  const getPayment = jest.fn<Promise<MercadoPagoPayment>, [string]>();

  beforeAll(async () => {
    process.env.DATABASE_NAME ??= "gatarsis_test";
    process.env.MP_ENABLED = "true";
    process.env.MP_ACCESS_TOKEN = "test-token";
    process.env.MP_WEBHOOK_SECRET = "test-secret";
    process.env.MP_FRONTEND_BASE_URL = "https://frontend.test";
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MERCADO_PAGO_GATEWAY)
      .useValue({
        createPreference: jest.fn(),
        searchPreferencesByExternalReference: jest.fn(),
        getPayment,
        searchPaymentsByExternalReference: search,
        validateWebhookSignature: jest.fn(),
        refundPayment: jest.fn(),
        listRefunds: jest.fn(),
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    ds = app.get(DataSource);
    payments = app.get(PaymentsService);
    await ds.runMigrations();
  });
  afterAll(async () => app.close());
  beforeEach(async () => {
    await ds.query("TRUNCATE webhook_events, inventory_movements, payments, payment_preferences, order_fulfillments, order_items, orders, inventory, product_variants, products RESTART IDENTITY CASCADE");
    remoteById.clear(); search.mockReset(); getPayment.mockReset();
    getPayment.mockImplementation(async (id) => {
      const payment = remoteById.get(id);
      if (!payment) throw new Error("PAYMENT_NOT_FOUND");
      return payment;
    });
    search.mockResolvedValue([]);
  });

  async function reservedOrder() {
    const p = await ds.getRepository(Product).save({ name: "P", slug: crypto.randomUUID(), active: true, sortOrder: 0 });
    const v = await ds.getRepository(ProductVariant).save({ productId: p.id, sku: crypto.randomUUID(), name: "V", color: null, size: null, priceInCents: 1000, active: true, sortOrder: 0, lowStockThreshold: null });
    await ds.getRepository(Inventory).save({ variantId: v.id, stockOnHand: 1, reservedStock: 1 });
    const order = await ds.getRepository(Order).save({ status: OrderStatus.AWAITING_PAYMENT, idempotencyKey: crypto.randomUUID(), requestFingerprint: null, subtotalInCents: 1000, totalInCents: 1000, reservationExpiresAt: new Date(Date.now() + 10 * 60_000), paidAt: null });
    await ds.query("INSERT INTO order_items (order_id, variant_id, product_name_snapshot, variant_name_snapshot, sku_snapshot, unit_price_in_cents, quantity, line_total_in_cents) VALUES ($1,$2,'P','V','SKU',1000,1,1000)", [order.id, v.id]);
    await ds.getRepository(PaymentPreference).save({ orderId: order.id, provider: "mercado_pago", providerPreferenceId: `pref-${order.id}`, status: PaymentPreferenceStatus.READY, initPoint: "https://mp.test", lastErrorCode: null, lastErrorAt: null, readyAt: new Date(), lastReconciliationAt: null });
    await ds.query("UPDATE orders SET created_at = $1 WHERE id = $2", [new Date(Date.now() - 120_000), order.id]);
    return { order, v };
  }
  const approved = (orderId: string, id = `pay-${crypto.randomUUID()}`): MercadoPagoPayment => ({ id, status: "approved", transaction_amount: 10, currency_id: "ARS", external_reference: orderId });
  const pending = (orderId: string): MercadoPagoPayment => ({ id: `pay-${crypto.randomUUID()}`, status: "pending", transaction_amount: 10, currency_id: "ARS", external_reference: orderId });
  async function expectSale(orderId: string, variantId: string) {
    expect(await ds.getRepository(Order).findOneByOrFail({ id: orderId })).toMatchObject({ status: OrderStatus.PAID });
    expect(await ds.getRepository(Inventory).findOneByOrFail({ variantId })).toMatchObject({ stockOnHand: 0, reservedStock: 0 });
    expect(await ds.getRepository(InventoryMovement).countBy({ orderId, type: InventoryMovementType.SALE })).toBe(1);
  }

  it("applies an approved payment from the webhook without waiting for a scheduler", async () => {
    const { order, v } = await reservedOrder(); const payment = approved(order.id, "174643820870"); remoteById.set(payment.id, payment);
    await request(app.getHttpServer()).post(`/api/v1/webhooks/mercado-pago?data.id=${payment.id}`).set("x-signature", "test").set("x-request-id", "request-1").send({ id: "event-1", type: "payment", action: "payment.updated" }).expect(200);
    await expectSale(order.id, v.id);
  });

  it("converges an approved payment through early reconciliation when webhook processing did not converge", async () => {
    const { order, v } = await reservedOrder(); const payment = approved(order.id); search.mockResolvedValue([payment]);
    getPayment.mockRejectedValueOnce(new Error("UPSTREAM_TIMEOUT"));
    await request(app.getHttpServer()).post(`/api/v1/webhooks/mercado-pago?data.id=${payment.id}`).set("x-signature", "test").set("x-request-id", "request-2").send({ id: "event-2", type: "payment" }).expect(200);
    expect((await ds.getRepository(Order).findOneByOrFail({ id: order.id })).status).toBe(OrderStatus.AWAITING_PAYMENT);
    await payments.earlyReconcilePendingOrders();
    await expectSale(order.id, v.id);
  });

  it.each([
    ["pending provider payment", async (orderId: string) => [pending(orderId)], OrderStatus.PAYMENT_PENDING],
    ["no provider payment", async (_orderId: string) => [], OrderStatus.AWAITING_PAYMENT],
  ])("keeps the reservation for %s", async (_name, result, expectedStatus) => {
    const { order, v } = await reservedOrder(); search.mockImplementation(result);
    await payments.earlyReconcilePendingOrders();
    expect((await ds.getRepository(Order).findOneByOrFail({ id: order.id })).status).toBe(expectedStatus);
    expect(await ds.getRepository(Inventory).findOneByOrFail({ variantId: v.id })).toMatchObject({ stockOnHand: 1, reservedStock: 1 });
    expect(await ds.getRepository(InventoryMovement).countBy({ orderId: order.id, type: InventoryMovementType.SALE })).toBe(0);
  });

  it("fails closed when Mercado Pago is unavailable", async () => {
    const { order, v } = await reservedOrder(); search.mockRejectedValue(new Error("UPSTREAM_UNAVAILABLE"));
    await payments.earlyReconcilePendingOrders();
    expect((await ds.getRepository(Order).findOneByOrFail({ id: order.id })).status).toBe(OrderStatus.AWAITING_PAYMENT);
    expect(await ds.getRepository(Inventory).findOneByOrFail({ variantId: v.id })).toMatchObject({ stockOnHand: 1, reservedStock: 1 });
  });

  it("serializes duplicate webhook and early reconciliation to exactly one sale and makes paid reconciliation a no-op", async () => {
    const { order, v } = await reservedOrder(); const payment = approved(order.id); remoteById.set(payment.id, payment); search.mockResolvedValue([payment]);
    await Promise.all([
      request(app.getHttpServer()).post(`/api/v1/webhooks/mercado-pago?data.id=${payment.id}`).set("x-signature", "test").set("x-request-id", "request-3").send({ id: "event-3", type: "payment" }),
      payments.earlyReconcilePendingOrders(),
    ]);
    await expectSale(order.id, v.id);
    const calls = search.mock.calls.length;
    await payments.earlyReconcilePendingOrders();
    expect(search).toHaveBeenCalledTimes(calls);
  });

  it("keeps the fifteen-minute expiration path as the final fallback", async () => {
    const { order, v } = await reservedOrder();
    await ds.getRepository(Order).update(order.id, { reservationExpiresAt: new Date(Date.now() - 3 * 60_000) });
    await payments.reconcileExpiredReservations();
    expect((await ds.getRepository(Order).findOneByOrFail({ id: order.id })).status).toBe(OrderStatus.EXPIRED);
    expect(await ds.getRepository(Inventory).findOneByOrFail({ variantId: v.id })).toMatchObject({ stockOnHand: 1, reservedStock: 0 });
  });
});
