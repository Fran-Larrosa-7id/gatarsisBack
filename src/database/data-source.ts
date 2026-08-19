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
import { AdminUser } from "../admin/entities/admin-user.entity";
import { AdminSession } from "../admin/entities/admin-session.entity";
import { AdminAuditLog } from "../admin/entities/admin-audit-log.entity";
import { InitialCommerce1766448000000 } from "./migrations/1766448000000-InitialCommerce";
import { PaymentsMercadoPago1766534400000 } from "./migrations/1766534400000-PaymentsMercadoPago";
import { AdminAuth1766620800000 } from "./migrations/1766620800000-AdminAuth";
import { AdminProducts1766707200000 } from "./migrations/1766707200000-AdminProducts";
import { AdminPaymentReview1766793600000 } from "./migrations/1766793600000-AdminPaymentReview";
import { OrderFulfillment1766880000000 } from "./migrations/1766880000000-OrderFulfillment";
import { OrderFulfillment } from "../orders/entities/order-fulfillment.entity";
import { ProductMedia } from "../products/entities/product-media.entity";
import { Product } from "../products/entities/product.entity";
import { ProductVariant } from "../products/entities/product-variant.entity";
import { RefundOperation } from "../payments/entities/refund-operation.entity";
import { RefundOperations1766880000000 } from "./migrations/1766880000000-RefundOperations";
import { VariantMedia1766966400000 } from "./migrations/1766966400000-VariantMedia";
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
    AdminUser,
    AdminSession,
    AdminAuditLog,
    OrderFulfillment,
    ProductMedia,
    RefundOperation,
  ],
  migrations: [
    InitialCommerce1766448000000,
    PaymentsMercadoPago1766534400000,
    AdminAuth1766620800000,
    AdminProducts1766707200000,
    AdminPaymentReview1766793600000,
    OrderFulfillment1766880000000,
    RefundOperations1766880000000,
    VariantMedia1766966400000,
  ],
});
