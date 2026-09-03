/**
 * @countersign/db
 *
 * Database access layer. Owns the connection and the queries; nothing above
 * this package should know which engine is underneath.
 */

export const DB_VERSION = "0.0.0" as const;

/** Placeholder marker so the module has a real export while we scaffold. */
export const db = {
  version: DB_VERSION,
} as const;

export type Db = typeof db;
