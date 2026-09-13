import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DataSource, EntityManager, LessThanOrEqual } from "typeorm";
import { InventoryService } from "../inventory/inventory.service";
import { mercadoPagoConfig } from "../config/database.config";
import {
  RaffleNumber,
  RaffleNumberStatus,
} from "../raffles/entities/raffle-number.entity";
import { RafflePurchase } from "../raffles/entities/raffle-purchase.entity";
import { Order, OrderKind, OrderStatus } from "./entities/order.entity";
import { OrderItem } from "./entities/order-item.entity";

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  constructor(
    private readonly dataSource: DataSource,
    private readonly inventory: InventoryService,
  ) {}

  @Cron("0 * * * * *")
  async scheduledExpiration(): Promise<void> {
    if (mercadoPagoConfig().enabled) await this.expireRaffleReservations();
    else await this.expireReservations();
  }

  async expireReservations(now = new Date()): Promise<number> {
    const candidates = await this.dataSource.getRepository(Order).find({
      where: {
        status: OrderStatus.AWAITING_PAYMENT,
        reservationExpiresAt: LessThanOrEqual(now),
      },
      select: { id: true },
    });
    let expired = 0;
    for (const { id } of candidates)
      if (await this.expireOrder(id, now)) expired++;
    if (expired) this.logger.log(`Expired ${expired} reservation(s)`);
    return expired;
  }

  async expireRaffleReservations(now = new Date()): Promise<number> {
    const candidates = await this.dataSource.getRepository(Order).find({
      where: {
        kind: OrderKind.RAFFLE,
        status: OrderStatus.AWAITING_PAYMENT,
        reservationExpiresAt: LessThanOrEqual(now),
      },
      select: { id: true },
      order: { reservationExpiresAt: "ASC" },
    });
    let expired = 0;
    for (const { id } of candidates)
      if (await this.expireOrder(id, now)) expired++;
    return expired;
  }

  async expireOrder(orderId: string, now = new Date()): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, "order")
        .setLock("pessimistic_write")
        .where("order.id = :orderId", { orderId })
        .getOne();
      if (
        !order ||
        order.status !== OrderStatus.AWAITING_PAYMENT ||
        order.reservationExpiresAt > now
      )
        return false;
      if (order.kind === OrderKind.RAFFLE)
        await this.releaseRaffleReservation(manager, order);
      else {
        const items = await manager.findBy(OrderItem, { orderId });
        for (const item of items.sort((a, b) =>
          a.variantId.localeCompare(b.variantId),
        ))
          await this.inventory.releaseReservation(
            manager,
            item.variantId,
            item.quantity,
            order.id,
          );
      }
      order.status = OrderStatus.EXPIRED;
      await manager.save(order);
      return true;
    });
  }

  private async releaseRaffleReservation(
    manager: EntityManager,
    order: Order,
  ): Promise<void> {
    const purchase = await manager
      .getRepository(RafflePurchase)
      .createQueryBuilder("purchase")
      .setLock("pessimistic_write")
      .where("purchase.order_id = :orderId", { orderId: order.id })
      .getOne();
    if (!purchase)
      throw new Error(
        `Raffle purchase invariant violated for order ${order.id}`,
      );
    this.logger.log({
      step: "raffle_reservation_expiration_started",
      raffleId: purchase.raffleId,
      rafflePurchaseId: purchase.id,
      orderId: order.id,
    });
    const numbers = await manager
      .getRepository(RaffleNumber)
      .createQueryBuilder("raffleNumber")
      .setLock("pessimistic_write")
      .where("raffleNumber.raffle_purchase_id = :purchaseId", {
        purchaseId: purchase.id,
      })
      .orderBy("raffleNumber.number", "ASC")
      .getMany();
    const reserved = numbers.filter(
      (number) => number.status === RaffleNumberStatus.RESERVED,
    );
    for (const number of reserved) {
      number.status = RaffleNumberStatus.AVAILABLE;
      number.rafflePurchaseId = null;
      number.reservedAt = null;
      number.reservedUntil = null;
      number.soldAt = null;
    }
    if (reserved.length) await manager.save(reserved);
    this.logger.log({
      step: "raffle_reservation_released",
      raffleId: purchase.raffleId,
      rafflePurchaseId: purchase.id,
      orderId: order.id,
      numbers: reserved.map((number) => number.number),
      numberCount: reserved.length,
      processingResult: "EXPIRED",
    });
  }

  async findWithItems(
    manager: EntityManager,
    idempotencyKey: string,
  ): Promise<Order | null> {
    return manager.findOne(Order, {
      where: { idempotencyKey },
      relations: { items: true },
    });
  }
}
