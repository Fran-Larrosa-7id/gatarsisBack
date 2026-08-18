import { Injectable } from "@nestjs/common";
import {
  MercadoPagoConfig,
  Payment,
  Preference,
  WebhookSignatureValidator,
} from "mercadopago";
import { mercadoPagoConfig } from "../config/database.config";

export const MERCADO_PAGO_GATEWAY = Symbol("MERCADO_PAGO_GATEWAY");
export type MercadoPagoPayment = {
  id: string;
  status: string;
  status_detail?: string;
  transaction_amount: number;
  currency_id: string;
  external_reference?: string;
  payment_method_id?: string;
  payment_type_id?: string;
  date_created?: string;
  date_approved?: string;
  date_last_updated?: string;
};
export type MercadoPagoPreference = { id: string; init_point: string };
export interface MercadoPagoGatewayContract {
  createPreference(
    input: Record<string, unknown>,
  ): Promise<MercadoPagoPreference>;
  searchPreferencesByExternalReference(
    orderId: string,
  ): Promise<MercadoPagoPreference[]>;
  getPayment(paymentId: string): Promise<MercadoPagoPayment>;
  searchPaymentsByExternalReference(
    orderId: string,
  ): Promise<MercadoPagoPayment[]>;
  validateWebhookSignature(input: {
    xSignature?: string | string[];
    xRequestId?: string | string[];
    dataId?: string | string[];
  }): void;
}
@Injectable()
export class MercadoPagoGateway implements MercadoPagoGatewayContract {
  private readonly config = mercadoPagoConfig();
  private readonly client = new MercadoPagoConfig({
    accessToken: this.config.accessToken,
    options: { timeout: 5000 },
  });
  private readonly preferences = new Preference(this.client);
  private readonly payments = new Payment(this.client);
  private ensureEnabled() {
    if (!this.config.enabled || !this.config.accessToken)
      throw new Error("Mercado Pago is not enabled or configured");
  }
  async createPreference(
    input: Record<string, unknown>,
  ): Promise<MercadoPagoPreference> {
    this.ensureEnabled();
    const response = await this.preferences.create({ body: input as never });
    return { id: String(response.id), init_point: String(response.init_point) };
  }
  async searchPreferencesByExternalReference(
    orderId: string,
  ): Promise<MercadoPagoPreference[]> {
    this.ensureEnabled();
    const response = await this.preferences.search({
      options: { external_reference: orderId },
    });
    const details = await Promise.all(
      (response.elements ?? []).map((item) =>
        this.preferences.get({ preferenceId: item.id }),
      ),
    );
    return details
      .filter((item) => item.id && item.init_point)
      .map((item) => ({
        id: String(item.id),
        init_point: String(item.init_point),
      }));
  }
  async getPayment(paymentId: string): Promise<MercadoPagoPayment> {
    this.ensureEnabled();
    const response = await this.payments.get({ id: paymentId });
    if (
      response.id == null ||
      !response.status ||
      response.transaction_amount == null ||
      !response.currency_id
    )
      throw new Error("Mercado Pago returned an incomplete payment");
    return {
      id: String(response.id),
      status: response.status,
      status_detail: response.status_detail,
      transaction_amount: response.transaction_amount,
      currency_id: response.currency_id,
      external_reference: response.external_reference,
      payment_method_id: response.payment_method_id,
      payment_type_id: response.payment_type_id,
      date_created: response.date_created,
      date_approved: response.date_approved,
      date_last_updated: response.date_last_updated,
    };
  }
  async searchPaymentsByExternalReference(
    orderId: string,
  ): Promise<MercadoPagoPayment[]> {
    this.ensureEnabled();
    const response = await this.payments.search({
      options: { external_reference: orderId },
    });
    return (response.results ?? []) as MercadoPagoPayment[];
  }
  validateWebhookSignature(input: {
    xSignature?: string | string[];
    xRequestId?: string | string[];
    dataId?: string | string[];
  }): void {
    if (!this.config.enabled || !this.config.webhookSecret)
      throw new Error("Mercado Pago webhook is not configured");
    WebhookSignatureValidator.validate({
      xSignature: input.xSignature,
      xRequestId: input.xRequestId,
      dataId: input.dataId,
      secret: this.config.webhookSecret,
      toleranceSeconds: 300,
    });
  }
}
