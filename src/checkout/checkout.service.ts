import { Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import { DataSource, EntityManager, In, QueryFailedError } from "typeorm";
import { DomainError } from "../common/domain-error";
import { reservationMinutes } from "../config/database.config";
import { InventoryService } from "../inventory/inventory.service";
import { ProductVariant } from "../products/entities/product-variant.entity";
import { Order, OrderStatus } from "../orders/entities/order.entity";
import { OrderItem } from "../orders/entities/order-item.entity";
import {
  FulfillmentMethod,
  FulfillmentStatus,
  OrderFulfillment,
} from "../orders/entities/order-fulfillment.entity";
import { ReserveCheckoutDto } from "./dto/reserve-checkout.dto";

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
    const variants = await manager.find(ProductVariant, {
      where: { id: In(items.map((item) => item.variantId)) },
      relations: { product: true },
    });
    const byId = new Map(variants.map((variant) => [variant.id, variant]));
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
      if (!variant.product.active)
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
        productNameSnapshot: variant.product.name,
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
