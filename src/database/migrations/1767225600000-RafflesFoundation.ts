import { MigrationInterface, QueryRunner } from "typeorm";

export class RafflesFoundation1767225600000 implements MigrationInterface {
  name = "RafflesFoundation1767225600000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "orders_kind_enum" AS ENUM ('MERCH', 'RAFFLE')`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "kind" "orders_kind_enum" NOT NULL DEFAULT 'MERCH'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_kind_status_reservation_expires_at" ON "orders" ("kind", "status", "reservation_expires_at")`,
    );

    await queryRunner.query(
      `CREATE TYPE "raffles_status_enum" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED', 'DRAWN')`,
    );
    await queryRunner.query(
      `CREATE TYPE "raffle_numbers_status_enum" AS ENUM ('AVAILABLE', 'RESERVED', 'SOLD')`,
    );
    await queryRunner.query(`
      CREATE TABLE "raffles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "title" varchar(160) NOT NULL,
        "prize_name" varchar(160) NOT NULL,
        "description" text,
        "image_url" text,
        "price_in_cents" integer NOT NULL,
        "status" "raffles_status_enum" NOT NULL DEFAULT 'DRAFT',
        "draw_at" TIMESTAMPTZ,
        "winning_number" smallint,
        "drawn_at" TIMESTAMPTZ,
        "drawn_by_admin_id" uuid,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_raffles" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_raffles_price_positive" CHECK ("price_in_cents" > 0),
        CONSTRAINT "CHK_raffles_winning_number_range" CHECK ("winning_number" IS NULL OR "winning_number" BETWEEN 0 AND 99),
        CONSTRAINT "FK_raffles_drawn_by_admin" FOREIGN KEY ("drawn_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_raffles_status_created_at" ON "raffles" ("status", "created_at" DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE "raffle_purchases" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "raffle_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "buyer_name" varchar(160) NOT NULL,
        "buyer_email" varchar(320) NOT NULL,
        "buyer_phone" varchar(80) NOT NULL,
        "unit_price_in_cents" integer NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_raffle_purchases" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_raffle_purchases_order_id" UNIQUE ("order_id"),
        CONSTRAINT "CHK_raffle_purchases_unit_price_positive" CHECK ("unit_price_in_cents" > 0),
        CONSTRAINT "FK_raffle_purchases_raffle" FOREIGN KEY ("raffle_id") REFERENCES "raffles"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_raffle_purchases_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_raffle_purchases_raffle_created_at" ON "raffle_purchases" ("raffle_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_raffle_purchases_buyer_email_created_at" ON "raffle_purchases" ("buyer_email", "created_at" DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE "raffle_numbers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "raffle_id" uuid NOT NULL,
        "number" smallint NOT NULL,
        "status" "raffle_numbers_status_enum" NOT NULL DEFAULT 'AVAILABLE',
        "raffle_purchase_id" uuid,
        "reserved_until" TIMESTAMPTZ,
        "reserved_at" TIMESTAMPTZ,
        "sold_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_raffle_numbers" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_raffle_numbers_raffle_number" UNIQUE ("raffle_id", "number"),
        CONSTRAINT "CHK_raffle_numbers_number_range" CHECK ("number" BETWEEN 0 AND 99),
        CONSTRAINT "FK_raffle_numbers_raffle" FOREIGN KEY ("raffle_id") REFERENCES "raffles"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_raffle_numbers_purchase" FOREIGN KEY ("raffle_purchase_id") REFERENCES "raffle_purchases"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_raffle_numbers_raffle_status_number" ON "raffle_numbers" ("raffle_id", "status", "number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_raffle_numbers_purchase_id" ON "raffle_numbers" ("raffle_purchase_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_raffle_numbers_reserved_until_reserved" ON "raffle_numbers" ("reserved_until") WHERE "status" = 'RESERVED'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "raffle_numbers"`);
    await queryRunner.query(`DROP TABLE "raffle_purchases"`);
    await queryRunner.query(`DROP TABLE "raffles"`);
    await queryRunner.query(`DROP TYPE "raffle_numbers_status_enum"`);
    await queryRunner.query(`DROP TYPE "raffles_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_orders_kind_status_reservation_expires_at"`,
    );
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "kind"`);
    await queryRunner.query(`DROP TYPE "orders_kind_enum"`);
  }
}
