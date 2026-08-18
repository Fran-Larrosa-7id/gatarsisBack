import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { Product } from "./entities/product.entity";
@Injectable()
export class ProductsService {
  constructor(private readonly dataSource: DataSource) {}
  async findAll() {
    return this.productsQuery().getMany();
  }
  async findBySlug(slug: string) {
    const product = await this.productsQuery()
      .andWhere("product.slug = :slug", { slug })
      .getOne();
    return product;
  }
  private productsQuery() {
    return this.dataSource
      .getRepository(Product)
      .createQueryBuilder("product")
      .leftJoinAndSelect("product.variants", "variant", "variant.active = true")
      .leftJoinAndSelect("variant.inventory", "inventory")
      .where("product.active = true")
      .orderBy("product.name", "ASC")
      .addOrderBy("variant.sku", "ASC");
  }
}
