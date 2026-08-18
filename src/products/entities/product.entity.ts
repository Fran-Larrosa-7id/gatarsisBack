import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { ProductVariant } from "./product-variant.entity";

@Entity({ name: "products" })
export class Product {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ unique: true }) slug!: string;
  @Column() name!: string;
  @Column({ default: true }) active!: boolean;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
  @OneToMany(() => ProductVariant, (variant) => variant.product)
  variants!: ProductVariant[];
}
