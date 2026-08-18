import { MigrationInterface, QueryRunner } from "typeorm";
export class PaymentsMercadoPago1766534400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "orders" ADD "paid_at" TIMESTAMPTZ`);
    await q.query(
      `CREATE TYPE "payment_preferences_status_enum" AS ENUM ('CREATING','READY','FAILED','EXPIRED','REQUIRES_REVIEW')`,
    );
    await q.query(
      `CREATE TABLE "payment_preferences" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "order_id" uuid NOT NULL, "provider" varchar NOT NULL DEFAULT 'mercado_pago', "provider_preference_id" varchar, "status" "payment_preferences_status_enum" NOT NULL, "init_point" text, "last_error_code" varchar, "last_error_at" TIMESTAMPTZ, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "ready_at" TIMESTAMPTZ, CONSTRAINT "PK_payment_preferences" PRIMARY KEY ("id"), CONSTRAINT "UQ_payment_preferences_order" UNIQUE ("order_id"), CONSTRAINT "UQ_payment_preferences_provider" UNIQUE ("provider_preference_id"), CONSTRAINT "FK_payment_preferences_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT)`,
    );
    await q.query(
      `CREATE TYPE "payments_processing_status_enum" AS ENUM ('RECEIVED','RECORDED','APPLIED','REQUIRES_REVIEW')`,
    );
    await q.query(
      `CREATE TABLE "payments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "order_id" uuid NOT NULL, "provider" varchar NOT NULL DEFAULT 'mercado_pago', "provider_payment_id" varchar NOT NULL, "provider_status" varchar NOT NULL, "provider_status_detail" varchar, "processing_status" "payments_processing_status_enum" NOT NULL, "transaction_amount_in_cents" integer NOT NULL, "currency_id" varchar NOT NULL, "external_reference" varchar, "payment_method_id" varchar, "payment_type_id" varchar, "date_created" TIMESTAMPTZ, "date_approved" TIMESTAMPTZ, "date_last_updated" TIMESTAMPTZ, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT "PK_payments" PRIMARY KEY ("id"), CONSTRAINT "UQ_payments_provider_payment" UNIQUE ("provider", "provider_payment_id"), CONSTRAINT "FK_payments_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT)`,
    );
    await q.query(
      `CREATE INDEX "IDX_payments_order" ON "payments" ("order_id")`,
    );
    await q.query(
      `CREATE TYPE "webhook_events_status_enum" AS ENUM ('PENDING','PROCESSING','PROCESSED','RETRY','DEAD_LETTER')`,
    );
    await q.query(
      `CREATE TABLE "webhook_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "provider" varchar NOT NULL DEFAULT 'mercado_pago', "provider_event_id" varchar, "provider_resource_id" varchar NOT NULL, "type" varchar NOT NULL, "action" varchar, "request_id" varchar, "status" "webhook_events_status_enum" NOT NULL, "attempts" integer NOT NULL DEFAULT 0, "next_attempt_at" TIMESTAMPTZ, "last_error" varchar, "payload" jsonb, "received_at" TIMESTAMPTZ NOT NULL, "processed_at" TIMESTAMPTZ, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT "PK_webhook_events" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_webhook_events_provider_event" ON "webhook_events" ("provider", "provider_event_id") WHERE "provider_event_id" IS NOT NULL`,
    );
    await q.query(
      `CREATE INDEX "IDX_webhook_events_resource" ON "webhook_events" ("provider_resource_id")`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "webhook_events"`);
    await q.query(`DROP TYPE "webhook_events_status_enum"`);
    await q.query(`DROP TABLE "payments"`);
    await q.query(`DROP TYPE "payments_processing_status_enum"`);
    await q.query(`DROP TABLE "payment_preferences"`);
    await q.query(`DROP TYPE "payment_preferences_status_enum"`);
    await q.query(`ALTER TABLE "orders" DROP COLUMN "paid_at"`);
  }
}
