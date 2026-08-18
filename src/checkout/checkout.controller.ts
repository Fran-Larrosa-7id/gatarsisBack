import { Body, Controller, Headers, Post } from "@nestjs/common";
import { ReserveCheckoutDto } from "./dto/reserve-checkout.dto";
import { CheckoutService } from "./checkout.service";
@Controller("checkout")
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}
  @Post("reserve") reserve(
    @Body() dto: ReserveCheckoutDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.checkout.reserve(dto, key ?? "");
  }
}
