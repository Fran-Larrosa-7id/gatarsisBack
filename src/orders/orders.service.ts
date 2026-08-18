import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource, EntityManager, LessThanOrEqual } from 'typeorm';
import { InventoryService } from '../inventory/inventory.service';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  constructor(private readonly dataSource: DataSource, private readonly inventory: InventoryService) {}

  @Cron('0 * * * * *')
  async scheduledExpiration(): Promise<void> { await this.expireReservations(); }

  async expireReservations(now = new Date()): Promise<number> {
    const candidates = await this.dataSource.getRepository(Order).find({ where: { status: OrderStatus.AWAITING_PAYMENT, reservationExpiresAt: LessThanOrEqual(now) }, select: { id: true } });
    let expired = 0;
    for (const { id } of candidates) if (await this.expireOrder(id, now)) expired++;
    if (expired) this.logger.log(`Expired ${expired} reservation(s)`);
    return expired;
  }

  async expireOrder(orderId: string, now = new Date()): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const order = await manager.createQueryBuilder(Order, 'order').setLock('pessimistic_write').where('order.id = :orderId', { orderId }).getOne();
      if (!order || order.status !== OrderStatus.AWAITING_PAYMENT || order.reservationExpiresAt > now) return false;
      const items = await manager.findBy(OrderItem, { orderId });
      for (const item of items.sort((a, b) => a.variantId.localeCompare(b.variantId))) await this.inventory.releaseReservation(manager, item.variantId, item.quantity, order.id);
      order.status = OrderStatus.EXPIRED;
      await manager.save(order);
      return true;
    });
  }

  async findWithItems(manager: EntityManager, idempotencyKey: string): Promise<Order | null> {
    return manager.findOne(Order, { where: { idempotencyKey }, relations: { items: true } });
  }
}
