import { Check, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Order } from './order.entity';
@Entity({ name: 'order_items' })
@Check('"quantity" > 0')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'order_id', type: 'uuid' }) orderId!: string;
  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'order_id' }) order!: Order;
  @Column({ name: 'variant_id', type: 'uuid' }) variantId!: string;
  @Column({ name: 'product_name_snapshot' }) productNameSnapshot!: string;
  @Column({ name: 'variant_name_snapshot' }) variantNameSnapshot!: string;
  @Column({ name: 'sku_snapshot' }) skuSnapshot!: string;
  @Column({ name: 'unit_price_in_cents', type: 'integer' }) unitPriceInCents!: number;
  @Column({ type: 'integer' }) quantity!: number;
  @Column({ name: 'line_total_in_cents', type: 'integer' }) lineTotalInCents!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
