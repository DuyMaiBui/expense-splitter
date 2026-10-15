import { logStatement } from "@/lib/activity";
import { rejectAdmin, requireUser } from "@/lib/auth";
import { getDb, newId, nowIso } from "@/lib/db";
import { internal, notFound } from "@/lib/errors";
import { getGroupView } from "@/lib/group-queries";
import { ok, readJson, route } from "@/lib/http";
import { obj, str } from "@/lib/validate";

interface ExistingRow {
  id: string;
  removed_at: string | null;
}

export const POST = route(async (req) => {
  const user = await requireUser();
  rejectAdmin(user);
  const { inviteCode } = await readJson(req, (raw) => ({
    inviteCode: str(obj(raw, "body").inviteCode, "inviteCode", { min: 1, max: 32 }).toUpperCase(),
  }));

  const db = getDb();

  const found = await db
    .prepare("SELECT id, name FROM groups WHERE invite_code = ?")
    .bind(inviteCode)
    .first<{ id: string; name: string }>();
  if (!found) {
    throw notFound("Mã mời không hợp lệ.");
  }

  const existing = await db
    .prepare("SELECT id, removed_at FROM group_members WHERE group_id = ? AND user_id = ?")
    .bind(found.id, user.id)
    .first<ExistingRow>();

  // Already an active member: joining is idempotent and writes nothing.
  if (!existing || existing.removed_at !== null) {
    const now = nowIso();
    const memberId = existing?.id ?? newId();

    // The (group_id, user_id) unique index means a removed member rejoins by reviving the
    // same row instead of inserting a second one.
    const write = existing
      ? db.prepare("UPDATE group_members SET removed_at = NULL WHERE id = ?").bind(memberId)
      : db
          .prepare(
            `INSERT INTO group_members (id, group_id, user_id, name, removed_at, created_at)
             VALUES (?, ?, ?, ?, NULL, ?)`,
          )
          .bind(memberId, found.id, user.id, user.displayName, now);

    await db.batch([
      write,
      logStatement(db, {
        groupId: found.id,
        actorUserId: user.id,
        actorName: user.displayName,
        action: "member.join",
        entityType: "member",
        entityId: memberId,
        summary: `${user.displayName} đã tham gia nhóm bằng mã mời`,
        detail: null,
      }),
    ]);
  }

  const group = await getGroupView(db, found.id, user.id);
  if (!group) {
    throw internal();
  }
  return ok({ group });
});
