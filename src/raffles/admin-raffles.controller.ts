import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { AdminRequest } from "../admin/admin-auth.guard";
import { CreateRaffleDto, RaffleListDto, UpdateRaffleDto } from "./raffles.dto";
import { RafflesService } from "./raffles.service";

@Controller("admin/raffles")
export class AdminRafflesController {
  constructor(private readonly raffles: RafflesService) {}

  @Post()
  create(@Body() dto: CreateRaffleDto, @Req() request: AdminRequest) {
    return this.raffles.create(dto, request.admin!.id);
  }

  @Get()
  list(@Query() query: RaffleListDto) {
    return this.raffles.list(query);
  }

  @Get(":id")
  detail(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.raffles.detail(id);
  }

  @Patch(":id")
  update(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateRaffleDto,
    @Req() request: AdminRequest,
  ) {
    return this.raffles.update(id, dto, request.admin!.id);
  }
}
