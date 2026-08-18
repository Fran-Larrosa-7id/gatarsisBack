import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { TypeOrmModule } from "@nestjs/typeorm";
import { databaseConfig } from "./config/database.config";
import { CheckoutModule } from "./checkout/checkout.module";
import { HealthModule } from "./health/health.module";
import { InventoryModule } from "./inventory/inventory.module";
import { OrdersModule } from "./orders/orders.module";
import { ProductsModule } from "./products/products.module";
import { PaymentsModule } from "./payments/payments.module";
@Module({
  imports: [
    TypeOrmModule.forRootAsync({ useFactory: databaseConfig }),
    ScheduleModule.forRoot(),
    ProductsModule,
    InventoryModule,
    OrdersModule,
    CheckoutModule,
    PaymentsModule,
    HealthModule,
  ],
})
export class AppModule {}
import "dotenv/config";
