import { Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import { DataSource, EntityManager, QueryFailedError } from "typeorm";
import { DomainError } from "../common/domain-error";
import { reservationMinutes } from "../config/database.config";
import { InventoryService } from "../inventory/inventory.service";
import { ProductVariant } from "../products/entities/product-variant.entity";
import { Product } from "../products/entities/product.entity";
import { Order, OrderStatus } from "../orders/entities/order.entity";
import { OrderItem } from "../orders/entities/order-item.entity";
import {
  FulfillmentMethod,
  FulfillmentStatus,
  OrderFulfillment,
} from "../orders/entities/order-fulfillment.entity";
import { ReserveCheckoutDto } from "./dto/reserve-checkout.dto";
import {
  MAX_ACTIVE_RESERVATIONS_PER_EMAIL,
  MAX_CHECKOUT_LINES,
  MAX_QUANTITY_PER_ITEM,
  MAX_TOTAL_QUANTITY,
} from "./checkout-limits";

type NormalizedItem = { variantId: string; quantity: number };
@Injectable()
export class CheckoutService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly inventory: InventoryService,
  ) {}
  async reserve(dto: ReserveCheckoutDto, idempotencyKey: string) {
    if (!idempotencyKey?.trim())
      throw new DomainError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "El header Idempotency-Key es obligatorio.",
        undefined,
        400,
      );
    const items = this.normalize(dto.items);
    const customer = {
      name: dto.customer.name.trim(),
      email: dto.customer.email.trim().toLowerCase(),
      phone: dto.customer.phone.trim(),
    };
    const fulfillment = {
      method: dto.fulfillment.method,
      note: dto.fulfillment.note?.trim() || null,
    };
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ items, customer, fulfillment }))
      .digest("hex");
    try {
      return await this.dataSource.transaction((manager) =>
        this.reserveInTransaction(
          manager,
          items,
          customer,
          fulfillment,
          idempotencyKey,
          fingerprint,
        ),
      );
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as { code?: string }).code === "23505"
      ) {
        const existing = await this.dataSource
          .getRepository(Order)
          .findOne({ where: { idempotencyKey }, relations: { items: true } });
        if (existing) return this.responseOrConflict(existing, fingerprint);
      }
      throw error;
    }
  }
  private async reserveInTransaction(
    manager: EntityManager,
    items: NormalizedItem[],
    customer: { name: string; email: string; phone: string },
    fulfillment: { method: FulfillmentMethod; note: string | null },
    idempotencyKey: string,
    fingerprint: string,
  ) {
    const existing = await manager.findOne(Order, {
      where: { idempotencyKey },
      relations: { items: true },
    });
    if (existing) return this.responseOrConflict(existing, fingerprint);
    if (
      items.length > MAX_CHECKOUT_LINES ||
      items.some((item) => item.quantity > MAX_QUANTITY_PER_ITEM) ||
      items.reduce((total, item) => total + item.quantity, 0) >
        MAX_TOTAL_QUANTITY
    )
      throw new DomainError(
        "CHECKOUT_LIMIT_EXCEEDED",
        "El checkout supera los límites permitidos.",
        undefined,
        400,
      );

    // Serialize active-reservation checks for the same customer without a
    // second datastore. The transaction-scoped advisory lock is released on
    // commit/rollback and does not block unrelated customers.
    await manager.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [customer.email],
    );
    const existingAfterLock = await manager.findOne(Order, {
      where: { idempotencyKey },
      relations: { items: true },
    });
    if (existingAfterLock)
      return this.responseOrConflict(existingAfterLock, fingerprint);
    const activeReservations = await manager
      .getRepository(OrderFulfillment)
      .createQueryBuilder("fulfillment")
      .innerJoin(Order, "order", "order.id = fulfillment.order_id")
      .where("fulfillment.customer_email = :email", { email: customer.email })
      .andWhere("order.status IN (:...statuses)", {
        statuses: [OrderStatus.AWAITING_PAYMENT, OrderStatus.PAYMENT_PENDING],
      })
      .andWhere("order.reservation_expires_at > NOW()")
      .getCount();
    if (activeReservations >= MAX_ACTIVE_RESERVATIONS_PER_EMAIL)
      throw new DomainError(
        "ACTIVE_RESERVATION_LIMIT",
        "Alcanzaste el límite de reservas activas. Esperá a que venza una reserva antes de intentar nuevamente.",
        undefined,
        409,
      );

    const variantIds = [...new Set(items.map((item) => item.variantId))].sort();
    const variants = await manager
      .getRepository(ProductVariant)
      .createQueryBuilder("variant")
      .where("variant.id IN (:...variantIds)", { variantIds })
      .getMany();
    if (!variants.length) {
      throw new DomainError(
        "VARIANT_NOT_FOUND",
        "La variante no existe.",
        { variantId: items[0].variantId },
        404,
      );
    }
    const productIds = [
      ...new Set(variants.map((variant) => variant.productId)),
    ].sort();
    const products = await manager
      .getRepository(Product)
      .createQueryBuilder("product")
      .setLock("pessimistic_write")
      .where("product.id IN (:...productIds)", { productIds })
      .orderBy("product.id", "ASC")
      .getMany();
    const productById = new Map(
      products.map((product) => [product.id, product]),
    );
    const lockedVariants = await manager
      .getRepository(ProductVariant)
      .createQueryBuilder("variant")
      .setLock("pessimistic_write")
      .where("variant.id IN (:...variantIds)", { variantIds })
      .orderBy("variant.id", "ASC")
      .getMany();
    const byId = new Map(
      lockedVariants.map((variant) => [variant.id, variant]),
    );
    for (const item of items) {
      const variant = byId.get(item.variantId);
      if (!variant)
        throw new DomainError(
          "VARIANT_NOT_FOUND",
          "La variante no existe.",
          { variantId: item.variantId },
          404,
        );
      if (!variant.active)
        throw new DomainError(
          "VARIANT_INACTIVE",
          "La variante no está activa.",
          { variantId: item.variantId },
        );
      if (!productById.get(variant.productId)?.active)
        throw new DomainError(
          "PRODUCT_INACTIVE",
          "El producto no está activo.",
          { variantId: item.variantId },
        );
    }
    const expiresAt = new Date(Date.now() + reservationMinutes() * 60_000);
    const order = await manager.save(Order, {
      status: OrderStatus.AWAITING_PAYMENT,
      idempotencyKey,
      requestFingerprint: fingerprint,
      subtotalInCents: 0,
      totalInCents: 0,
      reservationExpiresAt: expiresAt,
    });
    let total = 0;
    const orderItems: Partial<OrderItem>[] = [];
    for (const item of items) {
      const variant = byId.get(item.variantId)!;
      await this.inventory.reserveStock(
        manager,
        variant.id,
        item.quantity,
        order.id,
      );
      const lineTotalInCents = variant.priceInCents * item.quantity;
      total += lineTotalInCents;
      orderItems.push({
        orderId: order.id,
        variantId: variant.id,
        productNameSnapshot: productById.get(variant.productId)!.name,
        variantNameSnapshot: variant.name,
        skuSnapshot: variant.sku,
        unitPriceInCents: variant.priceInCents,
        quantity: item.quantity,
        lineTotalInCents,
      });
    }
    await manager.save(OrderItem, orderItems);
    await manager.save(OrderFulfillment, {
      orderId: order.id,
      method: fulfillment.method,
      status: FulfillmentStatus.PENDING,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      customerNote: fulfillment.note,
      adminNote: null,
      readyAt: null,
      completedAt: null,
    });
    order.subtotalInCents = total;
    order.totalInCents = total;
    await manager.save(Order, order);
    return this.response({ ...order, items: orderItems as OrderItem[] });
  }
  private normalize(items: ReserveCheckoutDto["items"]): NormalizedItem[] {
    const grouped = new Map<string, number>();
    for (const item of items)
      grouped.set(
        item.variantId,
        (grouped.get(item.variantId) ?? 0) + item.quantity,
      );
    return [...grouped]
      .map(([variantId, quantity]) => ({ variantId, quantity }))
      .sort((a, b) => a.variantId.localeCompare(b.variantId));
  }
  private responseOrConflict(order: Order, fingerprint: string) {
    if (order.requestFingerprint !== fingerprint)
      throw new DomainError(
        "IDEMPOTENCY_CONFLICT",
        "La clave de idempotencia fue utilizada para otro carrito.",
      );
    return this.response(order);
  }
  private response(order: Order) {
    return {
      orderId: order.id,
      status: order.status.toLowerCase(),
      totalInCents: order.totalInCents,
      reservationExpiresAt: order.reservationExpiresAt,
      items: (order.items ?? []).map((item) => ({
        variantId: item.variantId,
        sku: item.skuSnapshot,
        name: item.variantNameSnapshot,
        quantity: item.quantity,
        unitPriceInCents: item.unitPriceInCents,
        lineTotalInCents: item.lineTotalInCents,
      })),
    };
  }
}
