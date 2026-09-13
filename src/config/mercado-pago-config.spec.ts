import { validateMercadoPagoEnvironment } from "./database.config";

describe("Mercado Pago production configuration", () => {
  const valid = {
    MP_ENABLED: "true",
    MP_ACCESS_TOKEN: "test-token",
    MP_WEBHOOK_SECRET: "test-secret",
    FRONTEND_URL: "https://gatarsis.com.ar",
  };

  it.each([
    ["MP_ACCESS_TOKEN", "MP_ENABLED=true but MP_ACCESS_TOKEN is missing"],
    ["MP_WEBHOOK_SECRET", "MP_ENABLED=true but MP_WEBHOOK_SECRET is missing"],
    ["FRONTEND_URL", "MP_ENABLED=true but FRONTEND_URL is missing"],
  ])("rejects missing %s without exposing credentials", (key, expected) => {
    const environment = { ...valid };
    delete environment[key as keyof typeof environment];
    expect(() => validateMercadoPagoEnvironment(environment)).toThrow(expected);
    expect(() => validateMercadoPagoEnvironment(environment)).toThrow(
      "MP_ENABLED=true",
    );
    expect(() => validateMercadoPagoEnvironment(environment)).not.toThrow(
      valid.MP_ACCESS_TOKEN,
    );
  });

  it("rejects an invalid or non-HTTPS frontend URL", () => {
    expect(() =>
      validateMercadoPagoEnvironment({
        ...valid,
        FRONTEND_URL: "not-a-url",
      }),
    ).toThrow("FRONTEND_URL is invalid");
    expect(() =>
      validateMercadoPagoEnvironment({
        ...valid,
        FRONTEND_URL: "http://gatarsis.com.ar",
      }),
    ).toThrow("FRONTEND_URL must use HTTPS");
  });

  it("accepts complete production configuration and disabled mode without credentials", () => {
    expect(() => validateMercadoPagoEnvironment(valid)).not.toThrow();
    expect(() =>
      validateMercadoPagoEnvironment({ MP_ENABLED: "false" }),
    ).not.toThrow();
  });
});
