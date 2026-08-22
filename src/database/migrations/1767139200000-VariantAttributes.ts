import { MigrationInterface, QueryRunner } from "typeorm";

export class VariantAttributes1767139200000 implements MigrationInterface {
  name = "VariantAttributes1767139200000";
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "product_variants" ADD "attributes" jsonb NOT NULL DEFAULT \'{}\'');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "product_variants" DROP COLUMN "attributes"');
  }
}
