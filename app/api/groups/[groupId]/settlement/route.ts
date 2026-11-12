import { requireGroupMember, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { buildViewer, listMembers } from "@/lib/group-queries";
import { ok, route } from "@/lib/http";
import { computeTransfers, toBalances, type MemberTotals } from "@/lib/settle";
import type { ExpenseKind } from "@/lib/types";

/** One grouped row: the amount summed for one member, one kind. Used by both grouped statements. */
interface KindSumRow {
  member_id: string;
  kind: ExpenseKind;
  total: number;
}

interface TotalRow {
  total: number;
}

/** The four per-member numbers. paid = spentPaid + paymentsOut; owed = spentOwed + paymentsIn. */
interface MemberParts {
  spentPaid: number;
  spentOwed: number;
  paymentsOut: number;
  paymentsIn: number;
}

const NO_PARTS: MemberParts = { spentPaid: 0, spentOwed: 0, paymentsOut: 0, paymentsIn: 0 };

export const GET = route(async (_req, ctx) => {
  const { groupId } = await ctx.params;
  const user = await requireUser();
  const actor = await requireGroupMember(groupId, user);

  const db = getDb();

  // Aggregates are computed in SQL so the read stays three grouped scans however many
  // expenses the group has accumulated. Two D1 round trips total (members + one three-statement
  // batch), run in parallel. Every query is scoped to group_id and skips soft-deleted rows.
  const [members, [paidResult, owedResult, spentResult]] = await Promise.all([
    listMembers(db, groupId),
    db.batch<KindSumRow | TotalRow>([
      // Grouped by kind so a payment's amount is kept apart from a shared cost's.
      db
        .prepare(
          `SELECT paid_by_member_id AS member_id, kind, SUM(amount) AS total
           FROM expenses
           WHERE group_id = ? AND deleted_at IS NULL
           GROUP BY paid_by_member_id, kind`,
        )
        .bind(groupId),
      db
        .prepare(
          `SELECT es.member_id AS member_id, e.kind AS kind, SUM(es.amount) AS total
           FROM expense_shares es
           JOIN expenses e ON e.id = es.expense_id
           WHERE e.group_id = ? AND e.deleted_at IS NULL
           GROUP BY es.member_id, e.kind`,
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

  const parts = new Map<string, MemberParts>();
  const partsOf = (memberId: string): MemberParts => {
    const existing = parts.get(memberId);
    if (existing) return existing;
    const fresh = { ...NO_PARTS };
    parts.set(memberId, fresh);
    return fresh;
  };

  for (const row of (paidResult?.results ?? []) as KindSumRow[]) {
    const p = partsOf(row.member_id);
    if (row.kind === "payment") p.paymentsOut += row.total;
    else p.spentPaid += row.total;
  }
  for (const row of (owedResult?.results ?? []) as KindSumRow[]) {
    const p = partsOf(row.member_id);
    if (row.kind === "payment") p.paymentsIn += row.total;
    else p.spentOwed += row.total;
  }

  const totals: MemberTotals[] = members
    .map((member) => {
      const p = parts.get(member.id) ?? NO_PARTS;
      return {
        memberId: member.id,
        name: member.name,
        removed: member.removedAt !== null,
        paid: p.spentPaid + p.paymentsOut,
        owed: p.spentOwed + p.paymentsIn,
        spentPaid: p.spentPaid,
        spentOwed: p.spentOwed,
        paymentsOut: p.paymentsOut,
        paymentsIn: p.paymentsIn,
      };
    })
    // A removed member with no activity is noise; one with money outstanding must stay.
    .filter((t) => !t.removed || t.paid !== 0 || t.owed !== 0);

  const balances = toBalances(totals);
  const transfers = computeTransfers(balances);
  // SUM() over no rows is NULL; a group with no expense (or only payments) spent nothing.
  const totalSpent = (spentResult?.results?.[0] as TotalRow | undefined)?.total ?? 0;

  return ok({ balances, transfers, totalSpent, viewer: buildViewer(user, actor) });
});
