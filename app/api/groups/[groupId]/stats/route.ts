import { requireGroupMember, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listMembers } from "@/lib/group-queries";
import { ok, route } from "@/lib/http";
import { fillBuckets, parseStatsQuery, statsRangeUtc, type BucketRow } from "@/lib/stats";
import type { GroupStats, StatsMember, StatsPeriod } from "@/lib/types";

/**
 * Spending charts: the totals, the bucket series and the per-member split of one local period.
 *
 * Everything is aggregated in SQL — a bounded number of grouped scans, never raw expense rows —
 * and the JS helpers in lib/stats.ts own the range, the bucket axis and the fill. The SQL groups
 * by the same local key `localBucketKey` produces, so the two can never disagree on the axis.
 */

/** One grouped bucket as the first statement returns it. */
interface BucketSqlRow {
  bucket_key: string;
  amount: number;
  count: number;
}

/** One grouped member total as the second and third statements return it. */
interface SumRow {
  member_id: string;
  total: number;
}

/**
 * The `strftime` format of each period: the bucket key a row falls in, in Vietnam time (fixed
 * UTC+7, no DST). Mirrors `lib/stats.ts#localBucketKey` — "all" keys a year, "year" a month of
 * that year, "month" a day of that month.
 */
const BUCKET_FORMAT: Record<StatsPeriod, string> = {
  all: "%Y",
  year: "%m",
  month: "%d",
};

/** Only a shared cost is spending; a settlement payment moves money without spending it. */
const LIVE_EXPENSE = "e.group_id = ? AND e.deleted_at IS NULL AND e.kind = 'expense'";

export const GET = route(async (req, ctx) => {
  const { groupId } = await ctx.params;
  const user = await requireUser();
  // The admin account reads every group as a built-in actor, like every other group route.
  await requireGroupMember(groupId, user);

  const { period, year, month } = parseStatsQuery(new URL(req.url).searchParams);
  // [startIso, endIso) of the local calendar range, or null for "all" (every row counts).
  const range = statsRangeUtc(period, year, month);
  const rangeClause = range === null ? "" : " AND e.spent_at >= ? AND e.spent_at < ?";
  const bindRange = range === null ? [groupId] : [groupId, range.startIso, range.endIso];

  const db = getDb();

  // Two D1 round trips total (members + one three-statement batch), run in parallel. Every
  // statement walks idx_expenses_group_live: group_id and deleted_at are equalities, and
  // spent_at — the index's next column — is a range for year/month.
  const [members, [bucketResult, paidResult, owedResult]] = await Promise.all([
    listMembers(db, groupId),
    db.batch<BucketSqlRow | SumRow>([
      db
        .prepare(
          `SELECT strftime('${BUCKET_FORMAT[period]}', datetime(e.spent_at, '+7 hours')) AS bucket_key,
                  SUM(e.amount) AS amount, COUNT(*) AS count
           FROM expenses e
           WHERE ${LIVE_EXPENSE}${rangeClause}
           GROUP BY bucket_key`,
        )
        .bind(...bindRange),
      db
        .prepare(
          `SELECT e.paid_by_member_id AS member_id, SUM(e.amount) AS total
           FROM expenses e
           WHERE ${LIVE_EXPENSE}${rangeClause}
           GROUP BY e.paid_by_member_id`,
        )
        .bind(...bindRange),
      db
        .prepare(
          `SELECT es.member_id AS member_id, SUM(es.amount) AS total
           FROM expense_shares es
           JOIN expenses e ON e.id = es.expense_id
           WHERE ${LIVE_EXPENSE}${rangeClause}
           GROUP BY es.member_id`,
        )
        .bind(...bindRange),
    ]),
  ]);

  // `total`/`count` cover the same rows the buckets are drawn from, so they are summed here
  // rather than probed with a fourth statement.
  const bucketRows: BucketRow[] = ((bucketResult?.results ?? []) as BucketSqlRow[]).map((row) => ({
    key: row.bucket_key,
    amount: row.amount,
    count: row.count,
  }));
  const total = bucketRows.reduce((sum, row) => sum + row.amount, 0);
  const count = bucketRows.reduce((sum, row) => sum + row.count, 0);

  const paid = new Map(((paidResult?.results ?? []) as SumRow[]).map((row) => [row.member_id, row.total]));
  const owed = new Map(((owedResult?.results ?? []) as SumRow[]).map((row) => [row.member_id, row.total]));

  const statsMembers: StatsMember[] = members
    .map((member) => ({
      memberId: member.id,
      name: member.name,
      removed: member.removedAt !== null,
      owed: owed.get(member.id) ?? 0,
      paid: paid.get(member.id) ?? 0,
    }))
    // A member with no money in range is noise in a spend chart; a removed one with activity stays.
    .filter((member) => member.owed > 0 || member.paid > 0)
    // Biggest spender first, then Vietnamese-aware by name so "Đ" sorts after "D", not after "Z".
    .sort((a, b) => b.owed - a.owed || a.name.localeCompare(b.name, "vi"));

  const stats: GroupStats = {
    period,
    year,
    month,
    total,
    count,
    buckets: fillBuckets(period, year, month, bucketRows),
    members: statsMembers,
  };

  return ok({ stats });
});
