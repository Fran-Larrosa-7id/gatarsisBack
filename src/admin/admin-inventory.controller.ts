import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { AdminRequest } from './admin-auth.guard';
import { AdjustDto, InventoryListDto, MovementListDto, RestockDto } from './admin-inventory.dto';
import { AdminInventoryService } from './admin-inventory.service';
@Controller('admin/inventory') export class AdminInventoryController {
  constructor(private readonly inventory: AdminInventoryService) {}
  @Get() list(@Query() q: InventoryListDto) { return this.inventory.list(q); }
  @Post(':variantId/restock') restock(@Param('variantId', new ParseUUIDPipe()) id: string, @Body() d: RestockDto, @Req() r: AdminRequest) { return this.inventory.restock(id, d, r.admin!.id); }
  @Post(':variantId/adjust') adjust(@Param('variantId', new ParseUUIDPipe()) id: string, @Body() d: AdjustDto, @Req() r: AdminRequest) { return this.inventory.adjust(id, d, r.admin!.id); }
  @Get(':variantId/movements') movements(@Param('variantId', new ParseUUIDPipe()) id: string, @Query() q: MovementListDto) { return this.inventory.movements(id, q); }
}
