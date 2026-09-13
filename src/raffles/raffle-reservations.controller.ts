import {
  Body,
  Controller,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import {
  RAFFLE_RESERVATION_RATE_LIMIT,
  RAFFLE_RESERVATION_RATE_WINDOW_MS,
} from "./raffle.config";
import { CreateRaffleReservationDto } from "./raffle-reservation.dto";
import { RaffleReservationsService } from "./raffle-reservations.service";

@Controller("raffles")
export class RaffleReservationsController {
  constructor(private readonly reservations: RaffleReservationsService) {}

  @Post(":raffleId/reservations")
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: {
      limit: RAFFLE_RESERVATION_RATE_LIMIT,
      ttl: RAFFLE_RESERVATION_RATE_WINDOW_MS,
    },
  })
  reserve(
    @Param("raffleId", new ParseUUIDPipe()) raffleId: string,
    @Body() dto: CreateRaffleReservationDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.reservations.reserve(raffleId, dto, idempotencyKey ?? "");
  }
}
