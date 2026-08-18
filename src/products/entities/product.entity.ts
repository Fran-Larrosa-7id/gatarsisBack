import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { ProductVariant } from "./product-variant.entity";
import { ProductMedia } from './product-media.entity';

@Entity({ name: "products" })
export class Product {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ unique: true }) slug!: string;
  @Column() name!: string;
  @Column({ default: true }) active!: boolean;
  @Column({ name: 'short_description', type: 'varchar', nullable: true }) shortDescription!: string | null;
  @Column({ default: false }) featured!: boolean;
  @Column({ name: 'sort_order', type: 'integer', default: 0 }) sortOrder!: number;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
  @OneToMany(() => ProductVariant, (variant) => variant.product)
  variants!: ProductVariant[];
  @OneToMany(() => ProductMedia, (media) => media.product)
  media!: ProductMedia[];
}
