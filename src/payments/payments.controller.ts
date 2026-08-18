import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { Request } from 'express';
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
    @Req() req: Request,
  ) {
    return this.payments.receiveWebhook({
      body,
      headers: req.headers,
      query: req.query as Record<string, string | string[] | undefined>,
    });
  }
  @Get("orders/:orderId/status") status(@Param("orderId") orderId: string) {
    return this.payments.status(orderId);
  }
}
