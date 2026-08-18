import { TypeOrmModuleOptions } from "@nestjs/typeorm";
import { Inventory } from "../inventory/entities/inventory.entity";
import { InventoryMovement } from "../inventory/entities/inventory-movement.entity";
import { Order } from "../orders/entities/order.entity";
import { OrderItem } from "../orders/entities/order-item.entity";
import { Payment } from "../payments/entities/payment.entity";
import { PaymentPreference } from "../payments/entities/payment-preference.entity";
import { WebhookEvent } from "../payments/entities/webhook-event.entity";
import { InitialCommerce1766448000000 } from "../database/migrations/1766448000000-InitialCommerce";
import { PaymentsMercadoPago1766534400000 } from "../database/migrations/1766534400000-PaymentsMercadoPago";
import { Product } from "../products/entities/product.entity";
import { ProductVariant } from "../products/entities/product-variant.entity";

const numberFromEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
};

export const databaseConfig = (): TypeOrmModuleOptions => ({
  type: "postgres",
  host: process.env.DATABASE_HOST ?? "localhost",
  port: numberFromEnv("DATABASE_PORT", 5432),
  username: process.env.DATABASE_USER ?? "gatarsis",
  password: process.env.DATABASE_PASSWORD ?? "gatarsis_local_password",
  database: process.env.DATABASE_NAME ?? "gatarsis",
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
  synchronize: false,
  migrations: [InitialCommerce1766448000000, PaymentsMercadoPago1766534400000],
});

export const reservationMinutes = (): number =>
  numberFromEnv("STOCK_RESERVATION_MINUTES", 15);
export const mercadoPagoConfig = () => ({
  enabled: process.env.MP_ENABLED === "true",
  accessToken: process.env.MP_ACCESS_TOKEN ?? "",
  webhookSecret: process.env.MP_WEBHOOK_SECRET ?? "",
  frontendBaseUrl: process.env.MP_FRONTEND_BASE_URL ?? "",
  excludeTicket: process.env.MP_EXCLUDE_TICKET !== "false",
  binaryMode: process.env.MP_BINARY_MODE === "true",
  reconciliationGraceSeconds: numberFromEnv(
    "MP_RECONCILIATION_GRACE_SECONDS",
    120,
  ),
  pendingReviewHours: numberFromEnv("MP_PENDING_REVIEW_HOURS", 24),
});
