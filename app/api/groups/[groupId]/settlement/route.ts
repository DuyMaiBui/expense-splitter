import { requireGroupMember, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listMembers } from "@/lib/group-queries";
import { ok, route } from "@/lib/http";
import { computeTransfers, toBalances, type MemberTotals } from "@/lib/settle";

interface SumRow {
  member_id: string;
  total: number;
}

export const GET = route(async (_req, ctx) => {
  const { groupId } = await ctx.params;
  const user = await requireUser();
  await requireGroupMember(groupId, user);

  const db = getDb();

  // Aggregates are computed in SQL so the read stays three grouped scans however many
  // expenses the group has accumulated.
  // Two D1 round trips total (members + one three-statement batch), run in parallel.
  const [members, [paidResult, owedResult, spentResult]] = await Promise.all([
    listMembers(db, groupId),
    db.batch<SumRow>([
      // Every row counts toward balances, payments included: a payment cancels a debt.
      db
        .prepare(
          `SELECT paid_by_member_id AS member_id, SUM(amount) AS total
           FROM expenses
           WHERE group_id = ? AND deleted_at IS NULL
           GROUP BY paid_by_member_id`,
        )
        .bind(groupId),
      db
        .prepare(
          `SELECT es.member_id AS member_id, SUM(es.amount) AS total
           FROM expense_shares es
           JOIN expenses e ON e.id = es.expense_id
           WHERE e.group_id = ? AND e.deleted_at IS NULL
           GROUP BY es.member_id`,
        )
        .bind(groupId),
      // Only a shared cost is spending; a settlement transfer moves money without spending it.
      db
        .prepare(
          `SELECT SUM(amount) AS total
           FROM expenses
           WHERE group_id = ? AND deleted_at IS NULL AND kind = 'expense'`,
        )
        .bind(groupId),
    ]),
  ]);

  const paid = new Map((paidResult?.results ?? []).map((r) => [r.member_id, r.total]));
  const owed = new Map((owedResult?.results ?? []).map((r) => [r.member_id, r.total]));

  const totals: MemberTotals[] = members
    .map((member) => ({
      memberId: member.id,
      name: member.name,
      removed: member.removedAt !== null,
      paid: paid.get(member.id) ?? 0,
      owed: owed.get(member.id) ?? 0,
    }))
    // A removed member with no activity is noise; one with money outstanding must stay.
    .filter((t) => !t.removed || t.paid !== 0 || t.owed !== 0);

  const balances = toBalances(totals);
  const transfers = computeTransfers(balances);
  // SUM() over no rows is NULL; a group with no expense (or only payments) spent nothing.
  // SUM() over no rows is NULL; a group with no expense (or only payments) spent nothing.
  const totalSpent = spentResult?.results?.[0]?.total ?? 0;

  return ok({ balances, transfers, totalSpent });
});
