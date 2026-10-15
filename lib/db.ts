import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * The D1 binding for the current request.
 *
 * Resolved per call rather than cached at module scope: `getCloudflareContext()` reads from
 * the request-scoped AsyncLocalStorage context and is invalid outside it.
 */
export function getDb(): D1Database {
  const { env } = getCloudflareContext();
  return env.DB;
}

/** Current time as ISO 8601 UTC with milliseconds, e.g. "2026-10-15T08:30:00.000Z". */
export function nowIso(): string {
  return new Date().toISOString();
}

/** A fresh UUID v4 identifier for every TEXT primary key. */
export function newId(): string {
  return crypto.randomUUID();
}
