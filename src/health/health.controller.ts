import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { DataSource } from "typeorm";
@Controller("health")
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}
  @Get() async health() {
    try {
      await this.dataSource.query("SELECT 1");
      return { status: "ok" };
    } catch {
      throw new ServiceUnavailableException({
        status: "error",
        database: "unavailable",
      });
    }
  }
}
