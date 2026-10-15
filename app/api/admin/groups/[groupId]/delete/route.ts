import { logStatement } from "@/lib/activity";
import { auditStatement } from "@/lib/admin-audit";
import { ADMIN_ACTOR_NAME, requireAdmin } from "@/lib/auth";
import { getDb, nowIso } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { ok, route } from "@/lib/http";

/** Soft-deletes a group: it disappears for every member, nothing is erased and `restore` brings it back. Idempotent: repeating it changes nothing and writes no log row. */
export const POST = route(
  async (_req, ctx) => {
    const { groupId } = await ctx.params;
    const admin = await requireAdmin();

    const db = getDb();
    const group = await db
      .prepare("SELECT id, name, deleted_at FROM groups WHERE id = ?")
      .bind(groupId)
      .first<{ id: string; name: string; deleted_at: string | null }>();
    if (!group) {
      throw notFound("Không tìm thấy nhóm.");
    }
    if (group.deleted_at !== null) {
      return ok({});
    }

    await db.batch([
      db
        .prepare("UPDATE groups SET deleted_at = ? WHERE id = ?")
        .bind(nowIso(), group.id),
      logStatement(db, {
        groupId: group.id,
        actorUserId: admin.id,
        actorName: ADMIN_ACTOR_NAME,
        action: "group.delete",
        entityType: "group",
        entityId: group.id,
        summary: `${ADMIN_ACTOR_NAME} đã xóa nhóm "${group.name}"`,
        detail: null,
      }),
      auditStatement(db, {
        adminUserId: admin.id,
        action: "group.delete",
        detail: { groupId: group.id, name: group.name },
      }),
    ]);
    return ok({});
  },
  { allowBanned: true },
);
