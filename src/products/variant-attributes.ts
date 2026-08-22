export type VariantAttributes = Record<string, string>;

const KEY_ALIASES: Record<string, string> = { talle: "size" };
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
const MAX_ATTRIBUTES = 8;
const MAX_VALUE_LENGTH = 80;

export function normalizeVariantAttributes(input: unknown): VariantAttributes {
  if (!input || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype)
    throw new Error("ATTRIBUTES_MUST_BE_A_PLAIN_OBJECT");
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_ATTRIBUTES) throw new Error("TOO_MANY_ATTRIBUTES");
  const normalized: VariantAttributes = {};
  for (const [rawKey, rawValue] of entries) {
    const key = KEY_ALIASES[rawKey.trim().toLowerCase()] ?? rawKey.trim().toLowerCase();
    if (!KEY_PATTERN.test(key)) throw new Error("INVALID_ATTRIBUTE_KEY");
    if (typeof rawValue !== "string") throw new Error("ATTRIBUTE_VALUE_MUST_BE_A_STRING");
    const value = rawValue.trim().replace(/\s+/g, " ");
    if (!value || value.length > MAX_VALUE_LENGTH) throw new Error("INVALID_ATTRIBUTE_VALUE");
    if (normalized[key] !== undefined) throw new Error("DUPLICATE_ATTRIBUTE_KEY");
    normalized[key] = value;
  }
  return Object.fromEntries(Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b)));
}

export function attributesFingerprint(attributes: VariantAttributes): string | null {
  const entries = Object.entries(attributes);
  if (!entries.length) return null;
  return JSON.stringify(entries.map(([key, value]) => [key, value.toLocaleLowerCase()]));
}
