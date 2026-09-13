import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { mercadoPagoConfig } from "../config/database.config";
@Controller("health")
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}
  @Get() async health() {
    try {
      await this.dataSource.query("SELECT 1");
    } catch {
      throw new ServiceUnavailableException({
        status: "error",
        database: "unavailable",
      });
    }
    const config = mercadoPagoConfig();
    return {
      status: "ok",
      mercadoPagoConfigured: Boolean(
        config.enabled &&
        config.accessToken &&
        config.webhookSecret &&
        config.frontendUrl,
      ),
    };
  }
}
