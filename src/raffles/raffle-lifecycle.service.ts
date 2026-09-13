import { Injectable, Logger } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { DomainError } from "../common/domain-error";
import { Order, OrderKind } from "../orders/entities/order.entity";
import {
  RaffleNumber,
  RaffleNumberStatus,
} from "./entities/raffle-number.entity";
import { RafflePurchase } from "./entities/raffle-purchase.entity";
import { Raffle } from "./entities/raffle.entity";

export type RafflePreferenceContext = {
  raffleId: string;
  rafflePurchaseId: string;
  item: {
    id: string;
    title: string;
    description: string;
    quantity: number;
    unitPriceInCents: number;
  };
};

type LockedRaffleReservation = {
  purchase: RafflePurchase;
  raffle: Raffle;
  numbers: RaffleNumber[];
};

@Injectable()
export class RaffleLifecycleService {
  private readonly logger = new Logger(RaffleLifecycleService.name);

  async preferenceContext(
    manager: EntityManager,
    order: Order,
  ): Promise<RafflePreferenceContext> {
    this.assertRaffleOrder(order);
    if (order.reservationExpiresAt <= new Date())
      throw new DomainError(
        "RAFFLE_RESERVATION_EXPIRED",
        "La reserva de la rifa ya venció.",
      );

    const context = await this.lockReservation(manager, order);
    this.assertReservationConsistency(order, context, true);
    return {
      raffleId: context.purchase.raffleId,
      rafflePurchaseId: context.purchase.id,
      item: {
        id: `raffle-${context.purchase.raffleId}`,
        title: `Rifa solidaria — ${context.raffle.prizeName}`,
        description: `Números: ${context.numbers
          .map((item) => item.number.toString().padStart(2, "0"))
          .join(", ")}`,
        quantity: context.numbers.length,
        unitPriceInCents: context.purchase.unitPriceInCents,
      },
    };
  }

  async commitSale(
    manager: EntityManager,
    order: Order,
    providerPaymentId: string,
  ): Promise<
    | { applied: true; context: LockedRaffleReservation }
    | { applied: false; reason: "RAFFLE_RESERVATION_OWNERSHIP_CONFLICT" }
  > {
    this.assertRaffleOrder(order);
    const context = await this.lockReservation(manager, order);
    if (!this.isReservationConsistent(order, context, true)) {
      this.logger.warn({
        step: "raffle_payment_ownership_conflict",
        orderId: order.id,
        raffleId: context.purchase.raffleId,
        rafflePurchaseId: context.purchase.id,
        providerPaymentId,
        numbers: context.numbers.map((item) => item.number),
        numberCount: context.numbers.length,
        processingResult: "REQUIRES_REVIEW",
      });
      return {
        applied: false,
        reason: "RAFFLE_RESERVATION_OWNERSHIP_CONFLICT",
      };
    }

    const soldAt = new Date();
    for (const raffleNumber of context.numbers) {
      raffleNumber.status = RaffleNumberStatus.SOLD;
      raffleNumber.soldAt = soldAt;
      raffleNumber.reservedUntil = null;
      // reservedAt and rafflePurchaseId remain as settlement traceability.
    }
    await manager.save(context.numbers);
    return { applied: true, context };
  }

  async releaseReservation(
    manager: EntityManager,
    order: Order,
  ): Promise<LockedRaffleReservation> {
    this.assertRaffleOrder(order);
    const context = await this.lockReservation(manager, order);
    this.assertReservationConsistency(order, context, false);
    for (const raffleNumber of context.numbers) {
      raffleNumber.status = RaffleNumberStatus.AVAILABLE;
      raffleNumber.rafflePurchaseId = null;
      raffleNumber.reservedAt = null;
      raffleNumber.reservedUntil = null;
      raffleNumber.soldAt = null;
    }
    await manager.save(context.numbers);
    return context;
  }

  private async lockReservation(
    manager: EntityManager,
    order: Order,
  ): Promise<LockedRaffleReservation> {
    const purchase = await manager
      .getRepository(RafflePurchase)
      .createQueryBuilder("purchase")
      .setLock("pessimistic_write")
      .where("purchase.order_id = :orderId", { orderId: order.id })
      .getOne();
    if (!purchase)
      throw new DomainError(
        "RAFFLE_RESERVATION_OWNERSHIP_CONFLICT",
        "La compra de rifa no coincide con la orden.",
      );

    const raffle = await manager.findOneBy(Raffle, { id: purchase.raffleId });
    if (!raffle)
      throw new DomainError(
        "RAFFLE_RESERVATION_OWNERSHIP_CONFLICT",
        "La rifa asociada a la compra no existe.",
      );

    const numbers = await manager
      .getRepository(RaffleNumber)
      .createQueryBuilder("raffleNumber")
      .setLock("pessimistic_write")
      .where("raffleNumber.raffle_purchase_id = :purchaseId", {
        purchaseId: purchase.id,
      })
      .orderBy("raffleNumber.number", "ASC")
      .getMany();
    return { purchase, raffle, numbers };
  }

  private assertReservationConsistency(
    order: Order,
    context: LockedRaffleReservation,
    requireCanonicalTtl: boolean,
  ): void {
    if (!this.isReservationConsistent(order, context, requireCanonicalTtl))
      throw new DomainError(
        "RAFFLE_RESERVATION_OWNERSHIP_CONFLICT",
        "Los números reservados no coinciden con la compra de rifa.",
      );
  }

  private isReservationConsistent(
    order: Order,
    { purchase, numbers }: LockedRaffleReservation,
    requireCanonicalTtl: boolean,
  ): boolean {
    const expectedQuantity = order.totalInCents / purchase.unitPriceInCents;
    return (
      purchase.orderId === order.id &&
      purchase.unitPriceInCents > 0 &&
      Number.isInteger(expectedQuantity) &&
      expectedQuantity > 0 &&
      numbers.length === expectedQuantity &&
      order.subtotalInCents === order.totalInCents &&
      purchase.unitPriceInCents * numbers.length === order.totalInCents &&
      numbers.every(
        (item) =>
          item.raffleId === purchase.raffleId &&
          item.rafflePurchaseId === purchase.id &&
          item.status === RaffleNumberStatus.RESERVED &&
          (!requireCanonicalTtl ||
            item.reservedUntil?.getTime() ===
              order.reservationExpiresAt.getTime()),
      )
    );
  }

  private assertRaffleOrder(order: Order): void {
    if (order.kind !== OrderKind.RAFFLE)
      throw new DomainError(
        "RAFFLE_RESERVATION_OWNERSHIP_CONFLICT",
        "La orden no corresponde a una rifa.",
      );
  }
}
