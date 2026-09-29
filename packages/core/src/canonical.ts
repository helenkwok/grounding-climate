import type { JsonValue } from "./types.js";

function canonicalNode(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Non-finite number at " + path);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalNode(item, path + "[" + index + "]"));
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, JsonValue> = {};

    for (const key of Object.keys(record).sort()) {
      const child = record[key];
      if (child === undefined) {
        throw new TypeError("Undefined value at " + path + "." + key);
      }
      sorted[key] = canonicalNode(child, path + "." + key);
    }

    return sorted;
  }

  throw new TypeError("Unsupported value at " + path + ": " + typeof value);
}

export function canonicalize(value: unknown): string {
  return JSON.stringify(canonicalNode(value, "$"));
}

export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}

export function domainSeparatedBytes(
  domain: string,
  schemaVersion: string,
  value: unknown,
): Uint8Array {
  return new TextEncoder().encode(
    domain + "\u0000" + schemaVersion + "\u0000" + canonicalize(value),
  );
}
