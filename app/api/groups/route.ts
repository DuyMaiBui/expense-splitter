import { logStatement } from "@/lib/activity";
import { rejectAdmin, requireUser } from "@/lib/auth";
import { getDb, newId, nowIso } from "@/lib/db";
import { internal } from "@/lib/errors";
import { generateInviteCode, getGroupView, listGroupsForUser } from "@/lib/group-queries";
import { ok, readJson, route } from "@/lib/http";
import { obj, str } from "@/lib/validate";

export const GET = route(async () => {
  const user = await requireUser();
  rejectAdmin(user); // the groups page redirects the admin account to /admin on this 403
  const groups = await listGroupsForUser(getDb(), user.id);
  return ok({ groups });
});

export const POST = route(async (req) => {
  const user = await requireUser();
  rejectAdmin(user);
  const { name } = await readJson(req, (raw) => ({
    name: str(obj(raw, "body").name, "name", { min: 1, max: 60 }),
  }));

  const db = getDb();
  const groupId = newId();
  const memberId = newId();
  const now = nowIso();

  await db.batch([
    db
      .prepare(
        "INSERT INTO groups (id, name, invite_code, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(groupId, name, generateInviteCode(), user.id, now),
    db
      .prepare(
        `INSERT INTO group_members (id, group_id, user_id, name, removed_at, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`,
      )
      .bind(memberId, groupId, user.id, user.displayName, now),
    logStatement(db, {
      groupId,
      actorUserId: user.id,
      actorName: user.displayName,
      action: "group.create",
      entityType: "group",
      entityId: groupId,
      summary: `${user.displayName} đã tạo nhóm "${name}"`,
      detail: null,
    }),
  ]);

  const group = await getGroupView(db, groupId, user.id);
  if (!group) {
    throw internal();
  }
  return ok({ group }, 201);
});
