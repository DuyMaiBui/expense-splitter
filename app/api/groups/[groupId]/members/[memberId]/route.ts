import { logStatement } from "@/lib/activity";
import { requireGroupMember, requireUser } from "@/lib/auth";
import { getDb, nowIso } from "@/lib/db";
import { conflict, notFound } from "@/lib/errors";
import { getMember } from "@/lib/group-queries";
import { ok, route } from "@/lib/http";

/** Soft delete: the member stays in history and settlement, but cannot join new expenses. */
export const DELETE = route(async (_req, ctx) => {
  const { groupId, memberId } = await ctx.params;
  const user = await requireUser();
  const actor = await requireGroupMember(groupId, user);

  const db = getDb();
  const member = await getMember(db, groupId, memberId);
  if (!member || member.removedAt !== null) {
    throw notFound("Không tìm thấy thành viên.");
  }
  if (member.id === actor.id) {
    throw conflict("Bạn không thể tự xóa chính mình khỏi nhóm.");
  }

  await db.batch([
    db
      .prepare("UPDATE group_members SET removed_at = ? WHERE id = ? AND group_id = ?")
      .bind(nowIso(), memberId, groupId),
    logStatement(db, {
      groupId,
      actorUserId: user.id,
      actorName: actor.name,
      action: "member.remove",
      entityType: "member",
      entityId: memberId,
      summary: `${actor.name} đã xóa thành viên "${member.name}"`,
      detail: { member: { id: member.id, groupId, name: member.name, userId: member.userId } },
    }),
  ]);

  return ok({});
});
