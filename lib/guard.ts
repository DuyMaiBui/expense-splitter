import { getDb } from "./db";

/**
 * Abuse guard: IP bans (checked on every API request, from memory) and spam signals.
 *
 * Cost model, because every D1 row counts on the free plan:
 *   - the ban list is read at most once a minute per isolate, never per request;
 *   - a spam violation is a rare event, and at most one row per account per 10 minutes per
 *     isolate is written, so a flood cannot be turned into a flood of D1 writes;
 *   - every D1 failure here fails OPEN (a request is never refused because the guard broke),
 *     which also keeps the app working in the window before the migration is applied.
 */

/** Policy constants (chosen by the owner; change them here). */
export const ABUSE = {
  /** Accounts from one IP that must each have spammed to trigger an IP ban ("more than 2"). */
  accountsThreshold: 3,
  /** Violations only count when they fall within this window. */
  windowMs: 30 * 60_000,
  /** Automatic IP bans last this long. */
  autoBanMs: 24 * 60 * 60_000,
  /** One recorded event per account per isolate per this long. */
  dedupeMs: 10 * 60_000,
  /** Registrations from one IP per rolling day. */
  registrationsPerDay: 10,
} as const;

const BAN_CACHE_TTL_MS = 60_000;
const EVENT_RETENTION_MS = 7 * 24 * 60 * 60_000;
const PRUNE_EVERY_MS = 60 * 60_000;
const MAX_TRACKED = 5_000;

// ---------------------------------------------------------------------------- IP bans

/** ip -> expiry (epoch ms), or null for a ban with no end. */
let bans = new Map<string, number | null>();
let bansLoadedAt = 0;

/** Forget the cached ban list so the next request reloads it (after an admin change). */
export function invalidateBanCache(): void {
  bansLoadedAt = 0;
}

/** Test hook: reset every in-memory structure of this module. */
export function resetGuardState(): void {
  bans = new Map();
  bansLoadedAt = 0;
  lastEvent.clear();
  lastPrune = 0;
}

async function loadBans(now: number): Promise<void> {
  bansLoadedAt = now; // set first: a failing load must not be retried on every request
  try {
    const { results } = await getDb()
      .prepare("SELECT ip, expires_at FROM ip_bans WHERE expires_at IS NULL OR expires_at > ? LIMIT 2000")
      .bind(new Date(now).toISOString())
      .all<{ ip: string; expires_at: string | null }>();

    const next = new Map<string, number | null>();
    for (const row of results) {
      next.set(row.ip, row.expires_at === null ? null : Date.parse(row.expires_at));
    }
    bans = next;
  } catch (error) {
    console.error("[guard] could not load ip_bans, keeping the previous list:", error);
  }
}

/** True while `ip` is banned. "unknown" (no address header) is never banned. */
export async function isIpBanned(ip: string, now = Date.now()): Promise<boolean> {
  if (ip === "unknown") {
    return false;
  }
  if (now - bansLoadedAt > BAN_CACHE_TTL_MS) {
    await loadBans(now);
  }
  if (!bans.has(ip)) {
    return false;
  }
  const expiresAt = bans.get(ip);
  return expiresAt === null || (expiresAt !== undefined && expiresAt > now);
}

// ------------------------------------------------------------------------- spam signals

const lastEvent = new Map<string, number>();
let lastPrune = 0;

export interface AbuseInput {
  ip: string;
  userId: string | null;
  kind: string;
}

/**
 * Records one spam violation and, when `ABUSE.accountsThreshold` different accounts have
 * violated from the same IP inside the window, bans that IP automatically. Accounts are only
 * flagged, never banned here: a shared address (home wifi, a mobile carrier) must not cost an
 * innocent friend their account. Returns true when this call created the ban.
 */
export async function recordAbuse(input: AbuseInput, now = Date.now()): Promise<boolean> {
  const key = input.userId ?? input.ip;
  const previous = lastEvent.get(key);
  if (previous !== undefined && now - previous < ABUSE.dedupeMs) {
    return false;
  }
  if (lastEvent.size >= MAX_TRACKED) {
    lastEvent.clear();
  }
  lastEvent.set(key, now);

  try {
    const db = getDb();
    const iso = new Date(now).toISOString();
    await db
      .prepare("INSERT INTO abuse_events (ip, user_id, kind, created_at) VALUES (?, ?, ?, ?)")
      .bind(input.ip, input.userId, input.kind, iso)
      .run();

    if (now - lastPrune > PRUNE_EVERY_MS) {
      lastPrune = now;
      await db
        .prepare("DELETE FROM abuse_events WHERE created_at < ?")
        .bind(new Date(now - EVENT_RETENTION_MS).toISOString())
        .run();
    }

    if (input.ip === "unknown" || (await isIpBanned(input.ip, now))) {
      return false;
    }

    const row = await db
      .prepare(
        `SELECT COUNT(DISTINCT user_id) AS accounts FROM abuse_events
         WHERE ip = ? AND user_id IS NOT NULL AND created_at > ?`,
      )
      .bind(input.ip, new Date(now - ABUSE.windowMs).toISOString())
      .first<{ accounts: number }>();

    if ((row?.accounts ?? 0) < ABUSE.accountsThreshold) {
      return false;
    }

    const expiresAt = new Date(now + ABUSE.autoBanMs).toISOString();
    await db
      .prepare(
        `INSERT INTO ip_bans (ip, reason, source, created_by, created_at, expires_at)
         VALUES (?, ?, 'auto', NULL, ?, ?)
         ON CONFLICT(ip) DO UPDATE SET reason = excluded.reason, source = 'auto',
           created_by = NULL, created_at = excluded.created_at, expires_at = excluded.expires_at`,
      )
      .bind(
        input.ip,
        `Tự động: ${row?.accounts} tài khoản cùng địa chỉ này spam liên tiếp`,
        iso,
        expiresAt,
      )
      .run();

    bans.set(input.ip, now + ABUSE.autoBanMs); // effective here immediately
    return true;
  } catch (error) {
    console.error("[guard] could not record abuse:", error);
    return false;
  }
}
