import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module";
import { RafflesModule } from "../raffles/raffles.module";
import { OrdersService } from "./orders.service";
@Module({
  imports: [InventoryModule, RafflesModule],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
