/**
 * Shared domain types — the single source of truth for every shape crossing the API boundary.
 * See docs/CONTRACT.md for the authoritative specification these mirror.
 */

/** `admin` is a dedicated account that only re-issues passwords; it never joins groups. */
export type UserRole = "user" | "admin";

/**
 * A registered account.
 *
 * `bank` is the caller's OWN receiving account (never another user's): it is returned by
 * register/login/me and edited only through PUT /api/profile/bank. Member rows elsewhere carry
 * the same account, derived from the linked user.
 *
 * `email` is the caller's OWN recovery address, normalised (trimmed, lowercased) or null when
 * unset. It is edited only through PUT /api/profile/email and is the recovery channel for a
 * forgotten password. One address belongs to at most one account (a second account asking for it
 * gets 409 CONFLICT). `User` is only ever returned for the caller, so it needs no redaction.
 */
export interface User {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  bank: BankInfo | null;
  email: string | null;
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
 * The receiving account of a USER's profile, used to render a VietQR payment code.
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
 *
 * `bank` is DERIVED from the member's linked user (LEFT JOIN users) and is always null for a
 * friend without an account: a member owns no bank info of its own. `isOwner` is true for the
 * one member whose `userId` matches `groups.created_by`.
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
  isOwner: boolean;
}

/**
 * The caller relative to ONE group, returned alongside every group-scoped read so the UI can
 * decide what to show without a second request. `memberId` is null for the admin account (it
 * holds no member row); `isAdmin` is true for it and it counts as owner-level everywhere.
 */
export interface Viewer {
  userId: string;
  memberId: string | null;
  isOwner: boolean;
  isAdmin: boolean;
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

/**
 * A member's settlement position. `net = paid - owed`; net > 0 means they should receive money.
 *
 * `paid` and `owed` mix spending with settlement transfers, so the four fields below split them:
 * `paid = spentPaid + paymentsOut` and `owed = spentOwed + paymentsIn`, hence
 * `net = (spentPaid - spentOwed) + (paymentsOut - paymentsIn)`. The UI reads the split to tell
 * real spending ("chi ra" / "nhận lại") apart from money that moved to settle debt.
 * Group-wide, `sum(spentPaid) = sum(spentOwed) = totalSpent` and `sum(paymentsOut) = sum(paymentsIn)`.
 * All four are integer VND >= 0; a member with no rows has all four at 0.
 */
export interface Balance {
  memberId: string;
  name: string;
  removed: boolean;
  paid: number;
  owed: number;
  net: number;
  /** Sum of the amounts of live `kind = "expense"` rows this member paid. */
  spentPaid: number;
  /** Sum of this member's shares on live `kind = "expense"` rows. */
  spentOwed: number;
  /** Sum of the amounts of live `kind = "payment"` rows this member paid (money sent to settle debt). */
  paymentsOut: number;
  /** Sum of this member's shares on live `kind = "payment"` rows (money received to settle debt). */
  paymentsIn: number;
}

/** A single settlement payment suggestion. */
export interface Transfer {
  fromMemberId: string;
  toMemberId: string;
  amount: number;
}

/** The range a spending chart covers: everything, one local year, or one local month. */
export type StatsPeriod = "all" | "year" | "month";

/**
 * One column of a spending chart. `key` is the bucket identity the SQL groups by ("2026",
 * "03", "31"); `label` is what an axis renders ("2026", "T3", "31").
 */
export interface StatsBucket {
  key: string;
  label: string;
  /** Integer VND spent in this bucket. */
  amount: number;
  /** Number of expenses in this bucket. */
  count: number;
}

/** A member's activity inside the charted range; only members with some activity appear. */
export interface StatsMember {
  memberId: string;
  name: string;
  removed: boolean;
  /** Sum of this member's shares in the range. */
  owed: number;
  /** Sum of the expenses this member paid in the range. */
  paid: number;
}

/**
 * Everything one spending-chart request returns. `total`/`count` cover the whole range, which
 * is the same as the sum over `buckets` for every period; only non-deleted `kind = "expense"`
 * rows count (a settlement payment is never spending).
 */
export interface GroupStats {
  period: StatsPeriod;
  /** null when `period` is "all". */
  year: number | null;
  /** 1..12, only when `period` is "month". */
  month: number | null;
  total: number;
  count: number;
  buckets: StatsBucket[];
  members: StatsMember[];
}

/**
 * `member.bank` is no longer written (bank info is the user's profile, not a group-scoped
 * change); it stays in the union so historical log rows still render.
 */
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

/**
 * One row of a member's ledger: every live expense or payment that involves the member (as payer,
 * as participant, or both). Computed by lib/ledger.ts; reflects the CURRENT state of each row.
 *
 * `paid` is what this member paid on the row (`expense.amount` when they are the payer, else 0);
 * `share` is this member's `expense_shares.amount` on the row (0 if none). `delta = paid - share`.
 * `runningNet` is the cumulative sum of `delta` through this row, in ledger order. The member is
 * "huề" (settled) after a row when `runningNet === 0` (`settledAfter`).
 *
 * `counterpartyMemberId`/`counterpartyName` are set only for `kind = "payment"`: the OTHER party
 * (the receiver when this member paid, the payer when this member received). Null for expenses.
 */
export interface LedgerEntry {
  expenseId: string;
  kind: ExpenseKind;
  title: string;
  /** ISO UTC, as stored. Display only: entries are ordered by `createdAt` (entry time), never by this. */
  spentAt: string;
  paidByMemberId: string;
  paidByName: string;
  /** Integer VND this member paid on this row. */
  paid: number;
  /** Integer VND this member owes on this row (their share). */
  share: number;
  /** `paid - share`: >0 raises what the member is owed, <0 lowers it. */
  delta: number;
  /** Cumulative sum of `delta` including this row, in ledger order. */
  runningNet: number;
  /** `runningNet === 0` after this row ("huề"). */
  settledAfter: boolean;
  counterpartyMemberId: string | null;
  counterpartyName: string | null;
}

/**
 * Same meaning as `Balance` (see above), computed over ledger entries. `net` = sum of `delta`, and
 * `net = (spentPaid - spentOwed) + (paymentsOut - paymentsIn)`.
 */
export interface LedgerTotals {
  spentPaid: number;
  spentOwed: number;
  paymentsOut: number;
  paymentsIn: number;
  net: number;
}

/** One member's full ledger, from their first row to now, in ledger order. */
export interface MemberLedger {
  memberId: string;
  name: string;
  removed: boolean;
  entries: LedgerEntry[];
  totals: LedgerTotals;
}
