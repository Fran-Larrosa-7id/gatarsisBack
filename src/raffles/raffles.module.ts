import { Module } from "@nestjs/common";
import { AdminRafflesController } from "./admin-raffles.controller";
import { RafflesService } from "./raffles.service";

@Module({
  controllers: [AdminRafflesController],
  providers: [RafflesService],
})
export class RafflesModule {}
