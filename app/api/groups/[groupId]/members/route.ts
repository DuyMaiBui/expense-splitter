import { logStatement } from "@/lib/activity";
import { requireGroupMember, requireUser } from "@/lib/auth";
import { getDb, newId, nowIso } from "@/lib/db";
import { badRequest, conflict, internal, notFound } from "@/lib/errors";
import { getMember, listMembers, sameName } from "@/lib/group-queries";
import { ok, readJson, route } from "@/lib/http";
import { obj, str } from "@/lib/validate";

export const GET = route(async (_req, ctx) => {
  const { groupId } = await ctx.params;
  const user = await requireUser();
  await requireGroupMember(groupId, user);

  const members = await listMembers(getDb(), groupId);
  return ok({ members });
});

type AddBody = { kind: "name"; name: string } | { kind: "username"; username: string };

function parseAddBody(raw: unknown): AddBody {
  const body = obj(raw, "body");
  const hasName = body.name !== undefined;
  const hasUsername = body.username !== undefined;

  if (hasName === hasUsername) {
    throw badRequest('Chỉ được gửi MỘT trong hai trường "name" hoặc "username".');
  }
  if (hasName) {
    return { kind: "name", name: str(body.name, "name", { min: 1, max: 50 }) };
  }
  return {
    kind: "username",
    username: str(body.username, "username", { min: 1, max: 32 }).toLowerCase(),
  };
}

export const POST = route(async (req, ctx) => {
  const { groupId } = await ctx.params;
  const user = await requireUser();
  const actor = await requireGroupMember(groupId, user);
  const input = await readJson(req, parseAddBody);

  const db = getDb();
  const members = await listMembers(db, groupId);
  const now = nowIso();

  let memberId = newId();
  let name: string;
  let userId: string | null = null;
  let revive = false;

  if (input.kind === "name") {
    name = input.name;
  } else {
    const target = await db
      .prepare("SELECT id, display_name FROM users WHERE username = ? AND role = 'user'")
      .bind(input.username)
      .first<{ id: string; display_name: string }>();
    if (!target) {
      throw notFound("Không tìm thấy tài khoản với tên đăng nhập này.");
    }

    const linked = members.find((m) => m.userId === target.id);
    if (linked && linked.removedAt === null) {
      throw conflict("Tài khoản này đã là thành viên của nhóm.");
    }
    if (linked) {
      // A previously removed member: revive the row (unique index on group_id + user_id).
      memberId = linked.id;
      revive = true;
    }

    userId = target.id;
    name = linked?.name ?? target.display_name;
  }

  const clash = members.some((m) => m.removedAt === null && m.id !== memberId && sameName(m.name, name));
  if (clash) {
    throw conflict(`Nhóm đã có thành viên tên "${name}".`);
  }

  const write = revive
    ? db.prepare("UPDATE group_members SET removed_at = NULL WHERE id = ?").bind(memberId)
    : db
        .prepare(
          `INSERT INTO group_members (id, group_id, user_id, name, removed_at, created_at)
           VALUES (?, ?, ?, ?, NULL, ?)`,
        )
        .bind(memberId, groupId, userId, name, now);

  // The log row needs the stored member, which does not exist until the write runs; build the
  // detail from the same values instead of re-reading inside the batch.
  const detail = { member: { id: memberId, groupId, name, userId } };

  await db.batch([
    write,
    logStatement(db, {
      groupId,
      actorUserId: user.id,
      actorName: actor.name,
      action: "member.add",
      entityType: "member",
      entityId: memberId,
      summary: `${actor.name} đã thêm thành viên "${name}"`,
      detail,
    }),
  ]);

  const member = await getMember(db, groupId, memberId);
  if (!member) {
    throw internal();
  }
  return ok({ member }, 201);
});
