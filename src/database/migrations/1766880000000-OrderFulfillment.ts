import { MigrationInterface, QueryRunner } from "typeorm";
export class OrderFulfillment1766880000000 implements MigrationInterface {
  name = "OrderFulfillment1766880000000";
  async up(q: QueryRunner) {
    await q.query(
      `CREATE TYPE "order_fulfillments_method_enum" AS ENUM ('PICKUP')`,
    );
    await q.query(
      `CREATE TYPE "order_fulfillments_status_enum" AS ENUM ('PENDING','READY_FOR_PICKUP','COMPLETED')`,
    );
    await q.query(
      `CREATE TABLE "order_fulfillments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(),"order_id" uuid NOT NULL,"method" "order_fulfillments_method_enum" NOT NULL,"status" "order_fulfillments_status_enum" NOT NULL,"customer_name" varchar NOT NULL,"customer_email" varchar NOT NULL,"customer_phone" varchar NOT NULL,"customer_note" varchar,"admin_note" varchar,"ready_at" TIMESTAMPTZ,"completed_at" TIMESTAMPTZ,"created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),"updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),CONSTRAINT "UQ_order_fulfillment_order" UNIQUE ("order_id"),CONSTRAINT "PK_order_fulfillments" PRIMARY KEY ("id"),CONSTRAINT "FK_order_fulfillment_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT)`,
    );
    await q.query(
      'CREATE INDEX "IDX_order_fulfillment_status" ON "order_fulfillments" ("status")',
    );
  }
  async down(q: QueryRunner) {
    await q.query('DROP TABLE "order_fulfillments"');
    await q.query('DROP TYPE "order_fulfillments_status_enum"');
    await q.query('DROP TYPE "order_fulfillments_method_enum"');
  }
}
