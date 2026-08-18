import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { DomainError } from "../common/domain-error";
import { Inventory } from "./entities/inventory.entity";
import {
  InventoryMovement,
  InventoryMovementType,
} from "./entities/inventory-movement.entity";

@Injectable()
export class InventoryService {
  constructor(private readonly dataSource: DataSource) {}
  async reserveStock(
    manager: EntityManager,
    variantId: string,
    quantity: number,
    orderId: string,
  ): Promise<void> {
    const result = await manager
      .createQueryBuilder()
      .update(Inventory)
      .set({ reservedStock: () => `reserved_stock + ${quantity}` })
      .where(
        "variant_id = :variantId AND stock_on_hand - reserved_stock >= :quantity",
        { variantId, quantity },
      )
      .execute();
    if (result.affected !== 1) {
      const inventory = await manager.findOneBy(Inventory, { variantId });
      throw new DomainError(
        "OUT_OF_STOCK",
        "No hay stock suficiente para una de las variantes solicitadas.",
        {
          variantId,
          requested: quantity,
          available: inventory
            ? inventory.stockOnHand - inventory.reservedStock
            : 0,
        },
      );
    }
    await manager.save(InventoryMovement, {
      variantId,
      orderId,
      type: InventoryMovementType.RESERVE,
      onHandDelta: 0,
      reservedDelta: quantity,
      reason: null,
    });
  }

  /**
   *
   * @param manager
   * @param variantId
   * @param quantity
   * @param orderId
   * @param reason
   */
  async releaseReservation(
    manager: EntityManager,
    variantId: string,
    quantity: number,
    orderId: string,
    reason = "Reservation expired",
  ): Promise<void> {
    const result = await manager
      .createQueryBuilder()
      .update(Inventory)
      .set({ reservedStock: () => `reserved_stock - ${quantity}` })
      .where("variant_id = :variantId AND reserved_stock >= :quantity", {
        variantId,
        quantity,
      })
      .execute();
    if (result.affected !== 1)
      throw new Error(
        `Inventory reservation invariant violated for ${variantId}`,
      );
    await manager.save(InventoryMovement, {
      variantId,
      orderId,
      type: InventoryMovementType.RELEASE,
      onHandDelta: 0,
      reservedDelta: -quantity,
      reason,
    });
  }

  /**
   *
   * @param variantId
   * @param quantity
   * @param reason
   */
  async restock(
    variantId: string,
    quantity: number,
    reason: string,
  ): Promise<void> {
    if (!Number.isInteger(quantity) || quantity <= 0)
      throw new DomainError(
        "INVALID_STOCK_ADJUSTMENT",
        "La reposición debe ser un entero positivo.",
        undefined,
        400,
      );
    await this.inTransaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(Inventory)
        .set({ stockOnHand: () => `stock_on_hand + ${quantity}` })
        .where("variant_id = :variantId", { variantId })
        .execute();
      if (result.affected !== 1)
        throw new DomainError(
          "VARIANT_NOT_FOUND",
          "La variante no existe.",
          { variantId },
          404,
        );
      await manager.save(InventoryMovement, {
        variantId,
        orderId: null,
        type: InventoryMovementType.RESTOCK,
        onHandDelta: quantity,
        reservedDelta: 0,
        reason,
      });
    });
  }

  // Internal-only foundation for future authenticated admin operations.
  async adjustStock(
    variantId: string,
    quantityDelta: number,
    reason: string,
  ): Promise<void> {
    if (
      !reason?.trim() ||
      !Number.isInteger(quantityDelta) ||
      quantityDelta === 0
    )
      throw new DomainError(
        "INVALID_STOCK_ADJUSTMENT",
        "El ajuste requiere cantidad entera distinta de cero y motivo.",
        undefined,
        400,
      );
    await this.inTransaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(Inventory)
        .set({ stockOnHand: () => `stock_on_hand + ${quantityDelta}` })
        .where(
          "variant_id = :variantId AND stock_on_hand + :delta >= reserved_stock",
          { variantId, delta: quantityDelta },
        )
        .execute();
      if (result.affected !== 1)
        throw new DomainError(
          "INVALID_STOCK_ADJUSTMENT",
          "El ajuste dejaría stock por debajo de lo reservado.",
          { variantId },
        );
      await manager.save(InventoryMovement, {
        variantId,
        orderId: null,
        type: InventoryMovementType.ADJUSTMENT,
        onHandDelta: quantityDelta,
        reservedDelta: 0,
        reason,
      });
    });
  }

  private async inTransaction<T>(
    operation: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(operation);
  }
}
