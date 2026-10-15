STACK: Next.js App Router + TypeScript on Cloudflare Workers via @opennextjs/cloudflare; D1 (SQLite) through getCloudflareContext().env.DB; no ORM, prepared statements only. UI language Vietnamese. Money = integer VND (đồng), never decimals, shown like "120.000đ".
TRANSPORT: JSON over HTTP under /api, camelCase fields, UTF-8. Auth = HttpOnly cookie `sid` (SameSite=Lax, Path=/, Secure in prod, 30 days). Every route except register/login requires auth.
SUCCESS ENVELOPE: HTTP 200 (201 on create) `{"ok":true,"data":{...}}`; `data` is ALWAYS an object (never bare array/null); empty result = `{}`.
ERROR ENVELOPE: `{"ok":false,"error":{"code":"<CODE>","message":"<Vietnamese text>"}}`, CODE → status: UNAUTHORIZED 401, FORBIDDEN 403, NOT_FOUND 404, VALIDATION 400, CONFLICT 409, INTERNAL 500. Group missing → NOT_FOUND; caller not an active member → FORBIDDEN.
TYPES (lib/types.ts is SSOT):
- User {id, username, displayName, createdAt}
- Group {id, name, inviteCode, memberCount, myMemberId, createdAt}
- Member {id, groupId, name, userId: string|null, username: string|null, removedAt: string|null, createdAt}
- ExpenseShare {memberId, amount}
- Expense {id, groupId, title, amount, paidByMemberId, spentAt, note: string|null, shares: ExpenseShare[], createdByUserId, createdAt, updatedAt}
- LogEntry {id, groupId, actorUserId, actorName, action, entityType, entityId, summary, detail: object|null, createdAt}
- Balance {memberId, name, removed: boolean, paid, owed, net}   (net = paid - owed; >0 means should receive)
- Transfer {fromMemberId, toMemberId, amount}
- LogAction = "group.create"|"member.add"|"member.join"|"member.remove"|"expense.create"|"expense.update"|"expense.delete"; LogEntityType = "group"|"member"|"expense"
IDs are UUID v4 strings (LogEntry.id = decimal string of an autoincrement integer). Timestamps ISO 8601 UTC with ms, e.g. "2026-10-15T08:30:00.000Z".
ENDPOINTS:
- POST /api/auth/register {username, displayName, password} → 201 {user}, sets cookie. username 3-32 chars [a-z0-9_.] (lowercased), displayName 1-50, password ≥ 6. Taken → 409 CONFLICT.
- POST /api/auth/login {username, password} → {user}, sets cookie; bad creds → 401 UNAUTHORIZED.
- POST /api/auth/logout → {} ; GET /api/auth/me → {user} or 401.
- GET /api/groups → {groups: Group[]} (groups the caller is an active member of); POST /api/groups {name 1-60} → 201 {group} (creates group + creator member named after displayName + invite code).
- POST /api/groups/join {inviteCode} → {group}; idempotent if already a member.
- GET /api/groups/:groupId → {group, members: Member[]}.
- GET /api/groups/:groupId/members → {members: Member[]} (includes removed ones, removedAt set). POST /api/groups/:groupId/members → 201 {member}, body is EXACTLY one of {name} (friend without account) or {username} (link a registered account; name defaults to their displayName); name 1-50, unique among active members case-insensitively (409), unknown username 404. DELETE /api/groups/:groupId/members/:memberId → {} soft delete (sets removedAt); removing the caller's own member → 409.
- GET /api/groups/:groupId/expenses → {expenses: Expense[]} non-deleted, spentAt desc. POST same path {title 1-100, amount int 1..1e12, paidByMemberId, participantMemberIds: string[] (≥1), spentAt?: ISO (default now), note?: string|null} → 201 {expense}. GET/PUT/DELETE /api/groups/:groupId/expenses/:expenseId → {expense} / {expense} (same body as POST) / {} (soft delete).
- GET /api/groups/:groupId/log?limit=&before= → {entries: LogEntry[], nextBefore: string|null} newest first, limit default 50 max 200, before = LogEntry.id cursor.
- GET /api/groups/:groupId/settlement → {balances: Balance[], transfers: Transfer[], totalSpent: number}.
SPLIT RULE: equal split among participants; sort participantMemberIds ascending; base = floor(amount/n); the first (amount mod n) get base+1; shares always sum to amount. Removed members cannot be picked for new expenses (an edit may keep removed members already in that expense). Any active member can add/edit/delete expenses and members.
LOG: every mutation writes one activity_log row in the SAME D1 batch as the mutation. summary is Vietnamese, e.g. `Hưng đã thêm chi tiêu "Ăn trưa" 120.000đ`. detail: expense.create {after: Expense}, expense.update {before: Expense, after: Expense}, expense.delete {before: Expense}, others null or {member}.
PAGES: /login, /register, /groups, /groups/[groupId]/expenses, /groups/[groupId]/expenses/new, /groups/[groupId]/expenses/[expenseId]/edit, /groups/[groupId]/members, /groups/[groupId]/settle, /groups/[groupId]/log. `/` redirects to /groups; `/groups/[groupId]` redirects to .../expenses. Pages are client components calling the API through lib/api-client.ts.

DB schema (migrations/0001_init.sql; all ids TEXT, timestamps TEXT ISO)
users(id PK, username UNIQUE COLLATE NOCASE, display_name, password_hash, password_salt, created_at) · sessions(id PK = sha256 hex of token, user_id FK, expires_at, created_at; index user_id) · groups(id PK, name, invite_code UNIQUE, created_by, created_at) · group_members(id PK, group_id FK, user_id NULL FK, name, removed_at NULL, created_at; index group_id; unique(group_id,user_id) where user_id not null) · expenses(id PK, group_id FK, title, amount INTEGER, paid_by_member_id FK, spent_at, note NULL, created_by_user_id, created_at, updated_at, deleted_at NULL; index group_id) · expense_shares(expense_id FK, member_id FK, amount INTEGER, PK(expense_id,member_id)) · activity_log(id INTEGER PRIMARY KEY AUTOINCREMENT, group_id FK, actor_user_id, actor_name, action, entity_type, entity_id, summary, detail_json NULL, created_at; index (group_id,id)).
