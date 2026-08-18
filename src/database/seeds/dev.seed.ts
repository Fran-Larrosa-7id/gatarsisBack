import { AppDataSource } from "../data-source";
import { Inventory } from "../../inventory/entities/inventory.entity";
import { ProductVariant } from "../../products/entities/product-variant.entity";
import { Product } from "../../products/entities/product.entity";
async function seed() {
  await AppDataSource.initialize();
  const products = AppDataSource.getRepository(Product);
  const variants = AppDataSource.getRepository(ProductVariant);
  const inventory = AppDataSource.getRepository(Inventory);
  if (await products.findOneBy({ slug: "producto-de-prueba" })) return;
  const product = await products.save({
    slug: "producto-de-prueba",
    name: "Producto de prueba",
    active: true,
  });
  for (const [sku, name, stock, priceInCents] of [
    ["SKU-TEST-A", "Variante de prueba A", 10, 150],
    ["SKU-TEST-B", "Variante de prueba B", 1, 150],
  ] as const) {
    const variant = await variants.save({
      productId: product.id,
      sku,
      name,
      color: null,
      size: null,
      priceInCents,
      active: true,
    });
    await inventory.save({
      variantId: variant.id,
      stockOnHand: stock,
      reservedStock: 0,
    });
  }
}
void seed()
  .then(() => AppDataSource.destroy())
  .catch(async (error) => {
    console.error(error);
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    process.exitCode = 1;
  });
