import { MigrationInterface, QueryRunner } from "typeorm";
export class InitialCommerce1766448000000 implements MigrationInterface {
  name = "InitialCommerce1766448000000";
  async up(q: QueryRunner): Promise<void> {
    await q.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await q.query(
      `CREATE TYPE "inventory_movements_type_enum" AS ENUM ('RESTOCK','RESERVE','RELEASE','SALE','ADJUSTMENT')`,
    );
    await q.query(
      `CREATE TYPE "orders_status_enum" AS ENUM ('AWAITING_PAYMENT','PAYMENT_PENDING','PAID','EXPIRED','CANCELLED','REFUNDED')`,
    );
    await q.query(
      `CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "slug" varchar NOT NULL, "name" varchar NOT NULL, "active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT "UQ_products_slug" UNIQUE ("slug"), CONSTRAINT "PK_products" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE TABLE "product_variants" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "product_id" uuid NOT NULL, "sku" varchar NOT NULL, "name" varchar NOT NULL, "color" varchar, "size" varchar, "price_in_cents" integer NOT NULL, "active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT "UQ_product_variants_sku" UNIQUE ("sku"), CONSTRAINT "PK_product_variants" PRIMARY KEY ("id"), CONSTRAINT "FK_variants_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT)`,
    );
    await q.query(
      `CREATE TABLE "inventory" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "variant_id" uuid NOT NULL, "stock_on_hand" integer NOT NULL DEFAULT 0, "reserved_stock" integer NOT NULL DEFAULT 0, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT "UQ_inventory_variant" UNIQUE ("variant_id"), CONSTRAINT "CHK_inventory_on_hand" CHECK ("stock_on_hand" >= 0), CONSTRAINT "CHK_inventory_reserved" CHECK ("reserved_stock" >= 0), CONSTRAINT "CHK_inventory_reserved_not_above_on_hand" CHECK ("reserved_stock" <= "stock_on_hand"), CONSTRAINT "PK_inventory" PRIMARY KEY ("id"), CONSTRAINT "FK_inventory_variant" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT)`,
    );
    await q.query(
      `CREATE TABLE "orders" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "status" "orders_status_enum" NOT NULL, "idempotency_key" varchar NOT NULL, "request_fingerprint" varchar, "subtotal_in_cents" integer NOT NULL, "total_in_cents" integer NOT NULL, "reservation_expires_at" TIMESTAMPTZ NOT NULL, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT "UQ_orders_idempotency" UNIQUE ("idempotency_key"), CONSTRAINT "PK_orders" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE INDEX "IDX_orders_expiration" ON "orders" ("status", "reservation_expires_at")`,
    );
    await q.query(
      `CREATE TABLE "order_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "order_id" uuid NOT NULL, "variant_id" uuid NOT NULL, "product_name_snapshot" varchar NOT NULL, "variant_name_snapshot" varchar NOT NULL, "sku_snapshot" varchar NOT NULL, "unit_price_in_cents" integer NOT NULL, "quantity" integer NOT NULL, "line_total_in_cents" integer NOT NULL, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT "CHK_order_item_quantity" CHECK ("quantity" > 0), CONSTRAINT "PK_order_items" PRIMARY KEY ("id"), CONSTRAINT "FK_order_items_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT, CONSTRAINT "FK_order_items_variant" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT)`,
    );
    await q.query(
      'CREATE INDEX "IDX_order_items_order" ON "order_items" ("order_id")',
    );
    await q.query(
      `CREATE TABLE "inventory_movements" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "variant_id" uuid NOT NULL, "order_id" uuid, "type" "inventory_movements_type_enum" NOT NULL, "on_hand_delta" integer NOT NULL DEFAULT 0, "reserved_delta" integer NOT NULL DEFAULT 0, "reason" varchar, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT "PK_inventory_movements" PRIMARY KEY ("id"), CONSTRAINT "FK_movements_variant" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT, CONSTRAINT "FK_movements_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT)`,
    );
    await q.query(
      'CREATE INDEX "IDX_movements_variant" ON "inventory_movements" ("variant_id")',
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE "inventory_movements"');
    await q.query('DROP TABLE "order_items"');
    await q.query('DROP TABLE "orders"');
    await q.query('DROP TABLE "inventory"');
    await q.query('DROP TABLE "product_variants"');
    await q.query('DROP TABLE "products"');
    await q.query('DROP TYPE "orders_status_enum"');
    await q.query('DROP TYPE "inventory_movements_type_enum"');
  }
}
