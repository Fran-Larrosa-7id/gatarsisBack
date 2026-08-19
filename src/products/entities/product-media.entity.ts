import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Product } from "./product.entity";
import { ProductVariant } from "./product-variant.entity";

@Entity({ name: "product_media" })
export class ProductMedia {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "product_id", type: "uuid" }) productId!: string;
  @ManyToOne(() => Product, (product) => product.media, { onDelete: "CASCADE" })
  @JoinColumn({ name: "product_id" })
  product!: Product;
  @Column({ name: "variant_id", type: "uuid", nullable: true }) variantId!:
    | string
    | null;
  @ManyToOne(() => ProductVariant, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "variant_id" })
  variant!: ProductVariant | null;
  @Column({ type: "varchar" }) url!: string;
  @Column({ type: "varchar" }) alt!: string;
  @Column({ name: "sort_order", type: "integer", default: 0 })
  sortOrder!: number;
  @Column({ name: "is_cover", type: "boolean", default: false })
  isCover!: boolean;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
