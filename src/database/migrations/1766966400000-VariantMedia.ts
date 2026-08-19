import { MigrationInterface, QueryRunner } from "typeorm";
export class VariantMedia1766966400000 implements MigrationInterface {
  name = "VariantMedia1766966400000";
  async up(q: QueryRunner) {
    await q.query('ALTER TABLE "product_media" ADD "variant_id" uuid');
    await q.query(
      'ALTER TABLE "product_media" ADD CONSTRAINT "FK_product_media_variant" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL',
    );
    await q.query('DROP INDEX IF EXISTS "UQ_product_media_one_cover"');
    await q.query(
      'CREATE UNIQUE INDEX "UQ_product_media_general_cover" ON "product_media" ("product_id") WHERE "is_cover" = true AND "variant_id" IS NULL',
    );
    await q.query(
      'CREATE UNIQUE INDEX "UQ_product_media_variant_cover" ON "product_media" ("product_id","variant_id") WHERE "is_cover" = true AND "variant_id" IS NOT NULL',
    );
    await q.query(
      'CREATE INDEX "IDX_product_media_variant_sort" ON "product_media" ("product_id","variant_id","sort_order")',
    );
  }
  async down(q: QueryRunner) {
    await q.query('ALTER TABLE "product_media" DROP COLUMN "variant_id"');
  }
}
