import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module";
import {
  MercadoPagoGateway,
  MERCADO_PAGO_GATEWAY,
} from "./mercado-pago.gateway";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
@Module({
  imports: [InventoryModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    MercadoPagoGateway,
    { provide: MERCADO_PAGO_GATEWAY, useExisting: MercadoPagoGateway },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
