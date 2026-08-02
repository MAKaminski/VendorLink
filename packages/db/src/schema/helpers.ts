import { jsonb, text } from 'drizzle-orm/pg-core';

/**
 * A text column narrowed to a TypeScript union.
 *
 * Postgres enums require a migration to add a value, which is the wrong
 * trade-off for sets like `failure_class` that grow as we learn how runs fail.
 * A text column with a `$type` narrowing keeps compile-time safety and leaves
 * the value set free to evolve; the source of truth stays in
 * `@vendorlink/core/enums`.
 */
export function enumColumn<const T extends readonly string[]>(name: string, _values: T) {
  return text(name).$type<T[number]>();
}

/** A jsonb column carrying a known shape. */
export function jsonbColumn<T>(name: string) {
  return jsonb(name).$type<T>();
}
