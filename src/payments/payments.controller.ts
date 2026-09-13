import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from "@nestjs/common";
import { Request } from "express";
import { PaymentsService } from "./payments.service";
@Controller()
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);
  constructor(private readonly payments: PaymentsService) {}

  private firstValue(value: unknown): string | null {
    const item = Array.isArray(value) ? value[0] : value;
    return item == null ? null : String(item);
  }

  private sanitizedWebhookUrl(req: Request): string {
    const path = (req.originalUrl ?? req.url ?? "/webhooks/mercado-pago").split(
      "?",
      1,
    )[0];
    const query = req.query as Record<string, unknown>;
    const safeQuery = ["env", "type", "data.id"]
      .map((key) => [key, this.firstValue(query[key])] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== null)
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
      )
      .join("&");
    return safeQuery ? `${path}?${safeQuery}` : path;
  }

  @Post("checkout/:orderId/mercado-pago/preference") createPreference(
    @Param("orderId") orderId: string,
  ) {
    return this.payments.createPreference(orderId);
  }
  @Post("raffle-purchases/:id/mercado-pago/preference")
  createRafflePreference(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
  ) {
    return this.payments.createRafflePreference(id);
  }
  @Post("webhooks/mercado-pago") @HttpCode(200) webhook(
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    const query = req.query as Record<string, string | string[] | undefined>;
    const data =
      typeof body.data === "object" && body.data !== null
        ? (body.data as Record<string, unknown>)
        : {};
    const userAgent = req.headers["user-agent"];
    this.logger.log({
      step: "webhook_request_diagnostic",
      webhookEnvironment: this.firstValue(query.env),
      requestUrl: this.sanitizedWebhookUrl(req),
      eventType: this.firstValue(query.type) ?? this.firstValue(body.type),
      action: this.firstValue(body.action),
      liveMode: typeof body.live_mode === "boolean" ? body.live_mode : null,
      providerPaymentId:
        this.firstValue(query["data.id"]) ?? this.firstValue(data.id),
      hasXSignature: Boolean(req.headers["x-signature"]),
      hasXRequestId: Boolean(req.headers["x-request-id"]),
      userAgent: this.firstValue(userAgent),
    });
    return this.payments.receiveWebhook({
      body,
      headers: req.headers,
      query,
    });
  }
  @Get("orders/:orderId/status") status(
    @Param("orderId", new ParseUUIDPipe({ version: "4" })) orderId: string,
  ) {
    return this.payments.status(orderId);
  }
  @Get("raffle-purchases/:id/status")
  rafflePurchaseStatus(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
  ) {
    return this.payments.rafflePurchaseStatus(id);
  }
}
