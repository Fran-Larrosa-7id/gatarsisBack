import { Body, Controller, Headers, Post, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { ReserveCheckoutDto } from "./dto/reserve-checkout.dto";
import { CheckoutService } from "./checkout.service";
import { CHECKOUT_RATE_LIMIT, CHECKOUT_RATE_WINDOW_MS } from "./checkout-limits";
@Controller("checkout")
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}
  @Post("reserve")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: CHECKOUT_RATE_LIMIT, ttl: CHECKOUT_RATE_WINDOW_MS } })
  reserve(
    @Body() dto: ReserveCheckoutDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.checkout.reserve(dto, key ?? "");
  }
}
