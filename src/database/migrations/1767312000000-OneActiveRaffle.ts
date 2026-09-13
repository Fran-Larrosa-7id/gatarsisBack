import { MigrationInterface, QueryRunner } from "typeorm";

export class OneActiveRaffle1767312000000 implements MigrationInterface {
  name = "OneActiveRaffle1767312000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_raffles_single_active"
      ON "raffles" ((1))
      WHERE "status" = 'ACTIVE'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_raffles_single_active"`);
  }
}
