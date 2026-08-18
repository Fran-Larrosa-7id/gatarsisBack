import { Check, Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ProductVariant } from '../../products/entities/product-variant.entity';

@Entity({ name: 'inventory' })
@Check('"stock_on_hand" >= 0')
@Check('"reserved_stock" >= 0')
@Check('"reserved_stock" <= "stock_on_hand"')
export class Inventory {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'variant_id', type: 'uuid', unique: true }) variantId!: string;
  @OneToOne(() => ProductVariant, (variant) => variant.inventory, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'variant_id' }) variant!: ProductVariant;
  @Column({ name: 'stock_on_hand', type: 'integer', default: 0 }) stockOnHand!: number;
  @Column({ name: 'reserved_stock', type: 'integer', default: 0 }) reservedStock!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
