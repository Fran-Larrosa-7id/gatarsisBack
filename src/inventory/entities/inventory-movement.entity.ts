import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
export enum InventoryMovementType { RESTOCK = 'RESTOCK', RESERVE = 'RESERVE', RELEASE = 'RELEASE', SALE = 'SALE', ADJUSTMENT = 'ADJUSTMENT' }
@Entity({ name: 'inventory_movements' })
export class InventoryMovement {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'variant_id', type: 'uuid' }) variantId!: string;
  @Column({ name: 'order_id', type: 'uuid', nullable: true }) orderId!: string | null;
  @Column({ type: 'enum', enum: InventoryMovementType }) type!: InventoryMovementType;
  @Column({ name: 'on_hand_delta', type: 'integer', default: 0 }) onHandDelta!: number;
  @Column({ name: 'reserved_delta', type: 'integer', default: 0 }) reservedDelta!: number;
  @Column({ nullable: true }) reason!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
