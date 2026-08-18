import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { PaymentsService } from "./payments.service";
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}
  @Post("checkout/:orderId/mercado-pago/preference") createPreference(
    @Param("orderId") orderId: string,
  ) {
    return this.payments.createPreference(orderId);
  }
  @Post("webhooks/mercado-pago") @HttpCode(200) webhook(
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: Record<string, string | string[] | undefined>,
  ) {
    return this.payments.receiveWebhook({ body, headers, query });
  }
  @Get("orders/:orderId/status") status(@Param("orderId") orderId: string) {
    return this.payments.status(orderId);
  }
}
