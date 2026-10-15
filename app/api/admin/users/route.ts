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
}

/** Every plain account, newest first. Never includes the admin row, hashes or salts. */
export const GET = route(async () => {
  await requireAdmin();

  const { results } = await getDb()
    .prepare(
      `SELECT id, username, display_name, created_at
       FROM users WHERE role = 'user'
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(MAX_USERS)
    .all<Row>();

  const users: AdminUser[] = results.map((r) => ({
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    createdAt: r.created_at,
  }));
  return ok({ users });
});
