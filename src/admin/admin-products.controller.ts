import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { AdminProductsService } from './admin-products.service';
import { MediaDto, MediaPatchDto, ProductDto, ProductListDto, ProductPatchDto, VariantDto, VariantPatchDto } from './admin-products.dto';
import { AdminRequest } from './admin-auth.guard';
@Controller('admin') export class AdminProductsController {
  constructor(private readonly products: AdminProductsService) {}
  @Get('products') list(@Query() q: ProductListDto) { return this.products.list(q); }
  @Post('products') create(@Body() d: ProductDto, @Req() r: AdminRequest) { return this.products.createProduct(d, r.admin!.id); }
  @Get('products/:productId') product(@Param('productId', new ParseUUIDPipe()) id: string) { return this.products.product(id); }
  @Patch('products/:productId') updateProduct(@Param('productId', new ParseUUIDPipe()) id: string, @Body() d: ProductPatchDto, @Req() r: AdminRequest) { return this.products.updateProduct(id, d, r.admin!.id); }
  @Post('products/:productId/variants') createVariant(@Param('productId', new ParseUUIDPipe()) id: string, @Body() d: VariantDto, @Req() r: AdminRequest) { return this.products.createVariant(id, d, r.admin!.id); }
  @Get('variants/:variantId') variant(@Param('variantId', new ParseUUIDPipe()) id: string) { return this.products.variant(id); }
  @Patch('variants/:variantId') updateVariant(@Param('variantId', new ParseUUIDPipe()) id: string, @Body() d: VariantPatchDto, @Req() r: AdminRequest) { return this.products.updateVariant(id, d, r.admin!.id); }
  @Post('products/:productId/media') addMedia(@Param('productId', new ParseUUIDPipe()) id: string, @Body() d: MediaDto, @Req() r: AdminRequest) { return this.products.addMedia(id, d, r.admin!.id); }
  @Patch('product-media/:mediaId') updateMedia(@Param('mediaId', new ParseUUIDPipe()) id: string, @Body() d: MediaPatchDto, @Req() r: AdminRequest) { return this.products.updateMedia(id, d, r.admin!.id); }
  @Delete('product-media/:mediaId') @HttpCode(204) async deleteMedia(@Param('mediaId', new ParseUUIDPipe()) id: string, @Req() r: AdminRequest) { await this.products.removeMedia(id, r.admin!.id); }
}
