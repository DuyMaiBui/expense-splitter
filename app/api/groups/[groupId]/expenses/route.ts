import { logStatement } from "@/lib/activity";
import { requireGroupMember, requireUser } from "@/lib/auth";
import { getDb, newId, nowIso } from "@/lib/db";
import { assertMembersAllowed, loadExpenseList, parseExpenseInput } from "@/lib/expenses";
import { formatVnd } from "@/lib/format";
import { listMembers } from "@/lib/group-queries";
import { ok, readJson, route } from "@/lib/http";
import { splitEqual } from "@/lib/split";
import type { Expense } from "@/lib/types";

export const GET = route(async (_req, ctx) => {
  const { groupId } = await ctx.params;
  const user = await requireUser();
  await requireGroupMember(groupId, user);

  // Members ride along so the expenses page needs ONE request instead of two.
  const db = getDb();
  const [{ expenses, hasMore }, members] = await Promise.all([
    loadExpenseList(db, groupId),
    listMembers(db, groupId),
  ]);
  return ok({ expenses, members, hasMore });
});

export const POST = route(async (req, ctx) => {
  const { groupId } = await ctx.params;
  const user = await requireUser();
  const actor = await requireGroupMember(groupId, user);
  const input = await readJson(req, parseExpenseInput);

  const db = getDb();
  assertMembersAllowed(await listMembers(db, groupId), input, null);

  const now = nowIso();
  const shares = splitEqual(input.amount, input.participantMemberIds);
  const expense: Expense = {
    id: newId(),
    groupId,
    title: input.title,
    amount: input.amount,
    paidByMemberId: input.paidByMemberId,
    spentAt: input.spentAt ?? now,
    note: input.note,
    shares,
    createdByUserId: user.id,
    createdAt: now,
    updatedAt: now,
  };

  await db.batch([
    db
      .prepare(
        `INSERT INTO expenses
           (id, group_id, title, amount, paid_by_member_id, spent_at, note,
            created_by_user_id, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        expense.id,
        groupId,
        expense.title,
        expense.amount,
        expense.paidByMemberId,
        expense.spentAt,
        expense.note,
        user.id,
        now,
        now,
      ),
    ...shares.map((share) =>
      db
        .prepare("INSERT INTO expense_shares (expense_id, member_id, amount) VALUES (?, ?, ?)")
        .bind(expense.id, share.memberId, share.amount),
    ),
    logStatement(db, {
      groupId,
      actorUserId: user.id,
      actorName: actor.name,
      action: "expense.create",
      entityType: "expense",
      entityId: expense.id,
      summary: `${actor.name} đã thêm chi tiêu "${expense.title}" ${formatVnd(expense.amount)}`,
      detail: { after: expense },
    }),
  ]);

  return ok({ expense }, 201);
});
