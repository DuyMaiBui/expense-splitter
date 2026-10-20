import { logStatement } from "@/lib/activity";
import { requireGroupMember, requireUser } from "@/lib/auth";
import { getDb, nowIso } from "@/lib/db";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { buildViewer, getMember } from "@/lib/group-queries";
import { ok, route } from "@/lib/http";
import { canRemoveMember } from "@/lib/permissions";

/**
 * One member of a group.
 *
 * The receiving bank account is NOT here any more: it is the linked user's profile, edited by
 * that user alone through PUT /api/profile/bank (docs/CONTRACT.md § ENDPOINTS).
 */

/**
 * Soft delete: the member stays in history and settlement, but cannot join new expenses.
 *
 * Who may remove whom is `canRemoveMember`'s call (lib/permissions.ts): the owner is protected
 * from everyone (409), the owner and the admin remove anyone else, and a plain member removes
 * only their own row — which is how leaving a group works.
 */
export const DELETE = route(async (_req, ctx) => {
  const { groupId, memberId } = await ctx.params;
  const user = await requireUser();
  const actor = await requireGroupMember(groupId, user);

  const db = getDb();
  // A member that is gone (or was never here) is 404 before any permission verdict: the caller
  // is not being refused, the row simply does not exist.
  const member = await getMember(db, groupId, memberId);
  if (!member || member.removedAt !== null) {
    throw notFound("Không tìm thấy thành viên.");
  }

  const verdict = canRemoveMember(buildViewer(user, actor), member);
  if (!verdict.ok) {
    throw verdict.code === "OWNER_PROTECTED"
      ? conflict(verdict.message)
      : forbidden(verdict.message);
  }

  // Removing your own row is leaving the group, and the log reads that way.
  const leaving = member.id === actor.id;
  const summary = leaving
    ? `${actor.name} đã rời nhóm`
    : `${actor.name} đã xóa thành viên "${member.name}"`;

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
      summary,
      detail: { member: { id: member.id, groupId, name: member.name, userId: member.userId } },
    }),
  ]);

  return ok({});
});
