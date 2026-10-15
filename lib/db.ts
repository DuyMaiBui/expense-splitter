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

/**
 * A Workers Rate Limiting binding (declared under `ratelimits` in wrangler.jsonc), or
 * undefined where none is configured (local dev, tests, outside a request).
 */
export function getRateLimiter(name: "RL_AUTH" | "RL_API" | "RL_WRITE"): RateLimit | undefined {
  try {
    return getCloudflareContext().env[name];
  } catch {
    return undefined;
  }
}

/** Current time as ISO 8601 UTC with milliseconds, e.g. "2026-10-15T08:30:00.000Z". */
export function nowIso(): string {
  return new Date().toISOString();
}

/** A fresh UUID v4 identifier for every TEXT primary key. */
export function newId(): string {
  return crypto.randomUUID();
}
