import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminProducts1766707200000 implements MigrationInterface {
  name = 'AdminProducts1766707200000';
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "products" ADD "short_description" varchar');
    await q.query('ALTER TABLE "products" ADD "featured" boolean NOT NULL DEFAULT false');
    await q.query('ALTER TABLE "products" ADD "sort_order" integer NOT NULL DEFAULT 0');
    await q.query('ALTER TABLE "product_variants" ADD "sort_order" integer NOT NULL DEFAULT 0');
    await q.query('ALTER TABLE "product_variants" ADD "low_stock_threshold" integer');
    await q.query('CREATE TABLE "product_media" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "product_id" uuid NOT NULL, "url" varchar NOT NULL, "alt" varchar NOT NULL, "sort_order" integer NOT NULL DEFAULT 0, "is_cover" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT "PK_product_media" PRIMARY KEY ("id"), CONSTRAINT "FK_product_media_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE)');
    await q.query('CREATE UNIQUE INDEX "UQ_product_media_one_cover" ON "product_media" ("product_id") WHERE "is_cover" = true');
    await q.query('CREATE INDEX "IDX_product_media_product_sort" ON "product_media" ("product_id", "sort_order")');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE "product_media"');
    await q.query('ALTER TABLE "product_variants" DROP COLUMN "low_stock_threshold"');
    await q.query('ALTER TABLE "product_variants" DROP COLUMN "sort_order"');
    await q.query('ALTER TABLE "products" DROP COLUMN "sort_order"');
    await q.query('ALTER TABLE "products" DROP COLUMN "featured"');
    await q.query('ALTER TABLE "products" DROP COLUMN "short_description"');
  }
}
