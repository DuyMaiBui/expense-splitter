import { rejectAdmin, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { ok, route } from "@/lib/http";

/**
 * What an invite link points at, for the accept / decline screen: the group's name and size,
 * and whether the caller is already in it. Read-only; joining is still POST /api/groups/join.
 */
export const GET = route(async (_req, ctx) => {
  const { code } = await ctx.params;
  const user = await requireUser();
  rejectAdmin(user);

  const row = await getDb()
    .prepare(
      `SELECT g.id AS id, g.name AS name,
              (SELECT COUNT(*) FROM group_members c WHERE c.group_id = g.id AND c.removed_at IS NULL) AS member_count,
              EXISTS (SELECT 1 FROM group_members m
                      WHERE m.group_id = g.id AND m.user_id = ? AND m.removed_at IS NULL) AS is_member
       FROM groups g WHERE g.invite_code = ? AND g.deleted_at IS NULL`,
    )
    .bind(user.id, (code ?? "").toUpperCase())
    .first<{ id: string; name: string; member_count: number; is_member: number }>();
  if (!row) {
    throw notFound("Mã mời không hợp lệ.");
  }

  return ok({
    invite: {
      groupId: row.id,
      groupName: row.name,
      memberCount: row.member_count,
      alreadyMember: row.is_member === 1,
    },
  });
});
