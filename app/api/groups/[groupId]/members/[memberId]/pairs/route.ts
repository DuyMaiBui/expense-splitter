import { requireGroupMember, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { buildViewer, listMembers } from "@/lib/group-queries";
import { ok, route } from "@/lib/http";
import {
  buildPairStatements,
  parseRevision,
  type PairEventRow,
  type PairRevisionRow,
} from "@/lib/pairs";
import type { ExpenseKind } from "@/lib/types";

/**
 * One live row between the member and one counterparty, as the grouped pair statement returns it.
 * `member_share` / `counterparty_share` are 0 when that party holds no share on the row.
 */
interface PairSqlRow {
  expense_id: string;
  kind: ExpenseKind;
  title: string;
  spent_at: string;
  created_at: string;
  paid_by_member_id: string;
  counterparty_member_id: string;
  member_share: number;
  counterparty_share: number;
}

/** One expense update/delete row of the group's activity log, before parsing. */
interface RevisionSqlRow {
  entity_id: string;
  actor_name: string;
  action: string;
  created_at: string;
  detail_json: string | null;
}

/**
 * Every live row (`deleted_at IS NULL`) where the member paid and another member holds a share, or
 * the other member paid and the member holds a share. The derived table yields one (expense, counterparty)
 * pair per such row, so a shared expense with three participants yields three counterparties; the
 * outer join reads the two shares by primary key (expense_id, member_id). One statement, no N+1.
 *
 * Bind order: group, member (payer), member (not the share holder), member (share holder, second
 * branch), group, member (not the payer), member (own share in the outer join).
 */
const PAIR_ROWS_SQL = `
  SELECT e.id AS expense_id, e.kind AS kind, e.title AS title,
         e.spent_at AS spent_at, e.created_at AS created_at,
         e.paid_by_member_id AS paid_by_member_id,
         m.counterparty_member_id AS counterparty_member_id,
         COALESCE(ms.amount, 0) AS member_share,
         COALESCE(cs.amount, 0) AS counterparty_share
  FROM (
    SELECT e.id AS expense_id, es.member_id AS counterparty_member_id
    FROM expenses e
    JOIN expense_shares es ON es.expense_id = e.id
    WHERE e.group_id = ? AND e.deleted_at IS NULL
      AND e.paid_by_member_id = ? AND es.member_id <> ?
    UNION
    SELECT e.id, e.paid_by_member_id
    FROM expenses e
    JOIN expense_shares es ON es.expense_id = e.id AND es.member_id = ?
    WHERE e.group_id = ? AND e.deleted_at IS NULL AND e.paid_by_member_id <> ?
  ) m
  JOIN expenses e ON e.id = m.expense_id
  LEFT JOIN expense_shares ms ON ms.expense_id = e.id AND ms.member_id = ?
  LEFT JOIN expense_shares cs ON cs.expense_id = e.id AND cs.member_id = m.counterparty_member_id`;

/**
 * The group's expense update/delete log rows that name the member anywhere in their before/after
 * snapshot. `instr` on the member id is a superset filter (the id appears as payer or share holder);
 * lib/pairs.ts applies the exact pair test. Scoped by group_id, newest first (index
 * idx_activity_log_group_id), and capped at 500 rows so one request reads a bounded window.
 *
 * Bind order: group, action filter is literal, member id.
 */
const REVISION_ROWS_SQL = `
  SELECT entity_id, actor_name, action, created_at, detail_json
  FROM activity_log
  WHERE group_id = ?
    AND action IN ('expense.update', 'expense.delete')
    AND instr(detail_json, ?) > 0
  ORDER BY id DESC
  LIMIT 500`;

export const GET = route(async (_req, ctx) => {
  const { groupId, memberId } = await ctx.params;
  const user = await requireUser();
  const actor = await requireGroupMember(groupId, user);

  const db = getDb();
  // The roster (names and removal flags for every party a statement can name) and the two bounded
  // statements run in parallel: the roster is the same read the settlement route makes.
  const [members, [pairResult, revisionResult]] = await Promise.all([
    listMembers(db, groupId),
    db.batch<PairSqlRow | RevisionSqlRow>([
      db
        .prepare(PAIR_ROWS_SQL)
        .bind(groupId, memberId, memberId, memberId, groupId, memberId, memberId),
      db.prepare(REVISION_ROWS_SQL).bind(groupId, memberId),
    ]),
  ]);

  // A member id from another group, or an unknown one, is not a member row of THIS group.
  const member = members.find((m) => m.id === memberId);
  if (!member) {
    throw notFound("Không tìm thấy thành viên này trong nhóm.");
  }

  const roster: Record<string, { name: string; removed: boolean }> = {};
  for (const m of members) {
    roster[m.id] = { name: m.name, removed: m.removedAt !== null };
  }

  const rows: PairEventRow[] = ((pairResult?.results ?? []) as PairSqlRow[]).map((row) => ({
    expenseId: row.expense_id,
    kind: row.kind,
    title: row.title,
    spentAt: row.spent_at,
    createdAt: row.created_at,
    paidByMemberId: row.paid_by_member_id,
    counterpartyMemberId: row.counterparty_member_id,
    memberShare: row.member_share,
    counterpartyShare: row.counterparty_share,
  }));

  const revisions: PairRevisionRow[] = [];
  let skipped = 0;
  for (const log of (revisionResult?.results ?? []) as RevisionSqlRow[]) {
    try {
      const parsed = parseRevision({
        entityId: log.entity_id,
        actorName: log.actor_name,
        action: log.action,
        createdAt: log.created_at,
        detailJson: log.detail_json,
      });
      if (parsed !== null) revisions.push(parsed);
    } catch {
      // A corrupt audit row must not fail the whole statement; it is counted and reported once below.
      skipped += 1;
    }
  }
  if (skipped > 0) {
    console.warn(`pairs: skipped ${skipped} unreadable expense log row(s) for member statement`);
  }

  const pairs = buildPairStatements(member.id, rows, revisions, roster);

  return ok({ pairs, viewer: buildViewer(user, actor) });
});
