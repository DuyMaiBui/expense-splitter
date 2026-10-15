import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ok, route } from "@/lib/http";
import type { AdminUser } from "@/lib/types";

const MAX_USERS = 500;

interface Row {
  id: string;
  username: string;
  display_name: string;
  created_at: string;
  banned_at: string | null;
  ban_reason: string | null;
  recent_abuse: number;
}

/** Every plain account, newest first. Never includes the admin row, hashes or salts. */
export const GET = route(
  async () => {
    await requireAdmin();

    const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const { results } = await getDb()
      .prepare(
        `SELECT u.id AS id, u.username AS username, u.display_name AS display_name,
                u.created_at AS created_at, u.banned_at AS banned_at, u.ban_reason AS ban_reason,
                (SELECT COUNT(*) FROM abuse_events a
                   WHERE a.user_id = u.id AND a.created_at > ?) AS recent_abuse
         FROM users u WHERE u.role = 'user'
         ORDER BY u.created_at DESC, u.id DESC LIMIT ?`,
      )
      .bind(since, MAX_USERS)
      .all<Row>();

    const users: AdminUser[] = results.map((r) => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      createdAt: r.created_at,
      bannedAt: r.banned_at,
      banReason: r.ban_reason,
      recentAbuse: r.recent_abuse,
    }));
    return ok({ users });
  },
  { allowBanned: true },
);
