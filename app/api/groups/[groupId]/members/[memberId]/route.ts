import { logStatement } from "@/lib/activity";
import { requireGroupMember, requireUser } from "@/lib/auth";
import { getDb, nowIso } from "@/lib/db";
import { badRequest, conflict, internal, notFound } from "@/lib/errors";
import { getMember } from "@/lib/group-queries";
import { ok, readJson, route } from "@/lib/http";
import type { BankInfo } from "@/lib/types";
import { obj } from "@/lib/validate";
import { parseBankInfo } from "@/lib/vietqr";

/**
 * A member's receiving account, replaced wholesale. The contract's body is `{ bank }`; an
 * explicit `null` is how a caller clears an account, so an absent key is a validation error
 * rather than a silent wipe.
 */
interface BankPatch {
  bank: BankInfo | null;
}

function parseBankPatch(raw: unknown): BankPatch {
  const body = obj(raw, "body");
  if (!("bank" in body)) {
    throw badRequest('Trường "bank" là bắt buộc (gửi null để xóa tài khoản ngân hàng).');
  }
  if (body.bank === null) {
    return { bank: null };
  }
  return { bank: parseBankInfo(body.bank) };
}

/** Replaces a member's bank account (or clears it); any active member may do it. */
export const PATCH = route(async (req, ctx) => {
  const { groupId, memberId } = await ctx.params;
  const user = await requireUser();
  const actor = await requireGroupMember(groupId, user);
  const input = await readJson(req, parseBankPatch);

  const db = getDb();
  const before = await getMember(db, groupId, memberId);
  if (!before || before.removedAt !== null) {
    throw notFound("Không tìm thấy thành viên.");
  }

  // Always all three columns together, so a row can never hold a half-filled account.
  await db.batch([
    db
      .prepare(
        `UPDATE group_members
         SET bank_bin = ?, bank_account_no = ?, bank_account_name = ?
         WHERE id = ? AND group_id = ?`,
      )
      .bind(
        input.bank?.bin ?? null,
        input.bank?.accountNo ?? null,
        input.bank?.accountName ?? null,
        memberId,
        groupId,
      ),
    logStatement(db, {
      groupId,
      actorUserId: user.id,
      actorName: actor.name,
      action: "member.bank",
      entityType: "member",
      entityId: memberId,
      summary: `${actor.name} đã cập nhật tài khoản ngân hàng của "${before.name}"`,
      detail: { before: before.bank, after: input.bank },
    }),
  ]);

  const member = await getMember(db, groupId, memberId);
  if (!member) {
    throw internal();
  }
  return ok({ member });
});

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
