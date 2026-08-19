import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DataSource, In, LessThanOrEqual } from "typeorm";
import { DomainError } from "../common/domain-error";
import { mercadoPagoConfig } from "../config/database.config";
import { InventoryService } from "../inventory/inventory.service";
import { Order, OrderStatus } from "../orders/entities/order.entity";
import { OrderItem } from "../orders/entities/order-item.entity";
import { centsToMercadoPagoAmount, mercadoPagoAmountToCents } from "./money";
import {
  MERCADO_PAGO_GATEWAY,
  MercadoPagoGatewayContract,
  MercadoPagoPayment,
} from "./mercado-pago.gateway";
import { Payment, PaymentProcessingStatus } from "./entities/payment.entity";
import {
  PaymentPreference,
  PaymentPreferenceStatus,
} from "./entities/payment-preference.entity";
import {
  WebhookEvent,
  WebhookEventStatus,
} from "./entities/webhook-event.entity";

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly config = mercadoPagoConfig();
  constructor(
    private readonly dataSource: DataSource,
    private readonly inventory: InventoryService,
    @Inject(MERCADO_PAGO_GATEWAY)
    private readonly gateway: MercadoPagoGatewayContract,
  ) {}

  private trace(
    step: string,
    context: Record<string, string | number | boolean | null | undefined>,
  ) {
    this.logger.log({ step, ...context });
  }

  private errorCode(error: unknown): string {
    if (error instanceof DomainError) return error.code;
    if (typeof error === "object" && error && "code" in error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === "string") return code;
    }
    return error instanceof Error ? error.name : "UNKNOWN_ERROR";
  }

  async createPreference(orderId: string) {
    if (!this.config.enabled)
      throw new DomainError(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Mercado Pago no está habilitado.",
        undefined,
        503,
      );
    const prepared = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, "order")
        .setLock("pessimistic_write")
        .where("order.id = :orderId", { orderId })
        .getOne();
      if (!order || order.status === OrderStatus.EXPIRED)
        throw new DomainError(
          "ORDER_EXPIRED",
          "La orden no está disponible para pago.",
        );
      if (order.status === OrderStatus.PAID)
        throw new DomainError("ORDER_ALREADY_PAID", "La orden ya fue pagada.");
      if (
        order.status !== OrderStatus.AWAITING_PAYMENT &&
        order.status !== OrderStatus.PAYMENT_PENDING
      )
        throw new DomainError(
          "PAYMENT_PREFERENCE_NOT_READY",
          "La orden no admite una preference.",
        );
      if (order.reservationExpiresAt <= new Date())
        throw new DomainError("ORDER_EXPIRED", "La reserva ya venció.");
      const preference = await manager.findOneBy(PaymentPreference, {
        orderId,
      });
      if (preference?.status === PaymentPreferenceStatus.READY)
        return { order, preference, create: false };
      if (preference && preference.status === PaymentPreferenceStatus.CREATING)
        throw new DomainError(
          "PAYMENT_PREFERENCE_NOT_READY",
          "La preference se está creando; reintentá en instantes.",
          undefined,
          409,
        );
      const saved = await manager.save(
        PaymentPreference,
        preference ?? {
          orderId,
          provider: "mercado_pago",
          status: PaymentPreferenceStatus.CREATING,
          providerPreferenceId: null,
          initPoint: null,
          lastErrorCode: null,
          lastErrorAt: null,
          readyAt: null,
          lastReconciliationAt: null,
        },
      );
      return { order, preference: saved, create: true };
    });
    if (!prepared.create)
      return this.preferenceResponse(prepared.order, prepared.preference);
    const items = await this.dataSource
      .getRepository(OrderItem)
      .findBy({ orderId });
    try {
      const created = await this.gateway.createPreference(
        this.preferencePayload(prepared.order, items),
      );
      const preference = await this.readyPreference(orderId, created);
      return this.preferenceResponse(prepared.order, preference);
    } catch (error) {
      const recovered = await this.recoverPreference(orderId);
      if (recovered) return this.preferenceResponse(prepared.order, recovered);
      await this.dataSource
        .getRepository(PaymentPreference)
        .update(
          { orderId },
          {
            status: PaymentPreferenceStatus.FAILED,
            lastErrorCode: "CREATE_FAILED",
            lastErrorAt: new Date(),
          },
        );
      throw new DomainError(
        "PAYMENT_PREFERENCE_CREATION_FAILED",
        "No se pudo crear la preference de pago.",
        undefined,
        503,
      );
    }
  }

  private preferencePayload(order: Order, items: OrderItem[]) {
    const base = this.config.frontendBaseUrl.replace(/\/$/, "");
    return {
      items: items.map((item) => ({
        id: item.skuSnapshot,
        title: item.productNameSnapshot,
        quantity: item.quantity,
        unit_price: centsToMercadoPagoAmount(item.unitPriceInCents),
      })),
      external_reference: order.id,
      back_urls: {
        success: `${base}/checkout/success`,
        pending: `${base}/checkout/pending`,
        failure: `${base}/checkout/failure`,
      },
      auto_return: "approved",
      expires: true,
      expiration_date_from: new Date().toISOString(),
      expiration_date_to: order.reservationExpiresAt.toISOString(),
      binary_mode: this.config.binaryMode,
      ...(this.config.excludeTicket
        ? { payment_methods: { excluded_payment_types: [{ id: "ticket" }] } }
        : {}),
    };
  }
  private async readyPreference(
    orderId: string,
    remote: { id: string; init_point: string },
  ) {
    return this.dataSource.transaction(async (manager) => {
      const preference = await manager.findOneByOrFail(PaymentPreference, {
        orderId,
      });
      preference.providerPreferenceId = remote.id;
      preference.initPoint = remote.init_point;
      preference.status = PaymentPreferenceStatus.READY;
      preference.readyAt = new Date();
      preference.lastErrorCode = null;
      return manager.save(preference);
    });
  }
  private async recoverPreference(orderId: string) {
    try {
      const matches =
        await this.gateway.searchPreferencesByExternalReference(orderId);
      if (matches.length !== 1) return null;
      return await this.readyPreference(orderId, matches[0]);
    } catch {
      return null;
    }
  }
  private preferenceResponse(order: Order, preference: PaymentPreference) {
    return {
      orderId: order.id,
      preferenceId: preference.providerPreferenceId,
      initPoint: preference.initPoint,
      reservationExpiresAt: order.reservationExpiresAt,
    };
  }
  async status(orderId: string) {
    const order = await this.dataSource
      .getRepository(Order)
      .findOneBy({ id: orderId });
    if (!order)
      throw new DomainError(
        "ORDER_NOT_FOUND",
        "La orden no existe.",
        undefined,
        404,
      );
    return {
      orderId: order.id,
      status: order.status.toLowerCase(),
      reservationExpiresAt: order.reservationExpiresAt,
      paidAt: order.paidAt,
    };
  }

  async receiveWebhook(input: {
    headers: Record<string, string | string[] | undefined>;
    query: Record<string, string | string[] | undefined>;
    body: Record<string, unknown>;
  }) {
    const dataId = input.query["data.id"];
    const bodyDataId = typeof input.body.data === "object" && input.body.data && "id" in input.body.data
      ? String((input.body.data as { id?: unknown }).id ?? "") || null
      : null;
    const queryDataId = Array.isArray(dataId) ? dataId[0] : (dataId ?? null);
    this.logger.log({
      hasXSignature: Boolean(input.headers["x-signature"]),
      hasXRequestId: Boolean(input.headers["x-request-id"]),
      dataId: queryDataId,
      bodyDataId,
      dataIdSource: "query.data.id",
      queryAndBodyDataIdMatch: bodyDataId === null ? null : bodyDataId === queryDataId,
      webhookSecretConfigured: Boolean(this.config.webhookSecret),
    });
    try {
      this.gateway.validateWebhookSignature({
        xSignature: input.headers["x-signature"],
        xRequestId: input.headers["x-request-id"],
        dataId,
      });
      this.trace("webhook_signature_valid", {
        providerPaymentId: Array.isArray(dataId) ? dataId[0] : (dataId ?? null),
        processingResult: "SIGNATURE_VALID",
      });
    } catch {
      this.trace("webhook_immediate_processing_skipped", {
        providerPaymentId: Array.isArray(dataId) ? dataId[0] : (dataId ?? null),
        processingResult: "INVALID_SIGNATURE",
      });
      throw new DomainError(
        "INVALID_WEBHOOK_SIGNATURE",
        "La firma del webhook es inválida.",
        undefined,
        401,
      );
    }
    const type = String(input.body.type ?? input.body.topic ?? "");
    const providerPaymentId = Array.isArray(dataId) ? dataId[0] : dataId;
    if (type !== "payment" || !providerPaymentId) {
      this.trace("webhook_immediate_processing_skipped", {
        providerPaymentId: providerPaymentId ?? null,
        processingResult: "IGNORED_NON_PAYMENT_OR_MISSING_ID",
      });
      return { received: true };
    }
    const eventId = input.body.id ? String(input.body.id) : null;
    let webhookEventId: string | null = null;
    const events = this.dataSource.getRepository(WebhookEvent);
    try {
      const created = await events.save(
        events.create({
          provider: "mercado_pago",
          providerEventId: eventId,
          providerResourceId: providerPaymentId,
          type,
          action: input.body.action ? String(input.body.action) : null,
          requestId: Array.isArray(input.headers["x-request-id"])
            ? input.headers["x-request-id"][0]
            : (input.headers["x-request-id"] ?? null),
          status: WebhookEventStatus.PENDING,
          attempts: 0,
          nextAttemptAt: null,
          lastError: null,
          payload: input.body as any,
          receivedAt: new Date(),
          processedAt: null,
        }),
      );
      webhookEventId = created.id;
      this.trace("webhook_inbox_created", {
        providerPaymentId,
        webhookEventId,
        processingResult: "PENDING",
      });
    } catch (error: unknown) {
      if (!String((error as { code?: string }).code).includes("23505")) {
        this.trace("webhook_immediate_processing_failed", {
          providerPaymentId,
          processingResult: `INBOX_PERSIST_${this.errorCode(error)}`,
        });
        throw error;
      }
      const existing = eventId
        ? await events.findOneBy({
            provider: "mercado_pago",
            providerEventId: eventId,
          })
        : null;
      this.trace("webhook_inbox_existing", {
        providerPaymentId,
        webhookEventId: existing?.id ?? null,
        processingResult: existing?.status ?? "DUPLICATE_NOT_FOUND",
      });
      if (existing && existing.status !== WebhookEventStatus.PROCESSED) {
        await events.update(existing.id, {
          status: WebhookEventStatus.PENDING,
          attempts: 0,
          nextAttemptAt: null,
          lastError: null,
        });
        webhookEventId = existing.id;
        this.trace("webhook_requeued", {
          providerPaymentId,
          webhookEventId,
          processingResult: "PENDING",
        });
      } else {
        this.trace("webhook_immediate_processing_skipped", {
          providerPaymentId,
          webhookEventId: existing?.id ?? null,
          processingResult: existing ? "ALREADY_PROCESSED" : "DUPLICATE_EVENT_NOT_FOUND",
        });
      }
    }
    if (!webhookEventId) {
      this.trace("webhook_immediate_processing_skipped", {
        providerPaymentId,
        processingResult: "NO_INBOX_EVENT_ID",
      });
      return { received: true };
    }
    this.trace("webhook_immediate_processing_started", {
      providerPaymentId,
      webhookEventId,
    });
    try {
      const result = await this.processWebhookEvent(webhookEventId);
      const trace = result === "FAILED" ? "webhook_immediate_processing_failed" : "webhook_immediate_processing_finished";
      this.trace(trace, {
        providerPaymentId,
        webhookEventId,
        processingResult: result,
      });
    } catch (error) {
      this.trace("webhook_immediate_processing_failed", {
        providerPaymentId,
        webhookEventId,
        processingResult: this.errorCode(error),
      });
      throw error;
    }
    return { received: true };
  }

  @Cron("15 * * * * *") async processWebhookInbox() {
    const now = new Date();
    const events = await this.dataSource
      .getRepository(WebhookEvent)
      .find({
        where: [
          { status: WebhookEventStatus.PENDING },
          {
            status: WebhookEventStatus.RETRY,
            nextAttemptAt: LessThanOrEqual(now),
          },
        ],
        take: 25,
        order: { receivedAt: "ASC" },
      });
    for (const event of events) await this.processWebhookEvent(event.id);
  }
  async processWebhookEvent(id: string) {
    const event = await this.dataSource
      .getRepository(WebhookEvent)
      .findOneBy({ id });
    if (!event || event.status === WebhookEventStatus.PROCESSED) {
      this.trace("webhook_event_skipped", {
        webhookEventId: id,
        providerPaymentId: event?.providerResourceId ?? null,
        processingResult: event ? "ALREADY_PROCESSED" : "NOT_FOUND",
      });
      return "SKIPPED";
    }
    try {
      this.trace("webhook_gateway_get_payment_started", {
        webhookEventId: id,
        providerPaymentId: event.providerResourceId,
      });
      const remote = await this.gateway.getPayment(event.providerResourceId);
      this.trace("webhook_gateway_get_payment_succeeded", {
        webhookEventId: id,
        providerPaymentId: remote.id,
        orderId: remote.external_reference ?? null,
        processingResult: remote.status,
      });
      await this.recordAndApply(remote);
      await this.dataSource
        .getRepository(WebhookEvent)
        .update(id, {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date(),
          lastError: null,
        });
      this.trace("webhook_event_processed", {
        webhookEventId: id,
        providerPaymentId: remote.id,
        orderId: remote.external_reference ?? null,
        processingResult: "PROCESSED",
      });
      return "PROCESSED";
    } catch (error) {
      const attempts = event.attempts + 1;
      await this.dataSource
        .getRepository(WebhookEvent)
        .update(id, {
          status:
            attempts >= 4
              ? WebhookEventStatus.DEAD_LETTER
              : WebhookEventStatus.RETRY,
          attempts,
          nextAttemptAt: new Date(
            Date.now() +
              [5000, 30000, 120000, 600000][Math.min(attempts - 1, 3)],
          ),
          lastError:
            error instanceof Error
              ? error.message.slice(0, 250)
              : "Unknown error",
        });
      this.logger.warn({
        step: "webhook_event_failed",
        webhookEventId: id,
        providerPaymentId: event.providerResourceId,
        processingResult:
          attempts >= 4 ? WebhookEventStatus.DEAD_LETTER : WebhookEventStatus.RETRY,
        errorCode: this.errorCode(error),
      });
      return "FAILED";
    }
  }

  async recordAndApply(remote: MercadoPagoPayment) {
    const orderId = remote.external_reference;
    if (!orderId) {
      this.trace("payment_ignored_missing_order_reference", {
        providerPaymentId: remote.id,
        processingResult: "MISSING_EXTERNAL_REFERENCE",
      });
      return;
    }
    this.trace("payment_record_started", { providerPaymentId: remote.id, orderId });
    await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, "order")
        .setLock("pessimistic_write")
        .where("order.id = :orderId", { orderId })
        .getOne();
      if (!order) {
        this.trace("payment_ignored_order_not_found", {
          providerPaymentId: remote.id,
          orderId,
          processingResult: "ORDER_NOT_FOUND",
        });
        return;
      }
      let payment = await manager.findOne(Payment, {
        where: { provider: "mercado_pago", providerPaymentId: remote.id },
      });
      const fields = {
        orderId,
        provider: "mercado_pago",
        providerPaymentId: remote.id,
        providerStatus: remote.status,
        providerStatusDetail: remote.status_detail ?? null,
        transactionAmountInCents: mercadoPagoAmountToCents(
          remote.transaction_amount,
        ),
        currencyId: remote.currency_id,
        externalReference: remote.external_reference ?? null,
        paymentMethodId: remote.payment_method_id ?? null,
        paymentTypeId: remote.payment_type_id ?? null,
        dateCreated: this.date(remote.date_created),
        dateApproved: this.date(remote.date_approved),
        dateLastUpdated: this.date(remote.date_last_updated),
      };
      if (!payment)
        payment = manager.create(Payment, {
          ...fields,
          processingStatus: PaymentProcessingStatus.RECEIVED,
        });
      else Object.assign(payment, fields);
      await manager.save(payment);
      const valid =
        remote.external_reference === order.id &&
        remote.currency_id === "ARS" &&
        mercadoPagoAmountToCents(remote.transaction_amount) ===
          order.totalInCents;
      if (
        !valid ||
        (remote.status === "approved" &&
          order.status === OrderStatus.EXPIRED) ||
        (remote.status === "approved" &&
          order.status === OrderStatus.PAID &&
          payment.processingStatus !== PaymentProcessingStatus.APPLIED)
      ) {
        payment.processingStatus = PaymentProcessingStatus.REQUIRES_REVIEW;
        await manager.save(payment);
        this.trace("payment_requires_review", {
          providerPaymentId: remote.id,
          orderId: order.id,
          processingResult: "REQUIRES_REVIEW",
        });
        return;
      }
      if (remote.status === "approved") {
        if (payment.processingStatus === PaymentProcessingStatus.APPLIED) {
          this.trace("payment_already_applied", {
            providerPaymentId: remote.id,
            orderId: order.id,
            processingResult: "APPLIED",
          });
          return;
        }
        const items = await manager.findBy(OrderItem, { orderId: order.id });
        for (const item of items.sort((a, b) =>
          a.variantId.localeCompare(b.variantId),
        ))
          await this.inventory.commitSale(
            manager,
            item.variantId,
            item.quantity,
            order.id,
          );
        order.status = OrderStatus.PAID;
        order.paidAt = new Date();
        payment.processingStatus = PaymentProcessingStatus.APPLIED;
        await manager.save([order, payment]);
        this.trace("payment_sale_applied", {
          providerPaymentId: remote.id,
          orderId: order.id,
          processingResult: "PAID",
        });
        return;
      }
      if (
        ["pending", "in_process", "in_mediation", "authorized"].includes(
          remote.status,
        )
      ) {
        order.status = OrderStatus.PAYMENT_PENDING;
        payment.processingStatus = PaymentProcessingStatus.RECORDED;
        await manager.save([order, payment]);
        this.trace("payment_recorded_pending", {
          providerPaymentId: remote.id,
          orderId: order.id,
          processingResult: "PAYMENT_PENDING",
        });
        return;
      }
      payment.processingStatus = PaymentProcessingStatus.RECORDED;
      await manager.save(payment);
      this.trace("payment_recorded_non_terminal", {
        providerPaymentId: remote.id,
        orderId: order.id,
        processingResult: "RECORDED",
      });
    });
  }
  private date(value?: string) {
    return value ? new Date(value) : null;
  }

  @Cron("30 * * * * *")
  async earlyReconcilePendingOrders() {
    if (!this.config.enabled) return;
    const now = new Date();
    const cutoff = new Date(
      now.getTime() - this.config.earlyReconciliationIntervalSeconds * 1000,
    );
    const orders = await this.dataSource
      .getRepository(Order)
      .createQueryBuilder("order")
      .innerJoin(
        PaymentPreference,
        "preference",
        "preference.order_id = order.id AND preference.provider = :provider AND preference.status = :preferenceStatus",
        {
          provider: "mercado_pago",
          preferenceStatus: PaymentPreferenceStatus.READY,
        },
      )
      .leftJoin(
        Payment,
        "applied_payment",
        "applied_payment.order_id = order.id AND applied_payment.processing_status = :appliedStatus",
        { appliedStatus: PaymentProcessingStatus.APPLIED },
      )
      .where("order.status IN (:...statuses)", {
        statuses: [OrderStatus.AWAITING_PAYMENT, OrderStatus.PAYMENT_PENDING],
      })
      .andWhere("order.created_at <= :cutoff", { cutoff })
      .andWhere("order.reservation_expires_at > :now", { now })
      .andWhere("applied_payment.id IS NULL")
      .andWhere(
        "(preference.last_reconciliation_at IS NULL OR preference.last_reconciliation_at <= :cutoff)",
        { cutoff },
      )
      .select("order.id", "id")
      .orderBy("order.created_at", "ASC")
      .take(25)
      .getRawMany<{ id: string }>();

    for (const { id: orderId } of orders) {
      this.trace("early_reconciliation_started", { orderId });
      try {
        const payments = await this.gateway.searchPaymentsByExternalReference(
          orderId,
        );
        const approved = payments.find((payment) => payment.status === "approved");
        if (approved) await this.recordAndApply(approved);
        else if (
          payments.some((payment) =>
            ["pending", "in_process", "in_mediation", "authorized"].includes(
              payment.status,
            ),
          )
        )
          for (const payment of payments) await this.recordAndApply(payment);
        await this.dataSource.getRepository(PaymentPreference).update(
          { orderId },
          { lastReconciliationAt: now },
        );
        this.trace("early_reconciliation_finished", {
          orderId,
          processingResult: approved
            ? "APPROVED_FOUND"
            : payments.length
              ? "NO_APPROVED_PAYMENT"
              : "NO_PAYMENT",
        });
      } catch (error) {
        await this.dataSource.getRepository(PaymentPreference).update(
          { orderId },
          { lastReconciliationAt: now },
        );
        this.logger.warn({
          step: "early_reconciliation_failed",
          orderId,
          errorCode: this.errorCode(error),
        });
      }
    }
  }

  @Cron("45 * * * * *") async reconcileExpiredReservations() {
    if (!this.config.enabled) return;
    const cutoff = new Date(
      Date.now() - this.config.reconciliationGraceSeconds * 1000,
    );
    const orders = await this.dataSource
      .getRepository(Order)
      .find({
        where: {
          status: OrderStatus.AWAITING_PAYMENT,
          reservationExpiresAt: LessThanOrEqual(cutoff),
        },
        take: 25,
      });
    for (const order of orders) {
      try {
        const payments = await this.gateway.searchPaymentsByExternalReference(
          order.id,
        );
        const approved = payments.find(
          (payment) => payment.status === "approved",
        );
        if (approved) await this.recordAndApply(approved);
        else if (
          payments.some((payment) =>
            ["pending", "in_process", "in_mediation", "authorized"].includes(
              payment.status,
            ),
          )
        )
          for (const payment of payments) await this.recordAndApply(payment);
        else await this.expireWithoutPayment(order.id);
      } catch {
        this.logger.warn(`Reconciliation deferred for order ${order.id}`);
      }
    }
  }
  private async expireWithoutPayment(orderId: string) {
    await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, "order")
        .setLock("pessimistic_write")
        .where("order.id = :orderId", { orderId })
        .getOne();
      if (!order || order.status !== OrderStatus.AWAITING_PAYMENT) return;
      const items = await manager.findBy(OrderItem, { orderId });
      for (const item of items.sort((a, b) =>
        a.variantId.localeCompare(b.variantId),
      ))
        await this.inventory.releaseReservation(
          manager,
          item.variantId,
          item.quantity,
          order.id,
          "Mercado Pago preference expired without payment",
        );
      order.status = OrderStatus.EXPIRED;
      await manager.save(order);
    });
  }
}
