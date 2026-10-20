/**
 * Shared domain types — the single source of truth for every shape crossing the API boundary.
 * See docs/CONTRACT.md for the authoritative specification these mirror.
 */

/** `admin` is a dedicated account that only re-issues passwords; it never joins groups. */
export type UserRole = "user" | "admin";

/** A registered account. */
export interface User {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
}

/** The minimum an admin response needs to name an account. */
export interface AdminUserRef {
  id: string;
  username: string;
  displayName: string;
  createdAt: string;
}

/** An account as listed to the admin: only plain users, no secrets. */
export interface AdminUser extends AdminUserRef {
  /** Set while the account is banned. */
  bannedAt: string | null;
  banReason: string | null;
  /** Spam violations recorded in the last 24 hours. */
  recentAbuse: number;
}

/** A group as listed to the admin, deleted ones included. */
export interface AdminGroup {
  id: string;
  name: string;
  inviteCode: string;
  memberCount: number;
  expenseCount: number;
  createdAt: string;
  deletedAt: string | null;
}

/** An address the API refuses. `expiresAt` null means until an admin lifts it. */
export interface IpBan {
  ip: string;
  reason: string;
  source: "admin" | "auto";
  createdAt: string;
  expiresAt: string | null;
}

/** An address that produced spam violations but is not banned (yet). */
export interface IpSuspect {
  ip: string;
  accounts: number;
  events: number;
  lastAt: string;
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
 * The bank account a member receives transfers on, used to render a VietQR payment code.
 * `bin` is a 6-digit NAPAS BIN, `accountNo` 6..19 digits, `accountName` 1..50 characters.
 */
export interface BankInfo {
  bin: string;
  accountNo: string;
  accountName: string;
}

/**
 * A group member. `userId`/`username` are null for a friend added without an account.
 * `removedAt` is set on a soft delete (removed members stay readable).
 * `bank` is null until every one of the three stored bank columns is set.
 */
export interface Member {
  id: string;
  groupId: string;
  name: string;
  userId: string | null;
  username: string | null;
  removedAt: string | null;
  createdAt: string;
  bank: BankInfo | null;
}

/** One member's portion of an expense. */
export interface ExpenseShare {
  memberId: string;
  amount: number;
}

/**
 * `expense` is a shared cost; `payment` is a settlement transfer recorded as an ordinary
 * paid/share row (payer paid one other member), so it cancels that debt automatically.
 */
export type ExpenseKind = "expense" | "payment";

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
  /** Immutable once created: an edit never changes it (docs/CONTRACT.md § ENDPOINTS). */
  kind: ExpenseKind;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

/** A named unit price the expense form multiplies by a quantity. `unitPrice` is integer VND. */
export interface Preset {
  id: string;
  groupId: string;
  name: string;
  unitPrice: number;
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
  | "member.bank"
  | "expense.create"
  | "expense.update"
  | "expense.delete"
  | "preset.create"
  | "preset.update"
  | "preset.delete"
  | "preset.sync"
  | "group.rename"
  | "group.delete"
  | "group.restore";

export type LogEntityType = "group" | "member" | "expense" | "preset";

/** Error codes mapped 1:1 to HTTP statuses by lib/http.ts. */
export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
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
