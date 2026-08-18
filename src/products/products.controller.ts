import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { ProductsService } from "./products.service";
@Controller("products")
export class ProductsController {
  constructor(private readonly products: ProductsService) {}
  @Get() async findAll() {
    return (await this.products.findAll()).map((product) =>
      this.serialize(product),
    );
  }
  @Get(":slug") async findOne(@Param("slug") slug: string) {
    const product = await this.products.findBySlug(slug);
    if (!product)
      throw new NotFoundException({
        code: "PRODUCT_NOT_FOUND",
        message: "El producto no existe.",
      });
    return this.serialize(product);
  }
  private serialize(
    product: Awaited<ReturnType<ProductsService["findAll"]>>[number],
  ) {
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      variants: product.variants.map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        name: variant.name,
        color: variant.color,
        size: variant.size,
        priceInCents: variant.priceInCents,
        availableStock: Math.max(
          0,
          (variant.inventory?.stockOnHand ?? 0) -
            (variant.inventory?.reservedStock ?? 0),
        ),
      })),
    };
  }
}
