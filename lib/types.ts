/**
 * Shared domain types — the single source of truth for every shape crossing the API boundary.
 * See docs/CONTRACT.md for the authoritative specification these mirror.
 */

/** A registered account. */
export interface User {
  id: string;
  username: string;
  displayName: string;
  createdAt: string;
}

/** A group as seen by the calling user. */
export interface Group {
  id: string;
  name: string;
  inviteCode: string;
  memberCount: number;
  /** The caller's own active member row id in this group. */
  myMemberId: string;
  createdAt: string;
}

/**
 * A group member. `userId`/`username` are null for a friend added without an account.
 * `removedAt` is set on a soft delete (removed members stay readable).
 */
export interface Member {
  id: string;
  groupId: string;
  name: string;
  userId: string | null;
  username: string | null;
  removedAt: string | null;
  createdAt: string;
}

/** One member's portion of an expense. */
export interface ExpenseShare {
  memberId: string;
  amount: number;
}

/** An expense and the split of its amount across participants. */
export interface Expense {
  id: string;
  groupId: string;
  title: string;
  /** Integer VND. Always equals the sum of `shares[].amount`. */
  amount: number;
  paidByMemberId: string;
  spentAt: string;
  note: string | null;
  shares: ExpenseShare[];
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

/** One row of the group activity log. `id` is the decimal string of an autoincrement integer. */
export interface LogEntry {
  id: string;
  groupId: string;
  actorUserId: string;
  actorName: string;
  action: LogAction;
  entityType: LogEntityType;
  entityId: string;
  summary: string;
  /** Shape depends on `action`; see docs/CONTRACT.md § LOG. */
  detail: Record<string, unknown> | null;
  createdAt: string;
}

/** A member's settlement position. `net = paid - owed`; net > 0 means they should receive money. */
export interface Balance {
  memberId: string;
  name: string;
  removed: boolean;
  paid: number;
  owed: number;
  net: number;
}

/** A single settlement payment suggestion. */
export interface Transfer {
  fromMemberId: string;
  toMemberId: string;
  amount: number;
}

export type LogAction =
  | "group.create"
  | "member.add"
  | "member.join"
  | "member.remove"
  | "expense.create"
  | "expense.update"
  | "expense.delete";

export type LogEntityType = "group" | "member" | "expense";

/** Error codes mapped 1:1 to HTTP statuses by lib/http.ts. */
export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "INTERNAL";

/** The JSON envelope for every successful response. `data` is always an object. */
export interface ApiSuccess<T extends object> {
  ok: true;
  data: T;
}

/** The JSON envelope for every failed response. */
export interface ApiFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string };
}

export type ApiEnvelope<T extends object> = ApiSuccess<T> | ApiFailure;
