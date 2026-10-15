import type { Group, Member } from "./types";

/**
 * Group and member reads shared by the group, member, expense and settlement routes.
 * Rows are snake_case as stored; everything leaving this module is the contract's camelCase.
 */

interface MemberRow {
  id: string;
  group_id: string;
  user_id: string | null;
  name: string;
  removed_at: string | null;
  created_at: string;
  username: string | null;
}

const MEMBER_SELECT = `
  SELECT m.id AS id, m.group_id AS group_id, m.user_id AS user_id, m.name AS name,
         m.removed_at AS removed_at, m.created_at AS created_at, u.username AS username
  FROM group_members m
  LEFT JOIN users u ON u.id = m.user_id`;

export function toMember(row: MemberRow): Member {
  return {
    id: row.id,
    groupId: row.group_id,
    name: row.name,
    userId: row.user_id,
    username: row.username,
    removedAt: row.removed_at,
    createdAt: row.created_at,
  };
}

/** Every member of a group, removed ones included, oldest first. */
export async function listMembers(db: D1Database, groupId: string): Promise<Member[]> {
  const { results } = await db
    .prepare(`${MEMBER_SELECT} WHERE m.group_id = ? ORDER BY m.created_at ASC, m.id ASC`)
    .bind(groupId)
    .all<MemberRow>();
  return results.map(toMember);
}

export async function getMember(
  db: D1Database,
  groupId: string,
  memberId: string,
): Promise<Member | null> {
  const row = await db
    .prepare(`${MEMBER_SELECT} WHERE m.group_id = ? AND m.id = ?`)
    .bind(groupId, memberId)
    .first<MemberRow>();
  return row ? toMember(row) : null;
}

interface GroupRow {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
  my_member_id: string;
  member_count: number;
}

const GROUP_SELECT = `
  SELECT g.id AS id, g.name AS name, g.invite_code AS invite_code, g.created_at AS created_at,
         mm.id AS my_member_id,
         (SELECT COUNT(*) FROM group_members c WHERE c.group_id = g.id AND c.removed_at IS NULL) AS member_count
  FROM groups g
  JOIN group_members mm ON mm.group_id = g.id AND mm.user_id = ? AND mm.removed_at IS NULL`;

function toGroup(row: GroupRow): Group {
  return {
    id: row.id,
    name: row.name,
    inviteCode: row.invite_code,
    memberCount: row.member_count,
    myMemberId: row.my_member_id,
    createdAt: row.created_at,
  };
}

/** The groups a user is an active member of, newest first. */
export async function listGroupsForUser(db: D1Database, userId: string): Promise<Group[]> {
  const { results } = await db
    .prepare(`${GROUP_SELECT} ORDER BY g.created_at DESC, g.id DESC`)
    .bind(userId)
    .all<GroupRow>();
  return results.map(toGroup);
}

/** One group as seen by `userId`, or null if they are not an active member. */
export async function getGroupView(
  db: D1Database,
  groupId: string,
  userId: string,
): Promise<Group | null> {
  const row = await db
    .prepare(`${GROUP_SELECT} WHERE g.id = ?`)
    .bind(userId, groupId)
    .first<GroupRow>();
  return row ? toGroup(row) : null;
}

// No 0/O/1/I/L: the code is read aloud and typed by hand.
const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const INVITE_LENGTH = 8;

export function generateInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(INVITE_LENGTH));
  let code = "";
  for (const byte of bytes) {
    code += INVITE_ALPHABET[byte % INVITE_ALPHABET.length];
  }
  return code;
}

/** Case-insensitive, Vietnamese-aware name comparison (JS, since SQLite lower() is ASCII-only). */
export function sameName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase("vi") === b.trim().toLocaleLowerCase("vi");
}
