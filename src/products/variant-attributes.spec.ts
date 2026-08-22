import { attributesFingerprint, normalizeVariantAttributes } from "./variant-attributes";

describe("variant attributes", () => {
  it("normalizes keys, whitespace and the talle alias", () => {
    expect(normalizeVariantAttributes({ " Color ": " Blanco ", TALLE: " M " })).toEqual({ color: "Blanco", size: "M" });
  });

  it("compares logical combinations case-insensitively", () => {
    expect(attributesFingerprint(normalizeVariantAttributes({ color: "Blanco", size: "M" }))).toBe(attributesFingerprint(normalizeVariantAttributes({ color: " blanco ", size: "m" })));
  });

  it("rejects nested and empty attribute values", () => {
    expect(() => normalizeVariantAttributes({ color: { value: "Blanco" } })).toThrow("ATTRIBUTE_VALUE_MUST_BE_A_STRING");
    expect(() => normalizeVariantAttributes({ color: "  " })).toThrow("INVALID_ATTRIBUTE_VALUE");
  });
});
