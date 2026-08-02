/**
 * Client-safe entry point.
 *
 * The default entry re-exports the providers, which reach for `node:fs`,
 * `node:crypto` and `node:dns` — importing it from a client component drags
 * those into the browser bundle and fails the build.
 *
 * This module is the pure domain: enums, the trades vocabulary, the profile
 * schema, completeness, fit, and the value transforms. Nothing here touches a
 * Node built-in, so client components import `@vendorlink/core/domain` and
 * server code keeps using the full barrel.
 */
export * from './enums';
export * from './trades';
export * from './profile';
export * from './completeness';
export * from './fit';
export * from './format';
