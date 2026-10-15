import { logStatement } from "@/lib/activity";
import { auditStatement } from "@/lib/admin-audit";
import { ADMIN_ACTOR_NAME, requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { ok, readJson, route } from "@/lib/http";
import { obj, str } from "@/lib/validate";

/** Renames a group. Logged in the group's activity log as "Quản trị viên". */
export const PUT = route(
  async (req, ctx) => {
    const { groupId } = await ctx.params;
    const admin = await requireAdmin();
    const { name } = await readJson(req, (raw) => ({
      name: str(obj(raw, "body").name, "name", { min: 1, max: 60 }),
    }));

    const db = getDb();
    const group = await db
      .prepare("SELECT id, name FROM groups WHERE id = ?")
      .bind(groupId)
      .first<{ id: string; name: string }>();
    if (!group) {
      throw notFound("Không tìm thấy nhóm.");
    }

    await db.batch([
      db.prepare("UPDATE groups SET name = ? WHERE id = ?").bind(name, group.id),
      logStatement(db, {
        groupId: group.id,
        actorUserId: admin.id,
        actorName: ADMIN_ACTOR_NAME,
        action: "group.rename",
        entityType: "group",
        entityId: group.id,
        summary: `${ADMIN_ACTOR_NAME} đã đổi tên nhóm "${group.name}" thành "${name}"`,
        detail: { before: { name: group.name }, after: { name } },
      }),
      auditStatement(db, {
        adminUserId: admin.id,
        action: "group.rename",
        detail: { groupId: group.id, from: group.name, to: name },
      }),
    ]);
    return ok({ group: { id: group.id, name } });
  },
  { allowBanned: true },
);
