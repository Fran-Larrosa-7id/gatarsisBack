import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Inventory } from '../inventory/entities/inventory.entity';
import { InventoryMovement } from '../inventory/entities/inventory-movement.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Product } from '../products/entities/product.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';

const numberFromEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
};

export const databaseConfig = (): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: numberFromEnv('DATABASE_PORT', 5432),
  username: process.env.DATABASE_USER ?? 'gatarsis',
  password: process.env.DATABASE_PASSWORD ?? 'gatarsis_local_password',
  database: process.env.DATABASE_NAME ?? 'gatarsis',
  entities: [Product, ProductVariant, Inventory, InventoryMovement, Order, OrderItem],
  synchronize: false,
});

export const reservationMinutes = (): number => numberFromEnv('STOCK_RESERVATION_MINUTES', 15);
