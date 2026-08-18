import { MigrationInterface, QueryRunner } from "typeorm";
export class AdminAuth1766620800000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`CREATE TYPE "admin_users_role_enum" AS ENUM ('ADMIN')`);
    await q.query(
      `CREATE TABLE "admin_users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "email" varchar NOT NULL, "password_hash" varchar NOT NULL, "role" "admin_users_role_enum" NOT NULL DEFAULT 'ADMIN', "active" boolean NOT NULL DEFAULT true, "last_login_at" TIMESTAMPTZ, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT "PK_admin_users" PRIMARY KEY ("id"), CONSTRAINT "UQ_admin_users_email" UNIQUE ("email"))`,
    );
    await q.query(
      `CREATE TABLE "admin_sessions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "admin_user_id" uuid NOT NULL, "refresh_token_hash" varchar NOT NULL, "expires_at" TIMESTAMPTZ NOT NULL, "revoked_at" TIMESTAMPTZ, "last_used_at" TIMESTAMPTZ, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT "PK_admin_sessions" PRIMARY KEY ("id"), CONSTRAINT "FK_admin_sessions_user" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT)`,
    );
    await q.query(
      `CREATE INDEX "IDX_admin_sessions_user" ON "admin_sessions" ("admin_user_id")`,
    );
    await q.query(
      `CREATE TABLE "admin_audit_logs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "admin_user_id" uuid, "action" varchar NOT NULL, "entity_type" varchar, "entity_id" varchar, "metadata" jsonb, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT "PK_admin_audit_logs" PRIMARY KEY ("id"), CONSTRAINT "FK_admin_audit_user" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL)`,
    );
    await q.query(
      `CREATE INDEX "IDX_admin_audit_user_created" ON "admin_audit_logs" ("admin_user_id", "created_at")`,
    );
  }
  async down(q: QueryRunner) {
    await q.query(`DROP TABLE "admin_audit_logs"`);
    await q.query(`DROP TABLE "admin_sessions"`);
    await q.query(`DROP TABLE "admin_users"`);
    await q.query(`DROP TYPE "admin_users_role_enum"`);
  }
}
