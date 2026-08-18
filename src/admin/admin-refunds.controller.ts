import {
  Body,
  Controller,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from "@nestjs/common";
import { AdminRequest } from "./admin-auth.guard";
import { CreateRefundDto } from "./admin-refunds.dto";
import { AdminRefundsService } from "./admin-refunds.service";
@Controller("admin/payments")
export class AdminRefundsController {
  constructor(private readonly refunds: AdminRefundsService) {}
  @Post(":paymentId/refund") refund(
    @Param("paymentId", new ParseUUIDPipe()) paymentId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: CreateRefundDto,
    @Req() request: AdminRequest,
  ) {
    return this.refunds.refund(
      paymentId,
      request.admin!.id,
      key ?? "",
      body.reason,
    );
  }
}
