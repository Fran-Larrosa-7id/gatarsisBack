import { MigrationInterface, QueryRunner } from "typeorm";
export class RefundOperations1766880000000 implements MigrationInterface {
  name = "RefundOperations1766880000000";
  async up(q: QueryRunner) {
    await q.query(
      `CREATE TYPE "refund_operations_status_enum" AS ENUM ('REQUESTING','SUCCEEDED','FAILED','REQUIRES_REVIEW')`,
    );
    await q.query(
      `CREATE TABLE "refund_operations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "payment_id" uuid NOT NULL, "order_id" uuid NOT NULL, "admin_user_id" uuid NOT NULL, "idempotency_key" varchar NOT NULL, "amount_in_cents" integer NOT NULL, "reason" text NOT NULL, "status" "refund_operations_status_enum" NOT NULL, "provider_refund_id" varchar, "last_error" text, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "completed_at" TIMESTAMPTZ, CONSTRAINT "UQ_refund_operations_idempotency" UNIQUE ("idempotency_key"), CONSTRAINT "CHK_refund_amount_positive" CHECK ("amount_in_cents" > 0), CONSTRAINT "PK_refund_operations" PRIMARY KEY ("id"), CONSTRAINT "FK_refund_payment" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT, CONSTRAINT "FK_refund_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT, CONSTRAINT "FK_refund_admin" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT)`,
    );
    await q.query(
      'CREATE INDEX "IDX_refund_payment" ON "refund_operations" ("payment_id")',
    );
    await q.query(
      'CREATE INDEX "IDX_refund_order" ON "refund_operations" ("order_id")',
    );
    await q.query(
      'CREATE INDEX "IDX_refund_status" ON "refund_operations" ("status")',
    );
  }
  async down(q: QueryRunner) {
    await q.query('DROP TABLE "refund_operations"');
    await q.query('DROP TYPE "refund_operations_status_enum"');
  }
}
