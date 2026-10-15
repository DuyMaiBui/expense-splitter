import { badRequest } from "./errors";
import type { Expense, ExpenseShare, Member } from "./types";
import { int, isoDate, obj, str, strArray } from "./validate";

/** A validated create/update body (docs/CONTRACT.md § ENDPOINTS). */
export interface ExpenseInput {
  title: string;
  amount: number;
  paidByMemberId: string;
  participantMemberIds: string[];
  /** Null means "now" on create and "keep the current value" is NOT implied on update. */
  spentAt: string | null;
  note: string | null;
}

export function parseExpenseInput(raw: unknown): ExpenseInput {
  const body = obj(raw, "body");

  const title = str(body.title, "title", { min: 1, max: 100 });
  const amount = int(body.amount, "amount", { min: 1, max: 1_000_000_000_000 });
  const paidByMemberId = str(body.paidByMemberId, "paidByMemberId", { min: 1 });
  const participantMemberIds = [
    ...new Set(strArray(body.participantMemberIds, "participantMemberIds", { min: 1, max: 200 })),
  ];

  const spentAt =
    body.spentAt === undefined || body.spentAt === null ? null : isoDate(body.spentAt, "spentAt");

  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    const trimmed = str(body.note, "note", { max: 500 });
    note = trimmed === "" ? null : trimmed;
  }

  return { title, amount, paidByMemberId, participantMemberIds, spentAt, note };
}

/**
 * Checks that the payer and every participant belong to the group and are active.
 * An edit may keep a removed member who is already part of that expense (`existing`).
 */
export function assertMembersAllowed(
  members: readonly Member[],
  input: ExpenseInput,
  existing: Expense | null,
): void {
  const byId = new Map(members.map((m) => [m.id, m]));
  const keepable = new Set<string>();
  if (existing) {
    keepable.add(existing.paidByMemberId);
    for (const share of existing.shares) {
      keepable.add(share.memberId);
    }
  }

  const check = (memberId: string, label: string) => {
    const member = byId.get(memberId);
    if (!member) {
      throw badRequest(`${label} không thuộc nhóm này.`);
    }
    if (member.removedAt !== null && !keepable.has(memberId)) {
      throw badRequest(`${label} (${member.name}) đã bị xóa khỏi nhóm.`);
    }
  };

  check(input.paidByMemberId, "Người trả tiền");
  for (const memberId of input.participantMemberIds) {
    check(memberId, "Người tham gia");
  }
}

interface ExpenseRow {
  id: string;
  group_id: string;
  title: string;
  amount: number;
  paid_by_member_id: string;
  spent_at: string;
  note: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

interface ShareRow {
  expense_id: string;
  member_id: string;
  amount: number;
}

/**
 * Non-deleted expenses of a group (newest `spentAt` first) with their shares, in two
 * index-backed queries. Pass `expenseId` to load just one.
 */
export async function loadExpenses(
  db: D1Database,
  groupId: string,
  expenseId?: string,
): Promise<Expense[]> {
  const idFilter = expenseId ? " AND e.id = ?" : "";
  const binds = expenseId ? [groupId, expenseId] : [groupId];

  const { results: rows } = await db
    .prepare(
      `SELECT e.id AS id, e.group_id AS group_id, e.title AS title, e.amount AS amount,
              e.paid_by_member_id AS paid_by_member_id, e.spent_at AS spent_at, e.note AS note,
              e.created_by_user_id AS created_by_user_id, e.created_at AS created_at,
              e.updated_at AS updated_at
       FROM expenses e
       WHERE e.group_id = ? AND e.deleted_at IS NULL${idFilter}
       ORDER BY e.spent_at DESC, e.created_at DESC, e.id DESC`,
    )
    .bind(...binds)
    .all<ExpenseRow>();

  const { results: shareRows } = await db
    .prepare(
      `SELECT es.expense_id AS expense_id, es.member_id AS member_id, es.amount AS amount
       FROM expense_shares es
       JOIN expenses e ON e.id = es.expense_id
       WHERE e.group_id = ? AND e.deleted_at IS NULL${idFilter}
       ORDER BY es.member_id ASC`,
    )
    .bind(...binds)
    .all<ShareRow>();

  const sharesByExpense = new Map<string, ExpenseShare[]>();
  for (const row of shareRows) {
    const list = sharesByExpense.get(row.expense_id) ?? [];
    list.push({ memberId: row.member_id, amount: row.amount });
    sharesByExpense.set(row.expense_id, list);
  }

  return rows.map((row) => ({
    id: row.id,
    groupId: row.group_id,
    title: row.title,
    amount: row.amount,
    paidByMemberId: row.paid_by_member_id,
    spentAt: row.spent_at,
    note: row.note,
    shares: sharesByExpense.get(row.id) ?? [],
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
