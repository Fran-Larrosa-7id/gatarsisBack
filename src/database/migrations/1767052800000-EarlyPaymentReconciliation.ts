import { MigrationInterface, QueryRunner } from "typeorm";

export class EarlyPaymentReconciliation1767052800000
  implements MigrationInterface
{
  name = "EarlyPaymentReconciliation1767052800000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "payment_preferences" ADD "last_reconciliation_at" TIMESTAMPTZ',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_payment_preferences_early_reconciliation" ON "payment_preferences" ("status", "last_reconciliation_at")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX "IDX_payment_preferences_early_reconciliation"',
    );
    await queryRunner.query(
      'ALTER TABLE "payment_preferences" DROP COLUMN "last_reconciliation_at"',
    );
  }
}
