import "reflect-metadata";
import "dotenv/config";
import { DataSource } from "typeorm";
import { Inventory } from "../inventory/entities/inventory.entity";
import { InventoryMovement } from "../inventory/entities/inventory-movement.entity";
import { Order } from "../orders/entities/order.entity";
import { OrderItem } from "../orders/entities/order-item.entity";
import { Product } from "../products/entities/product.entity";
import { ProductVariant } from "../products/entities/product-variant.entity";
export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DATABASE_HOST ?? "localhost",
  port: Number(process.env.DATABASE_PORT ?? 5432),
  username: process.env.DATABASE_USER ?? "gatarsis",
  password: process.env.DATABASE_PASSWORD ?? "gatarsis_local_password",
  database: process.env.DATABASE_NAME ?? "gatarsis",
  synchronize: false,
  entities: [
    Product,
    ProductVariant,
    Inventory,
    InventoryMovement,
    Order,
    OrderItem,
  ],
  migrations: ["src/database/migrations/*.ts"],
});
