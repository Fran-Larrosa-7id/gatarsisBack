import { dataSourceConfig } from "./database.config";

describe("PostgreSQL runtime configuration", () => {
  const keys = [
    "DATABASE_SSL",
    "DATABASE_SSL_CA",
    "DATABASE_POOL_MAX",
    "DATABASE_CONNECTION_TIMEOUT_MS",
    "DATABASE_STATEMENT_TIMEOUT_MS",
    "DATABASE_QUERY_TIMEOUT_MS",
  ] as const;
  const original = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );

  afterEach(() => {
    for (const key of keys) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("keeps local connections non-SSL and applies bounded pool defaults", () => {
    for (const key of keys) delete process.env[key];
    const config = dataSourceConfig();
    expect(config).toMatchObject({
      type: "postgres",
      ssl: false,
      synchronize: false,
      extra: {
        max: 10,
        connectionTimeoutMillis: 10_000,
        statement_timeout: 30_000,
        query_timeout: 35_000,
      },
    });
  });

  it("enables SSL with certificate verification and an optional provider CA", () => {
    process.env.DATABASE_SSL = "true";
    process.env.DATABASE_SSL_CA = "line-one\\nline-two";
    expect(dataSourceConfig()).toMatchObject({
      ssl: {
        rejectUnauthorized: true,
        ca: "line-one\nline-two",
      },
    });
  });

  it("rejects unsafe pool values instead of silently accepting them", () => {
    process.env.DATABASE_POOL_MAX = "0";
    expect(() => dataSourceConfig()).toThrow(
      "DATABASE_POOL_MAX must be positive",
    );
  });
});
