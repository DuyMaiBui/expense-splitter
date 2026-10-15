import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ok, route } from "@/lib/http";
import type { AdminGroup } from "@/lib/types";

const MAX_GROUPS = 200;

interface Row {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
  deleted_at: string | null;
  member_count: number;
  expense_count: number;
}

/** Every group, deleted ones included, newest first, with member and expense counts. */
export const GET = route(
  async () => {
    await requireAdmin();

    const { results } = await getDb()
      .prepare(
        `SELECT g.id AS id, g.name AS name, g.invite_code AS invite_code,
                g.created_at AS created_at, g.deleted_at AS deleted_at,
                (SELECT COUNT(*) FROM group_members m
                   WHERE m.group_id = g.id AND m.removed_at IS NULL) AS member_count,
                (SELECT COUNT(*) FROM expenses x
                   WHERE x.group_id = g.id AND x.deleted_at IS NULL) AS expense_count
         FROM groups g ORDER BY g.created_at DESC, g.id DESC LIMIT ?`,
      )
      .bind(MAX_GROUPS)
      .all<Row>();

    const groups: AdminGroup[] = results.map((r) => ({
      id: r.id,
      name: r.name,
      inviteCode: r.invite_code,
      memberCount: r.member_count,
      expenseCount: r.expense_count,
      createdAt: r.created_at,
      deletedAt: r.deleted_at,
    }));
    return ok({ groups });
  },
  { allowBanned: true },
);
