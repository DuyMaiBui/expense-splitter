import { auditStatement } from "@/lib/admin-audit";
import { requireAdmin } from "@/lib/auth";
import { getDb, nowIso } from "@/lib/db";
import { badRequest } from "@/lib/errors";
import { invalidateBanCache } from "@/lib/guard";
import { ok, readJson, route } from "@/lib/http";
import { normalizeIp } from "@/lib/ip";
import { clientKey } from "@/lib/rate-limit";
import type { IpBan, IpSuspect } from "@/lib/types";
import { int, obj, str } from "@/lib/validate";

const MAX_BANS = 200;
const MAX_SUSPECTS = 20;
const MAX_HOURS = 24 * 365;

interface BanRow {
  ip: string;
  reason: string;
  source: "admin" | "auto";
  created_at: string;
  expires_at: string | null;
}

/** Active bans, plus addresses with recent spam signals that are not banned (yet). */
export const GET = route(
  async () => {
    await requireAdmin();
    const db = getDb();
    const now = nowIso();
    const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();

    const [bans, suspects] = await Promise.all([
      db
        .prepare(
          `SELECT ip, reason, source, created_at, expires_at FROM ip_bans
           WHERE expires_at IS NULL OR expires_at > ?
           ORDER BY created_at DESC LIMIT ?`,
        )
        .bind(now, MAX_BANS)
        .all<BanRow>(),
      db
        .prepare(
          `SELECT e.ip AS ip, COUNT(DISTINCT e.user_id) AS accounts, COUNT(*) AS events,
                  MAX(e.created_at) AS last_at
           FROM abuse_events e
           WHERE e.created_at > ?
             AND NOT EXISTS (
               SELECT 1 FROM ip_bans b
               WHERE b.ip = e.ip AND (b.expires_at IS NULL OR b.expires_at > ?)
             )
           GROUP BY e.ip ORDER BY last_at DESC LIMIT ?`,
        )
        .bind(since, now, MAX_SUSPECTS)
        .all<{ ip: string; accounts: number; events: number; last_at: string }>(),
    ]);

    const banList: IpBan[] = bans.results.map((r) => ({
      ip: r.ip,
      reason: r.reason,
      source: r.source,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    }));
    const suspectList: IpSuspect[] = suspects.results.map((r) => ({
      ip: r.ip,
      accounts: r.accounts,
      events: r.events,
      lastAt: r.last_at,
    }));
    return ok({ bans: banList, suspects: suspectList });
  },
  { allowBanned: true },
);

/** Bans an address for `hours`, or until lifted when `hours` is absent or null. */
export const POST = route(
  async (req) => {
    const admin = await requireAdmin();
    const body = await readJson(req, (raw) => {
      const o = obj(raw, "body");
      const hours =
        o.hours === undefined || o.hours === null ? null : int(o.hours, "hours", { min: 1, max: MAX_HOURS });
      const reason =
        o.reason === undefined || o.reason === null ? "" : str(o.reason, "reason", { max: 200 });
      return { ip: str(o.ip, "ip", { min: 1, max: 64 }), hours, reason };
    });

    const ip = normalizeIp(body.ip);
    if (!ip) {
      throw badRequest("Địa chỉ IP không hợp lệ.");
    }
    if (ip === normalizeIp(clientKey(req))) {
      throw badRequest("Không thể chặn địa chỉ IP bạn đang dùng.");
    }

    const db = getDb();
    const now = nowIso();
    const expiresAt =
      body.hours === null ? null : new Date(Date.now() + body.hours * 60 * 60_000).toISOString();
    const reason = body.reason === "" ? "Do quản trị viên chặn" : body.reason;

    await db.batch([
      db
        .prepare(
          `INSERT INTO ip_bans (ip, reason, source, created_by, created_at, expires_at)
           VALUES (?, ?, 'admin', ?, ?, ?)
           ON CONFLICT(ip) DO UPDATE SET reason = excluded.reason, source = 'admin',
             created_by = excluded.created_by, created_at = excluded.created_at,
             expires_at = excluded.expires_at`,
        )
        .bind(ip, reason, admin.id, now, expiresAt),
      auditStatement(db, {
        adminUserId: admin.id,
        action: "ip.ban",
        detail: { ip, hours: body.hours, reason },
      }),
    ]);
    invalidateBanCache();
    return ok({ ban: { ip, reason, source: "admin", createdAt: now, expiresAt } satisfies IpBan }, 201);
  },
  { allowBanned: true },
);

/** Lifts a ban: `DELETE /api/admin/ip-bans?ip=...`. Idempotent. */
export const DELETE = route(
  async (req) => {
    const admin = await requireAdmin();
    const raw = new URL(req.url).searchParams.get("ip") ?? "";
    const ip = normalizeIp(raw);
    if (!ip) {
      throw badRequest("Địa chỉ IP không hợp lệ.");
    }

    const db = getDb();
    await db.batch([
      db.prepare("DELETE FROM ip_bans WHERE ip = ?").bind(ip),
      auditStatement(db, { adminUserId: admin.id, action: "ip.unban", detail: { ip } }),
    ]);
    invalidateBanCache();
    return ok({});
  },
  { allowBanned: true },
);
