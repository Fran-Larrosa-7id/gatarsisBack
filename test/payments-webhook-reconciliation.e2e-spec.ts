import { INestApplication, Logger, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");
import { DataSource } from "typeorm";
import { AppModule } from "../src/app.module";
import { Inventory } from "../src/inventory/entities/inventory.entity";
import {
  InventoryMovement,
  InventoryMovementType,
} from "../src/inventory/entities/inventory-movement.entity";
import { Order, OrderStatus } from "../src/orders/entities/order.entity";
import {
  PaymentPreference,
  PaymentPreferenceStatus,
} from "../src/payments/entities/payment-preference.entity";
import {
  Payment,
  PaymentProcessingStatus,
} from "../src/payments/entities/payment.entity";
import {
  MERCADO_PAGO_GATEWAY,
  MercadoPagoPayment,
} from "../src/payments/mercado-pago.gateway";
import { PaymentsService } from "../src/payments/payments.service";
import {
  WebhookEvent,
  WebhookEventStatus,
} from "../src/payments/entities/webhook-event.entity";
import { Product } from "../src/products/entities/product.entity";
import { ProductVariant } from "../src/products/entities/product-variant.entity";

describe("payments webhook and early reconciliation (PostgreSQL)", () => {
  let app: INestApplication, ds: DataSource, payments: PaymentsService;
  const remoteById = new Map<string, MercadoPagoPayment>();
  const search = jest.fn<Promise<MercadoPagoPayment[]>, [string]>();
  const getPayment = jest.fn<Promise<MercadoPagoPayment>, [string]>();
  const createPreference = jest.fn<
    Promise<{ id: string; init_point: string }>,
    [Record<string, unknown>]
  >();
  const searchPreferences = jest.fn<
    Promise<{ id: string; init_point: string }[]>,
    [string]
  >();

  beforeAll(async () => {
    process.env.DATABASE_NAME ??= "gatarsis_test";
    process.env.MP_ENABLED = "true";
    process.env.MP_ACCESS_TOKEN = "test-token";
    process.env.MP_WEBHOOK_SECRET = "test-secret";
    process.env.FRONTEND_URL = "https://gatarsis.com.ar/";
    process.env.MP_PENDING_REVIEW_HOURS = "1";
    process.env.MP_PREFERENCE_CREATING_STALE_SECONDS = "60";
    process.env.MP_PREFERENCE_RECOVERY_CONFIRM_SECONDS = "30";
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MERCADO_PAGO_GATEWAY)
      .useValue({
        createPreference,
        searchPreferencesByExternalReference: searchPreferences,
        getPayment,
        searchPaymentsByExternalReference: search,
        validateWebhookSignature: jest.fn(),
        refundPayment: jest.fn(),
        listRefunds: jest.fn(),
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
    ds = app.get(DataSource);
    payments = app.get(PaymentsService);
    await ds.runMigrations();
  });
  afterAll(async () => app.close());
  beforeEach(async () => {
    await ds.query(
      "TRUNCATE webhook_events, inventory_movements, payments, payment_preferences, order_fulfillments, order_items, orders, inventory, product_variants, products RESTART IDENTITY CASCADE",
    );
    remoteById.clear();
    search.mockReset();
    getPayment.mockReset();
    createPreference.mockReset();
    searchPreferences.mockReset();
    getPayment.mockImplementation(async (id) => {
      const payment = remoteById.get(id);
      if (!payment) throw new Error("PAYMENT_NOT_FOUND");
      return payment;
    });
    search.mockResolvedValue([]);
    createPreference.mockResolvedValue({
      id: "created-preference",
      init_point: "https://mp.test/created-preference",
    });
    searchPreferences.mockResolvedValue([]);
  });

  async function reservedOrder() {
    const p = await ds.getRepository(Product).save({
      name: "P",
      slug: crypto.randomUUID(),
      active: true,
      sortOrder: 0,
    });
    const v = await ds.getRepository(ProductVariant).save({
      productId: p.id,
      sku: crypto.randomUUID(),
      name: "V",
      color: null,
      size: null,
      priceInCents: 1000,
      active: true,
      sortOrder: 0,
      lowStockThreshold: null,
    });
    await ds
      .getRepository(Inventory)
      .save({ variantId: v.id, stockOnHand: 1, reservedStock: 1 });
    const order = await ds.getRepository(Order).save({
      status: OrderStatus.AWAITING_PAYMENT,
      idempotencyKey: crypto.randomUUID(),
      requestFingerprint: null,
      subtotalInCents: 1000,
      totalInCents: 1000,
      reservationExpiresAt: new Date(Date.now() + 10 * 60_000),
      paidAt: null,
    });
    await ds.query(
      "INSERT INTO order_items (order_id, variant_id, product_name_snapshot, variant_name_snapshot, sku_snapshot, unit_price_in_cents, quantity, line_total_in_cents) VALUES ($1,$2,'P','V','SKU',1000,1,1000)",
      [order.id, v.id],
    );
    await ds.getRepository(PaymentPreference).save({
      orderId: order.id,
      provider: "mercado_pago",
      providerPreferenceId: `pref-${order.id}`,
      status: PaymentPreferenceStatus.READY,
      initPoint: "https://mp.test",
      lastErrorCode: null,
      lastErrorAt: null,
      readyAt: new Date(),
      lastReconciliationAt: null,
    });
    await ds.query("UPDATE orders SET created_at = $1 WHERE id = $2", [
      new Date(Date.now() - 120_000),
      order.id,
    ]);
    return { order, v };
  }
  const approved = (
    orderId: string,
    id = `pay-${crypto.randomUUID()}`,
  ): MercadoPagoPayment => ({
    id,
    status: "approved",
    transaction_amount: 10,
    currency_id: "ARS",
    external_reference: orderId,
  });
  const pending = (
    orderId: string,
    id = `pay-${crypto.randomUUID()}`,
  ): MercadoPagoPayment => ({
    id,
    status: "pending",
    transaction_amount: 10,
    currency_id: "ARS",
    external_reference: orderId,
  });
  async function expectSale(orderId: string, variantId: string) {
    expect(
      await ds.getRepository(Order).findOneByOrFail({ id: orderId }),
    ).toMatchObject({ status: OrderStatus.PAID });
    expect(
      await ds.getRepository(Inventory).findOneByOrFail({ variantId }),
    ).toMatchObject({ stockOnHand: 0, reservedStock: 0 });
    expect(
      await ds
        .getRepository(InventoryMovement)
        .countBy({ orderId, type: InventoryMovementType.SALE }),
    ).toBe(1);
  }

  async function expirePendingOrder(orderId: string, ageMs: number) {
    await ds.getRepository(Order).update(orderId, {
      status: OrderStatus.PAYMENT_PENDING,
      reservationExpiresAt: new Date(Date.now() - ageMs),
    });
  }

  async function expectReleased(orderId: string, variantId: string) {
    expect(
      await ds.getRepository(Order).findOneByOrFail({ id: orderId }),
    ).toMatchObject({ status: OrderStatus.EXPIRED });
    expect(
      await ds.getRepository(Inventory).findOneByOrFail({ variantId }),
    ).toMatchObject({ stockOnHand: 1, reservedStock: 0 });
    expect(
      await ds
        .getRepository(InventoryMovement)
        .countBy({ orderId, type: InventoryMovementType.RELEASE }),
    ).toBe(1);
    expect(
      await ds
        .getRepository(InventoryMovement)
        .countBy({ orderId, type: InventoryMovementType.SALE }),
    ).toBe(0);
  }

  async function orderWithoutPreference() {
    const fixture = await reservedOrder();
    await ds
      .getRepository(PaymentPreference)
      .delete({ orderId: fixture.order.id });
    return fixture;
  }

  it("applies an approved payment from the webhook without waiting for a scheduler", async () => {
    const { order, v } = await reservedOrder();
    const payment = approved(order.id, "174643820870");
    remoteById.set(payment.id, payment);
    await request(app.getHttpServer())
      .post(`/api/v1/webhooks/mercado-pago?data.id=${payment.id}`)
      .set("x-signature", "test")
      .set("x-request-id", "request-1")
      .send({
        id: "event-1",
        type: "payment",
        action: "payment.updated",
        data: { id: payment.id },
      })
      .expect(200);
    await expectSale(order.id, v.id);
    expect(getPayment).toHaveBeenCalledTimes(1);
    expect(
      await ds
        .getRepository(Payment)
        .findOneBy({ provider: "mercado_pago", providerPaymentId: payment.id }),
    ).toEqual(
      expect.objectContaining({
        processingStatus: PaymentProcessingStatus.APPLIED,
      }),
    );
    expect(
      await ds
        .getRepository(WebhookEvent)
        .findOneByOrFail({ providerEventId: "event-1" }),
    ).toEqual(
      expect.objectContaining({ status: WebhookEventStatus.PROCESSED }),
    );
  });

  it("logs a sanitized diagnostic that identifies the webhook URL and TEST event", async () => {
    const { order, v } = await reservedOrder();
    const payment = approved(order.id, "diagnostic-test-payment");
    remoteById.set(payment.id, payment);
    const log = jest.spyOn(Logger.prototype, "log").mockImplementation();
    try {
      await request(app.getHttpServer())
        .post(
          `/api/v1/webhooks/mercado-pago?env=test&type=payment&data.id=${payment.id}&access_token=must-not-be-logged`,
        )
        .set("x-signature", "test")
        .set("x-request-id", "diagnostic-request")
        .set("user-agent", "MercadoPago-Test")
        .send({
          id: "diagnostic-event",
          type: "payment",
          action: "payment.updated",
          live_mode: false,
          data: { id: payment.id },
        })
        .expect(200);
      const diagnostic = log.mock.calls
        .map(([message]) => message)
        .find(
          (message) =>
            typeof message === "object" &&
            message !== null &&
            (message as { step?: string }).step ===
              "webhook_request_diagnostic",
        );
      expect(diagnostic).toMatchObject({
        webhookEnvironment: "test",
        requestUrl: `/api/v1/webhooks/mercado-pago?env=test&type=payment&data.id=${payment.id}`,
        eventType: "payment",
        action: "payment.updated",
        liveMode: false,
        providerPaymentId: payment.id,
        hasXSignature: true,
        hasXRequestId: true,
        userAgent: "MercadoPago-Test",
      });
      expect(JSON.stringify(diagnostic)).not.toContain("must-not-be-logged");
    } finally {
      log.mockRestore();
    }
    await expectSale(order.id, v.id);
  });

  it.each(["pending", "in_process", "rejected"])(
    "does not downgrade a PAID/APPLIED payment after a late %s provider update",
    async (lateStatus) => {
      const { order, v } = await reservedOrder();
      const paymentId = `terminal-${lateStatus}`;
      await payments.recordAndApply(approved(order.id, paymentId));
      await payments.recordAndApply({
        ...approved(order.id, paymentId),
        status: lateStatus,
      });
      await payments.recordAndApply(approved(order.id, paymentId));
      expect(
        await ds.getRepository(Order).findOneByOrFail({ id: order.id }),
      ).toMatchObject({ status: OrderStatus.PAID });
      expect(
        await ds
          .getRepository(Payment)
          .findOneByOrFail({ providerPaymentId: paymentId }),
      ).toMatchObject({ processingStatus: PaymentProcessingStatus.APPLIED });
      expect(
        await ds
          .getRepository(InventoryMovement)
          .countBy({ orderId: order.id, type: InventoryMovementType.SALE }),
      ).toBe(1);
      expect(
        await ds.getRepository(Inventory).findOneByOrFail({ variantId: v.id }),
      ).toMatchObject({ stockOnHand: 0, reservedStock: 0 });
    },
  );

  it("never transfers provider payment ownership to another order", async () => {
    const first = await reservedOrder();
    const second = await reservedOrder();
    const paymentId = "ownership-fixed";
    await payments.recordAndApply(approved(first.order.id, paymentId));
    await payments.recordAndApply(approved(second.order.id, paymentId));
    expect(
      await ds
        .getRepository(Payment)
        .findOneByOrFail({ providerPaymentId: paymentId }),
    ).toMatchObject({
      orderId: first.order.id,
      processingStatus: PaymentProcessingStatus.APPLIED,
    });
    expect(
      await ds.getRepository(Order).findOneByOrFail({ id: second.order.id }),
    ).toMatchObject({ status: OrderStatus.AWAITING_PAYMENT });
    expect(
      await ds.getRepository(InventoryMovement).countBy({
        orderId: second.order.id,
        type: InventoryMovementType.SALE,
      }),
    ).toBe(0);
  });

  it("repairs a duplicate inbox event whose resource was incorrectly stored as the notification id", async () => {
    const { order, v } = await reservedOrder();
    const payment = approved(order.id, "173744188557");
    const notificationId = "notification-123456";
    remoteById.set(payment.id, payment);
    await ds.getRepository(WebhookEvent).save({
      provider: "mercado_pago",
      providerEventId: notificationId,
      providerResourceId: notificationId,
      type: "payment",
      action: "payment.updated",
      requestId: "old-request",
      status: WebhookEventStatus.RETRY,
      attempts: 1,
      nextAttemptAt: new Date(),
      lastError: "old lookup",
      payload: {
        id: notificationId,
        type: "payment",
        data: { id: payment.id },
      },
      receivedAt: new Date(),
      processedAt: null,
    });
    await request(app.getHttpServer())
      .post(`/api/v1/webhooks/mercado-pago?data.id=${payment.id}`)
      .set("x-signature", "test")
      .set("x-request-id", "request-retry")
      .send({ id: notificationId, type: "payment", data: { id: payment.id } })
      .expect(200);
    expect(getPayment).toHaveBeenCalledTimes(1);
    expect(getPayment).toHaveBeenCalledWith(payment.id);
    await expectSale(order.id, v.id);
    expect(
      await ds
        .getRepository(WebhookEvent)
        .findOneByOrFail({ providerEventId: notificationId }),
    ).toEqual(
      expect.objectContaining({
        providerResourceId: payment.id,
        status: WebhookEventStatus.PROCESSED,
      }),
    );
  });

  it("rejects a payment webhook when query data.id and body.data.id differ", async () => {
    const { order } = await reservedOrder();
    const payment = approved(order.id, "provider-payment-id");
    remoteById.set(payment.id, payment);
    await request(app.getHttpServer())
      .post(`/api/v1/webhooks/mercado-pago?data.id=${payment.id}`)
      .set("x-signature", "test")
      .set("x-request-id", "request-mismatch")
      .send({
        id: "notification-mismatch",
        type: "payment",
        data: { id: "other-payment-id" },
      })
      .expect(400)
      .expect(({ body }) =>
        expect(body.code).toBe("WEBHOOK_RESOURCE_ID_MISMATCH"),
      );
    expect(getPayment).not.toHaveBeenCalled();
    expect(await ds.getRepository(WebhookEvent).count()).toBe(0);
  });

  it("converges an approved payment through early reconciliation when webhook processing did not converge", async () => {
    const { order, v } = await reservedOrder();
    const payment = approved(order.id);
    search.mockResolvedValue([payment]);
    getPayment.mockRejectedValueOnce(new Error("UPSTREAM_TIMEOUT"));
    await request(app.getHttpServer())
      .post(`/api/v1/webhooks/mercado-pago?data.id=${payment.id}`)
      .set("x-signature", "test")
      .set("x-request-id", "request-2")
      .send({ id: "event-2", type: "payment", data: { id: payment.id } })
      .expect(200);
    expect(
      (await ds.getRepository(Order).findOneByOrFail({ id: order.id })).status,
    ).toBe(OrderStatus.AWAITING_PAYMENT);
    await payments.earlyReconcilePendingOrders();
    await expectSale(order.id, v.id);
  });

  it.each([
    [
      "pending provider payment",
      async (orderId: string) => [pending(orderId)],
      OrderStatus.PAYMENT_PENDING,
    ],
    [
      "no provider payment",
      async (_orderId: string) => [],
      OrderStatus.AWAITING_PAYMENT,
    ],
  ])("keeps the reservation for %s", async (_name, result, expectedStatus) => {
    const { order, v } = await reservedOrder();
    search.mockImplementation(result);
    await payments.earlyReconcilePendingOrders();
    expect(
      (await ds.getRepository(Order).findOneByOrFail({ id: order.id })).status,
    ).toBe(expectedStatus);
    expect(
      await ds.getRepository(Inventory).findOneByOrFail({ variantId: v.id }),
    ).toMatchObject({ stockOnHand: 1, reservedStock: 1 });
    expect(
      await ds
        .getRepository(InventoryMovement)
        .countBy({ orderId: order.id, type: InventoryMovementType.SALE }),
    ).toBe(0);
  });

  it("fails closed when Mercado Pago is unavailable", async () => {
    const { order, v } = await reservedOrder();
    search.mockRejectedValue(new Error("UPSTREAM_UNAVAILABLE"));
    await payments.earlyReconcilePendingOrders();
    expect(
      (await ds.getRepository(Order).findOneByOrFail({ id: order.id })).status,
    ).toBe(OrderStatus.AWAITING_PAYMENT);
    expect(
      await ds.getRepository(Inventory).findOneByOrFail({ variantId: v.id }),
    ).toMatchObject({ stockOnHand: 1, reservedStock: 1 });
  });

  it("applies an approved payment for an expired PAYMENT_PENDING order exactly once", async () => {
    const { order, v } = await reservedOrder();
    await expirePendingOrder(order.id, 3 * 60_000);
    const payment = approved(order.id, "expired-pending-approved");
    search.mockResolvedValue([payment]);
    await payments.reconcileExpiredReservations();
    await payments.reconcileExpiredReservations();
    await expectSale(order.id, v.id);
    expect(
      await ds
        .getRepository(Payment)
        .findOneByOrFail({ providerPaymentId: payment.id }),
    ).toMatchObject({ processingStatus: PaymentProcessingStatus.APPLIED });
  });

  it.each(["rejected", "cancelled"])(
    "releases an expired PAYMENT_PENDING reservation after provider %s",
    async (providerStatus) => {
      const { order, v } = await reservedOrder();
      await expirePendingOrder(order.id, 3 * 60_000);
      search.mockResolvedValue([
        {
          ...approved(order.id, `terminal-${providerStatus}`),
          status: providerStatus,
        },
      ]);
      await payments.reconcileExpiredReservations();
      await payments.reconcileExpiredReservations();
      await expectReleased(order.id, v.id);
    },
  );

  it("releases an expired PAYMENT_PENDING reservation after a safe empty provider lookup", async () => {
    const { order, v } = await reservedOrder();
    const paymentId = "known-pending-empty-after-deadline";
    await payments.recordAndApply(pending(order.id, paymentId));
    await expirePendingOrder(order.id, 2 * 3_600_000);
    search.mockResolvedValue([]);
    await payments.reconcileExpiredReservations();
    await payments.reconcileExpiredReservations();
    await expectReleased(order.id, v.id);
    expect(
      await ds
        .getRepository(Payment)
        .findOneByOrFail({ providerPaymentId: paymentId }),
    ).toMatchObject({
      processingStatus: PaymentProcessingStatus.REQUIRES_REVIEW,
      reviewReason: "PENDING_REVIEW_DEADLINE_REACHED",
    });
  });

  it("keeps a known PAYMENT_PENDING reservation when an empty lookup occurs inside the review window", async () => {
    const { order, v } = await reservedOrder();
    await payments.recordAndApply(
      pending(order.id, "known-pending-empty-within-window"),
    );
    await expirePendingOrder(order.id, 3 * 60_000);
    search.mockResolvedValue([]);
    await payments.reconcileExpiredReservations();
    expect(
      await ds.getRepository(Order).findOneByOrFail({ id: order.id }),
    ).toMatchObject({ status: OrderStatus.PAYMENT_PENDING });
    expect(
      await ds.getRepository(Inventory).findOneByOrFail({ variantId: v.id }),
    ).toMatchObject({ stockOnHand: 1, reservedStock: 1 });
  });

  it("keeps expired PAYMENT_PENDING stock reserved while Mercado Pago is unavailable", async () => {
    const { order, v } = await reservedOrder();
    await payments.recordAndApply(
      pending(order.id, "known-pending-provider-unavailable"),
    );
    await expirePendingOrder(order.id, 2 * 3_600_000);
    search.mockRejectedValue(new Error("UPSTREAM_UNAVAILABLE"));
    await payments.reconcileExpiredReservations();
    expect(
      await ds.getRepository(Order).findOneByOrFail({ id: order.id }),
    ).toMatchObject({ status: OrderStatus.PAYMENT_PENDING });
    expect(
      await ds.getRepository(Inventory).findOneByOrFail({ variantId: v.id }),
    ).toMatchObject({ stockOnHand: 1, reservedStock: 1 });
  });

  it("keeps a provider-pending expired reservation during the bounded review window", async () => {
    const { order, v } = await reservedOrder();
    await expirePendingOrder(order.id, 3 * 60_000);
    search.mockResolvedValue([pending(order.id, "pending-inside-window")]);
    await payments.reconcileExpiredReservations();
    expect(
      await ds.getRepository(Order).findOneByOrFail({ id: order.id }),
    ).toMatchObject({ status: OrderStatus.PAYMENT_PENDING });
    expect(
      await ds.getRepository(Inventory).findOneByOrFail({ variantId: v.id }),
    ).toMatchObject({ stockOnHand: 1, reservedStock: 1 });
  });

  it("releases provider-pending stock after the review deadline and marks the payment for review", async () => {
    const { order, v } = await reservedOrder();
    const paymentId = "pending-after-deadline";
    await expirePendingOrder(order.id, 2 * 3_600_000);
    search.mockResolvedValue([pending(order.id, paymentId)]);
    await payments.reconcileExpiredReservations();
    await payments.reconcileExpiredReservations();
    await expectReleased(order.id, v.id);
    expect(
      await ds
        .getRepository(Payment)
        .findOneByOrFail({ providerPaymentId: paymentId }),
    ).toMatchObject({
      processingStatus: PaymentProcessingStatus.REQUIRES_REVIEW,
      reviewReason: "PENDING_REVIEW_DEADLINE_REACHED",
    });
  });

  it("sends an approved payment arriving after release to review without a SALE", async () => {
    const { order, v } = await reservedOrder();
    const paymentId = "approved-after-release";
    await expirePendingOrder(order.id, 2 * 3_600_000);
    search.mockResolvedValue([pending(order.id, paymentId)]);
    await payments.reconcileExpiredReservations();
    await payments.recordAndApply(approved(order.id, paymentId));
    await expectReleased(order.id, v.id);
    expect(
      await ds
        .getRepository(Payment)
        .findOneByOrFail({ providerPaymentId: paymentId }),
    ).toMatchObject({
      processingStatus: PaymentProcessingStatus.REQUIRES_REVIEW,
      reviewReason: "LATE_APPROVED_AFTER_RELEASE",
    });
  });

  it("serializes an expired-order cron with an approved webhook to one final SALE", async () => {
    const { order, v } = await reservedOrder();
    await expirePendingOrder(order.id, 3 * 60_000);
    const payment = approved(order.id, "cron-webhook-approved");
    search.mockResolvedValue([payment]);
    remoteById.set(payment.id, payment);
    await Promise.all([
      payments.reconcileExpiredReservations(),
      request(app.getHttpServer())
        .post(`/api/v1/webhooks/mercado-pago?data.id=${payment.id}`)
        .set("x-signature", "test")
        .set("x-request-id", "request-expired-concurrent")
        .send({
          id: "event-expired-concurrent",
          type: "payment",
          data: { id: payment.id },
        }),
    ]);
    await expectSale(order.id, v.id);
  });

  it("serializes duplicate webhook and early reconciliation to exactly one sale and makes paid reconciliation a no-op", async () => {
    const { order, v } = await reservedOrder();
    const payment = approved(order.id);
    remoteById.set(payment.id, payment);
    search.mockResolvedValue([payment]);
    await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/webhooks/mercado-pago?data.id=${payment.id}`)
        .set("x-signature", "test")
        .set("x-request-id", "request-3")
        .send({ id: "event-3", type: "payment", data: { id: payment.id } }),
      payments.earlyReconcilePendingOrders(),
    ]);
    await expectSale(order.id, v.id);
    const calls = search.mock.calls.length;
    await payments.earlyReconcilePendingOrders();
    expect(search).toHaveBeenCalledTimes(calls);
  });

  it("creates one Preference with the Gatarsis return URLs and no notification_url", async () => {
    const { order } = await orderWithoutPreference();
    const response = await request(app.getHttpServer())
      .post(`/api/v1/checkout/${order.id}/mercado-pago/preference`)
      .expect(201);
    expect(response.body.preferenceId).toBe("created-preference");
    expect(createPreference).toHaveBeenCalledTimes(1);
    expect(createPreference.mock.calls[0][0]).toMatchObject({
      external_reference: order.id,
      back_urls: {
        success: "https://gatarsis.com.ar/checkout/success",
        pending: "https://gatarsis.com.ar/checkout/pending",
        failure: "https://gatarsis.com.ar/checkout/failure",
      },
      auto_return: "approved",
    });
    expect(createPreference.mock.calls[0][0]).not.toHaveProperty(
      "notification_url",
    );
  });

  it("serializes concurrent Preference creation to one provider POST", async () => {
    const { order } = await orderWithoutPreference();
    const responses = await Promise.all([
      request(app.getHttpServer()).post(
        `/api/v1/checkout/${order.id}/mercado-pago/preference`,
      ),
      request(app.getHttpServer()).post(
        `/api/v1/checkout/${order.id}/mercado-pago/preference`,
      ),
    ]);
    expect(
      responses.every((response) => [201, 409].includes(response.status)),
    ).toBe(true);
    expect(responses.some((response) => response.status === 201)).toBe(true);
    expect(createPreference).toHaveBeenCalledTimes(1);
    expect(
      await ds
        .getRepository(PaymentPreference)
        .findOneByOrFail({ orderId: order.id }),
    ).toMatchObject({ status: PaymentPreferenceStatus.READY });
  });

  it("recovers a stale CREATING Preference without issuing another provider POST", async () => {
    const { order } = await orderWithoutPreference();
    await ds.getRepository(PaymentPreference).save({
      orderId: order.id,
      provider: "mercado_pago",
      providerPreferenceId: null,
      status: PaymentPreferenceStatus.CREATING,
      initPoint: null,
      lastErrorCode: null,
      lastErrorAt: null,
      readyAt: null,
      lastReconciliationAt: null,
    });
    await ds.query(
      "UPDATE payment_preferences SET updated_at = NOW() - INTERVAL '2 minutes' WHERE order_id = $1",
      [order.id],
    );
    searchPreferences.mockResolvedValue([
      { id: "recovered-stale", init_point: "https://mp.test/recovered-stale" },
    ]);
    const response = await request(app.getHttpServer())
      .post(`/api/v1/checkout/${order.id}/mercado-pago/preference`)
      .expect(201);
    expect(response.body.preferenceId).toBe("recovered-stale");
    expect(createPreference).not.toHaveBeenCalled();
    expect(searchPreferences).toHaveBeenCalledTimes(1);
  });

  it("recovers timeout-after-success after a temporary lookup outage without a duplicate POST", async () => {
    const { order } = await orderWithoutPreference();
    createPreference.mockRejectedValueOnce(new Error("CREATE_TIMEOUT"));
    searchPreferences.mockRejectedValueOnce(new Error("LOOKUP_UNAVAILABLE"));
    await request(app.getHttpServer())
      .post(`/api/v1/checkout/${order.id}/mercado-pago/preference`)
      .expect(503);
    expect(
      await ds
        .getRepository(PaymentPreference)
        .findOneByOrFail({ orderId: order.id }),
    ).toMatchObject({
      status: PaymentPreferenceStatus.REQUIRES_REVIEW,
      lastErrorCode: "RECOVERY_UNAVAILABLE",
    });

    searchPreferences.mockResolvedValueOnce([
      {
        id: "created-before-timeout",
        init_point: "https://mp.test/created-before-timeout",
      },
    ]);
    const recovered = await request(app.getHttpServer())
      .post(`/api/v1/checkout/${order.id}/mercado-pago/preference`)
      .expect(201);
    expect(recovered.body.preferenceId).toBe("created-before-timeout");
    expect(createPreference).toHaveBeenCalledTimes(1);
  });

  it("requires two separated empty recoveries before allowing a new Preference POST", async () => {
    const { order } = await orderWithoutPreference();
    createPreference.mockRejectedValueOnce(new Error("CREATE_TIMEOUT"));
    searchPreferences.mockResolvedValue([]);

    await request(app.getHttpServer())
      .post(`/api/v1/checkout/${order.id}/mercado-pago/preference`)
      .expect(503);
    await request(app.getHttpServer())
      .post(`/api/v1/checkout/${order.id}/mercado-pago/preference`)
      .expect(503);
    expect(createPreference).toHaveBeenCalledTimes(1);
    expect(
      await ds
        .getRepository(PaymentPreference)
        .findOneByOrFail({ orderId: order.id }),
    ).toMatchObject({
      status: PaymentPreferenceStatus.REQUIRES_REVIEW,
      lastErrorCode: "RECOVERY_NOT_FOUND",
    });

    await ds.query(
      "UPDATE payment_preferences SET last_error_at = NOW() - INTERVAL '31 seconds' WHERE order_id = $1",
      [order.id],
    );
    await request(app.getHttpServer())
      .post(`/api/v1/checkout/${order.id}/mercado-pago/preference`)
      .expect(503);
    expect(
      await ds
        .getRepository(PaymentPreference)
        .findOneByOrFail({ orderId: order.id }),
    ).toMatchObject({
      status: PaymentPreferenceStatus.FAILED,
      lastErrorCode: "RECOVERY_CONFIRMED_NOT_FOUND",
    });
    expect(createPreference).toHaveBeenCalledTimes(1);

    const retried = await request(app.getHttpServer())
      .post(`/api/v1/checkout/${order.id}/mercado-pago/preference`)
      .expect(201);
    expect(retried.body.preferenceId).toBe("created-preference");
    expect(createPreference).toHaveBeenCalledTimes(2);
  });

  it("keeps a fresh CREATING Preference single-flight", async () => {
    const { order } = await orderWithoutPreference();
    await ds.getRepository(PaymentPreference).save({
      orderId: order.id,
      provider: "mercado_pago",
      providerPreferenceId: null,
      status: PaymentPreferenceStatus.CREATING,
      initPoint: null,
      lastErrorCode: null,
      lastErrorAt: null,
      readyAt: null,
      lastReconciliationAt: null,
    });
    await request(app.getHttpServer())
      .post(`/api/v1/checkout/${order.id}/mercado-pago/preference`)
      .expect(409);
    expect(createPreference).not.toHaveBeenCalled();
    expect(searchPreferences).not.toHaveBeenCalled();
  });

  it("keeps the fifteen-minute expiration path as the final fallback", async () => {
    const { order, v } = await reservedOrder();
    await ds.getRepository(Order).update(order.id, {
      reservationExpiresAt: new Date(Date.now() - 3 * 60_000),
    });
    await payments.reconcileExpiredReservations();
    expect(
      (await ds.getRepository(Order).findOneByOrFail({ id: order.id })).status,
    ).toBe(OrderStatus.EXPIRED);
    expect(
      await ds.getRepository(Inventory).findOneByOrFail({ variantId: v.id }),
    ).toMatchObject({ stockOnHand: 1, reservedStock: 0 });
  });
});
