import { requireGroupMember, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getMember, buildViewer } from "@/lib/group-queries";
import { notFound } from "@/lib/errors";
import { ok, route } from "@/lib/http";
import { buildLedgerEntries, ledgerTotals, type LedgerRow } from "@/lib/ledger";
import type { ExpenseKind } from "@/lib/types";

/**
 * One row of the ledger statement. `paid`/`share` are this member's amounts on the row; the
 * counterparty columns are only meaningful for kind "payment" (lib/ledger.ts nulls them otherwise).
 */
interface LedgerSqlRow {
  expense_id: string;
  kind: ExpenseKind;
  title: string;
  spent_at: string;
  created_at: string;
  paid_by_member_id: string;
  paid_by_name: string;
  paid: number;
  share: number;
  counterparty_member_id: string | null;
  counterparty_name: string | null;
}

/**
 * One grouped statement over the group's live expenses, keeping only rows where this member is the
 * payer or holds a share. `os` joins the single other party of a payment (a payment has exactly one
 * participant, so the join adds at most one row; for kind "expense" it never matches, so no
 * multiplication). `cp` resolves that party's name. Every join is by primary key or the
 * (expense_id, member_id) key, so the statement returns one row per entry.
 *
 * Bind order: member (paid), member (counterparty), member (own share), member (other share),
 * member (counterparty name), groupId, member (payer or share filter).
 */
const LEDGER_SQL = `
  SELECT e.id AS expense_id, e.kind AS kind, e.title AS title,
         e.spent_at AS spent_at, e.created_at AS created_at,
         e.paid_by_member_id AS paid_by_member_id, payer.name AS paid_by_name,
         CASE WHEN e.paid_by_member_id = ? THEN e.amount ELSE 0 END AS paid,
         COALESCE(es.amount, 0) AS share,
         CASE WHEN e.paid_by_member_id = ? THEN os.member_id ELSE e.paid_by_member_id END AS counterparty_member_id,
         cp.name AS counterparty_name
  FROM expenses e
  JOIN group_members payer ON payer.id = e.paid_by_member_id
  LEFT JOIN expense_shares es ON es.expense_id = e.id AND es.member_id = ?
  LEFT JOIN expense_shares os ON os.expense_id = e.id AND os.member_id <> ? AND e.kind = 'payment'
  LEFT JOIN group_members cp
         ON cp.id = CASE WHEN e.paid_by_member_id = ? THEN os.member_id ELSE e.paid_by_member_id END
  WHERE e.group_id = ? AND e.deleted_at IS NULL
    AND (e.paid_by_member_id = ? OR es.member_id IS NOT NULL)`;

export const GET = route(async (_req, ctx) => {
  const { groupId, memberId } = await ctx.params;
  const user = await requireUser();
  const actor = await requireGroupMember(groupId, user);

  const db = getDb();
  const [member, result] = await Promise.all([
    getMember(db, groupId, memberId),
    db
      .prepare(LEDGER_SQL)
      .bind(memberId, memberId, memberId, memberId, memberId, groupId, memberId)
      .all<LedgerSqlRow>(),
  ]);

  // A member id from another group, or an unknown one, is not a member row of THIS group.
  if (!member) {
    throw notFound("Không tìm thấy thành viên này trong nhóm.");
  }

  const rows: LedgerRow[] = result.results.map((row) => ({
    expenseId: row.expense_id,
    kind: row.kind,
    title: row.title,
    spentAt: row.spent_at,
    createdAt: row.created_at,
    paidByMemberId: row.paid_by_member_id,
    paidByName: row.paid_by_name,
    paid: row.paid,
    share: row.share,
    counterpartyMemberId: row.kind === "payment" ? row.counterparty_member_id : null,
    counterpartyName: row.kind === "payment" ? row.counterparty_name : null,
  }));

  const entries = buildLedgerEntries(rows);

  return ok({
    ledger: {
      memberId: member.id,
      name: member.name,
      removed: member.removedAt !== null,
      entries,
      totals: ledgerTotals(entries),
    },
    viewer: buildViewer(user, actor),
  });
});
