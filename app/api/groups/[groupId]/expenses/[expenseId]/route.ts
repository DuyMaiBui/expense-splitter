import { logStatement } from "@/lib/activity";
import { requireGroupMember, requireUser, type GroupMemberRef } from "@/lib/auth";
import { getDb, nowIso } from "@/lib/db";
import { forbidden, notFound } from "@/lib/errors";
import { assertMembersAllowed, assertPaymentShape, loadExpense, parseExpenseInput } from "@/lib/expenses";
import { formatVnd } from "@/lib/format";
import { buildViewer, listMembers } from "@/lib/group-queries";
import { ok, readJson, route } from "@/lib/http";
import { canModifyExpense } from "@/lib/permissions";
import { splitEqual } from "@/lib/split";
import type { Expense, Member, User } from "@/lib/types";

async function loadOne(db: D1Database, groupId: string, expenseId: string): Promise<Expense> {
  const expense = await loadExpense(db, groupId, expenseId);
  if (!expense) {
    throw notFound("Không tìm thấy chi tiêu.");
  }
  return expense;
}

const DENIED_EXPENSE = "Bạn không có quyền sửa hoặc xóa chi tiêu này.";

/**
 * Refuses a caller who may not touch this expense.
 *
 * The verdict is computed from the STORED expense and the stored member rows, never from the
 * request body: a body naming the caller as payer must not be able to authorise itself.
 */
function assertCanModify(user: User, actor: GroupMemberRef, expense: Expense, members: Member[]): void {
  if (!canModifyExpense(buildViewer(user, actor), expense, members)) {
    throw forbidden(DENIED_EXPENSE);
  }
}

export const GET = route(async (_req, ctx) => {
  const { groupId, expenseId } = await ctx.params;
  const user = await requireUser();
  await requireGroupMember(groupId, user);

  return ok({ expense: await loadOne(getDb(), groupId, expenseId) });
});

export const PUT = route(async (req, ctx) => {
  const { groupId, expenseId } = await ctx.params;
  const user = await requireUser();
  const actor = await requireGroupMember(groupId, user);

  const db = getDb();
  // The permission verdict comes first, against the STORED row, so a refused edit never reads
  // or writes the body.
  const before = await loadOne(db, groupId, expenseId);
  const members = await listMembers(db, groupId);
  assertCanModify(user, actor, before, members);

  const input = await readJson(req, parseExpenseInput);
  assertMembersAllowed(members, input, before);
  // `kind` is immutable: an edit keeps the stored one, so a payment is still held to the
  // one-receiver rule even when the body omits or contradicts `kind`.
  assertPaymentShape({
    kind: before.kind,
    paidByMemberId: input.paidByMemberId,
    participantMemberIds: input.participantMemberIds,
  });

  const now = nowIso();
  const shares = splitEqual(input.amount, input.participantMemberIds);
  // An omitted spentAt keeps the date the expense already had.
  const after: Expense = {
    ...before,
    title: input.title,
    amount: input.amount,
    paidByMemberId: input.paidByMemberId,
    spentAt: input.spentAt ?? before.spentAt,
    note: input.note,
    shares,
    updatedAt: now,
  };

  await db.batch([
    db
      .prepare(
        `UPDATE expenses
         SET title = ?, amount = ?, paid_by_member_id = ?, spent_at = ?, note = ?, updated_at = ?
         WHERE id = ? AND group_id = ? AND deleted_at IS NULL`,
      )
      .bind(
        after.title,
        after.amount,
        after.paidByMemberId,
        after.spentAt,
        after.note,
        now,
        expenseId,
        groupId,
      ),
    db.prepare("DELETE FROM expense_shares WHERE expense_id = ?").bind(expenseId),
    ...shares.map((share) =>
      db
        .prepare("INSERT INTO expense_shares (expense_id, member_id, amount) VALUES (?, ?, ?)")
        .bind(expenseId, share.memberId, share.amount),
    ),
    logStatement(db, {
      groupId,
      actorUserId: user.id,
      actorName: actor.name,
      action: "expense.update",
      entityType: "expense",
      entityId: expenseId,
      summary: `${actor.name} đã sửa chi tiêu "${after.title}" ${formatVnd(after.amount)}`,
      detail: { before, after },
    }),
  ]);

  return ok({ expense: after });
});

/** Soft delete: the row stays for the log's `before` snapshot, but leaves lists and balances. */
export const DELETE = route(async (_req, ctx) => {
  const { groupId, expenseId } = await ctx.params;
  const user = await requireUser();
  const actor = await requireGroupMember(groupId, user);

  const db = getDb();
  const before = await loadOne(db, groupId, expenseId);
  assertCanModify(user, actor, before, await listMembers(db, groupId));
  const now = nowIso();

  await db.batch([
    db
      .prepare(
        "UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ? AND group_id = ? AND deleted_at IS NULL",
      )
      .bind(now, now, expenseId, groupId),
    logStatement(db, {
      groupId,
      actorUserId: user.id,
      actorName: actor.name,
      action: "expense.delete",
      entityType: "expense",
      entityId: expenseId,
      summary: `${actor.name} đã xóa chi tiêu "${before.title}" ${formatVnd(before.amount)}`,
      detail: { before },
    }),
  ]);

  return ok({});
});
