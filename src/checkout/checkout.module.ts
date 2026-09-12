import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { InventoryModule } from "../inventory/inventory.module";
import { CheckoutController } from "./checkout.controller";
import { CheckoutService } from "./checkout.service";
@Module({
  imports: [InventoryModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
  controllers: [CheckoutController],
  providers: [CheckoutService],
})
export class CheckoutModule {}
