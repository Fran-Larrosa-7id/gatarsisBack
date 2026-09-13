import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { PublicRafflesService } from "./public-raffles.service";

@Controller("raffles")
@UseGuards(ThrottlerGuard)
export class PublicRafflesController {
  constructor(private readonly raffles: PublicRafflesService) {}

  @Get("active")
  @Header("Cache-Control", "no-store")
  active() {
    return this.raffles.active();
  }

  @Get("latest")
  @Header("Cache-Control", "no-store")
  latest() {
    return this.raffles.latest();
  }

  @Get(":id")
  @Header("Cache-Control", "no-store")
  detail(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.raffles.detail(id);
  }

  @Get(":id/numbers")
  @Header("Cache-Control", "no-store")
  numbers(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.raffles.numbers(id);
  }
}
