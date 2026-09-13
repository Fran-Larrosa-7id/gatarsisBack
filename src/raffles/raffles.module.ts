import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { AdminRafflesController } from "./admin-raffles.controller";
import { RaffleReservationsController } from "./raffle-reservations.controller";
import { RaffleReservationsService } from "./raffle-reservations.service";
import { RafflesService } from "./raffles.service";

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
  controllers: [AdminRafflesController, RaffleReservationsController],
  providers: [RafflesService, RaffleReservationsService],
})
export class RafflesModule {}
