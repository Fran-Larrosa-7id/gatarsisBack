import { TypeOrmModuleOptions } from '@nestjs/typeorm';

const numberFromEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
};

export const databaseConfig = (): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: numberFromEnv('DATABASE_PORT', 5432),
  username: process.env.DATABASE_USER ?? 'gatarsis',
  password: process.env.DATABASE_PASSWORD ?? 'gatarsis_local_password',
  database: process.env.DATABASE_NAME ?? 'gatarsis',
  autoLoadEntities: true,
  synchronize: false,
});

export const reservationMinutes = (): number => numberFromEnv('STOCK_RESERVATION_MINUTES', 15);
