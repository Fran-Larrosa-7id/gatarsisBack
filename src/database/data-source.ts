import "reflect-metadata";
import "dotenv/config";
import { DataSource } from "typeorm";
import { Inventory } from "../inventory/entities/inventory.entity";
import { InventoryMovement } from "../inventory/entities/inventory-movement.entity";
import { Order } from "../orders/entities/order.entity";
import { OrderItem } from "../orders/entities/order-item.entity";
import { Payment } from "../payments/entities/payment.entity";
import { PaymentPreference } from "../payments/entities/payment-preference.entity";
import { WebhookEvent } from "../payments/entities/webhook-event.entity";
import { InitialCommerce1766448000000 } from './migrations/1766448000000-InitialCommerce';
import { PaymentsMercadoPago1766534400000 } from './migrations/1766534400000-PaymentsMercadoPago';
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
    PaymentPreference,
    Payment,
    WebhookEvent,
  ],
  migrations: [InitialCommerce1766448000000, PaymentsMercadoPago1766534400000],
});
