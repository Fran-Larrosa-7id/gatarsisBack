import "dotenv/config";
import * as bcrypt from "bcryptjs";
import { AppDataSource } from "../database/data-source";
import { AdminUser, AdminRole } from "./entities/admin-user.entity";

async function bootstrap() {
  if (process.env.ADMIN_BOOTSTRAP_ENABLED !== "true")
    throw new Error(
      "ADMIN_BOOTSTRAP_ENABLED must be true to create the first admin.",
    );
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !/^\S+@\S+\.\S+$/.test(email))
    throw new Error("ADMIN_BOOTSTRAP_EMAIL must be a valid email.");
  if (!password || password.length < 14)
    throw new Error(
      "ADMIN_BOOTSTRAP_PASSWORD must contain at least 14 characters.",
    );
  await AppDataSource.initialize();
  try {
    await AppDataSource.runMigrations();
    const users = AppDataSource.getRepository(AdminUser);
    if (await users.exist())
      throw new Error(
        "An admin user already exists; bootstrap is one-time only.",
      );
    await users.save({
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: AdminRole.ADMIN,
      active: true,
      lastLoginAt: null,
    });
    console.log(`Admin bootstrap completed for ${email}.`);
  } finally {
    await AppDataSource.destroy();
  }
}
void bootstrap().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Admin bootstrap failed.",
  );
  process.exitCode = 1;
});
