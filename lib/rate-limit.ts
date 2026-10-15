import { getRateLimiter } from "./db";

/**
 * Request throttling, so one noisy client cannot burn the Workers free-tier request budget
 * (100k/day) or the D1 row budget.
 *
 * Two layers, no D1 writes (counters in D1 would cost the very rows we are protecting):
 *   1. The Workers Rate Limiting binding (RL_AUTH / RL_API) when configured: accurate,
 *      shared by every isolate in a Cloudflare location.
 *   2. An in-memory fixed window per isolate otherwise: best-effort, but free and enough to
 *      stop a runaway loop or a login brute force from one client.
 * A failing binding never blocks a request (fail open to layer 2).
 */

export type LimitKind = "auth" | "api";

export interface LimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

/** In-memory fallback rules; the binding's own limit/period come from wrangler.jsonc. */
export const MEMORY_RULES: Record<LimitKind, { limit: number; windowMs: number }> = {
  auth: { limit: 10, windowMs: 60_000 },
  api: { limit: 120, windowMs: 60_000 },
};

const MAX_TRACKED_KEYS = 5_000;
const windows = new Map<string, { count: number; resetAt: number }>();

/** Test hook: forget every in-memory counter. */
export function resetRateLimits(): void {
  windows.clear();
}

function prune(now: number): void {
  for (const [key, entry] of windows) {
    if (entry.resetAt <= now) {
      windows.delete(key);
    }
  }
  // Still too many distinct keys (an attack with spoofed keys): drop everything rather than
  // let the map grow without bound inside a long-lived isolate.
  if (windows.size > MAX_TRACKED_KEYS) {
    windows.clear();
  }
}

export function memoryLimit(kind: LimitKind, key: string, now = Date.now()): LimitResult {
  const rule = MEMORY_RULES[kind];
  const id = `${kind}:${key}`;

  if (windows.size >= MAX_TRACKED_KEYS) {
    prune(now);
  }

  const current = windows.get(id);
  if (!current || current.resetAt <= now) {
    windows.set(id, { count: 1, resetAt: now + rule.windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  current.count += 1;
  if (current.count > rule.limit) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export async function checkRateLimit(kind: LimitKind, key: string): Promise<LimitResult> {
  const binding = getRateLimiter(kind === "auth" ? "RL_AUTH" : "RL_API");

  if (binding) {
    try {
      const { success } = await binding.limit({ key });
      return success ? { allowed: true, retryAfterSec: 0 } : { allowed: false, retryAfterSec: 30 };
    } catch (error) {
      console.error("[rate-limit] binding failed, using in-memory fallback:", error);
    }
  }

  return memoryLimit(kind, key);
}

/** The caller's address, as Cloudflare reports it; one shared bucket when it is absent. */
export function clientKey(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "unknown";
}
