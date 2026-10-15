import { cookies } from "next/headers";

import { getDb, newId, nowIso } from "./db";
import { forbidden, notFound, unauthorized } from "./errors";
import type { User, UserRole } from "./types";

/**
 * Authentication: password hashing, session lifecycle and the request auth guards.
 *
 * Implemented with WebCrypto only (no Node `crypto`), so the same code runs on workerd and in
 * the Next.js dev server.
 */

/** Session cookie name — the contract's single auth credential. */
export const SESSION_COOKIE = "sid";

const PBKDF2_ITERATIONS = 100_000; // the Workers maximum
const PBKDF2_KEY_BYTES = 32;
const SALT_BYTES = 16;
const SESSION_TOKEN_BYTES = 32;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

// ---------------------------------------------------------------------------
// byte helpers
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Length-independent, value-independent comparison (no early exit on the first mismatch). */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a[i]! ^ b[i]!;
  }
  return difference === 0;
}

/** Random bytes as base64url (cookie-safe, no padding). */
function randomToken(byteLength: number): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

// ---------------------------------------------------------------------------
// passwords
// ---------------------------------------------------------------------------

async function derivePassword(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    PBKDF2_KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** Derives a PBKDF2-SHA256 hash with a fresh random salt. */
export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derivePassword(password, salt);
  return { hash: bytesToBase64(hash), salt: bytesToBase64(salt) };
}

/** Re-derives with the stored salt and compares in constant time. */
export async function verifyPassword(
  password: string,
  hash: string,
  salt: string,
): Promise<boolean> {
  const expected = base64ToBytes(salt);
  const actual = await derivePassword(password, expected);
  return timingSafeEqual(actual, base64ToBytes(hash));
}

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS,
  };
}

/**
 * Issues a session for `userId` and sets the `sid` cookie.
 *
 * The raw token is what the browser holds; the database stores only its sha256 hex, so a
 * database read cannot yield a usable credential.
 */
export async function createSession(userId: string): Promise<void> {
  const token = randomToken(SESSION_TOKEN_BYTES);
  const id = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

  await getDb()
    .prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, userId, expiresAt, nowIso())
    .run();

  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions());
}

/** Deletes the caller's session row and clears the cookie. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    const id = await sha256Hex(token);
    sessionCache.delete(id);
    await getDb().prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
  }

  store.delete(SESSION_COOKIE);
}

// ---------------------------------------------------------------------------
// session cache
// ---------------------------------------------------------------------------

/**
 * Every API call resolves its session (sessions JOIN users). A friend group fires dozens of
 * calls per minute, so each isolate remembers a resolved session for a few seconds and skips
 * that D1 read. Trade-off: a logout handled by ANOTHER isolate is honoured here only after
 * the TTL, so keep it short. The cache never outlives the session's own expiry.
 */
const SESSION_CACHE_TTL_MS = 30_000;
const SESSION_CACHE_MAX = 500;
const sessionCache = new Map<string, { user: User; until: number }>();

/**
 * Tokens that resolved to no session. An attacker sending random cookies would otherwise cost
 * one D1 read per request; a token that does not exist cannot start existing, so remembering
 * the miss for a minute is safe.
 */
const UNKNOWN_TOKEN_TTL_MS = 60_000;
const unknownTokens = new Map<string, number>();

/** Test hook: forget every cached session. */
export function clearSessionCache(): void {
  sessionCache.clear();
  unknownTokens.clear();
}

function cacheSession(id: string, user: User, expiresAt: string): void {
  if (sessionCache.size >= SESSION_CACHE_MAX) {
    sessionCache.clear();
  }
  const until = Math.min(Date.now() + SESSION_CACHE_TTL_MS, Date.parse(expiresAt));
  sessionCache.set(id, { user, until });
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  banned_at: string | null;
  created_at: string;
  expires_at: string;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
  };
}

/** Resolves the session cookie to its user, or null when absent, unknown or expired. */
export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }

  const id = await sha256Hex(token);

  const unknownUntil = unknownTokens.get(id);
  if (unknownUntil !== undefined) {
    if (unknownUntil > Date.now()) {
      return null;
    }
    unknownTokens.delete(id);
  }

  const cached = sessionCache.get(id);
  if (cached) {
    if (cached.until > Date.now()) {
      return cached.user;
    }
    sessionCache.delete(id);
  }

  const row = await getDb()
    .prepare(
      `SELECT u.id AS id, u.username AS username, u.display_name AS display_name,
              u.role AS role, u.banned_at AS banned_at, u.created_at AS created_at, s.expires_at AS expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .bind(id, nowIso())
    .first<UserRow>();

  if (!row) {
    if (unknownTokens.size >= SESSION_CACHE_MAX) {
      unknownTokens.clear();
    }
    unknownTokens.set(id, Date.now() + UNKNOWN_TOKEN_TTL_MS);
    return null;
  }

  // A banned account has no usable session even if a cached or racing one slipped through.
  if (row.banned_at !== null) {
    return null;
  }

  const user = toUser(row);
  cacheSession(id, user, row.expires_at);
  return user;
}

/** Like `getCurrentUser`, but throws UNAUTHORIZED instead of returning null. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw unauthorized();
  }
  return user;
}

/** 403 unless the caller is the dedicated admin account. */
export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw forbidden("Chỉ tài khoản quản trị mới dùng được chức năng này.");
  }
  return user;
}

/** Groups belong to people: the admin account is kept out of creating or joining them. */
export function rejectAdmin(user: User): void {
  if (user.role === "admin") {
    throw forbidden("Tài khoản quản trị chỉ dùng để cấp lại mật khẩu, không dùng nhóm chi tiêu.");
  }
}

/** Drops this isolate's cached sessions of a user (after a password re-issue). */
export function forgetUserSessions(userId: string): void {
  for (const [id, entry] of sessionCache) {
    if (entry.user.id === userId) {
      sessionCache.delete(id);
    }
  }
}

/** How the admin account appears in group logs and summaries. */
export const ADMIN_ACTOR_NAME = "Quản trị viên";

/** The caller's own active member row in a group. */
export interface GroupMemberRef {
  id: string;
  groupId: string;
  name: string;
}

/**
 * Confirms the group exists and the caller is one of its active members, returning the
 * caller's member row. NOT_FOUND when the group does not exist, FORBIDDEN when the caller
 * is not an active member.
 */
export async function requireGroupMember(groupId: string, user: User): Promise<GroupMemberRef> {
  // One round trip tells the two failures apart: no group row = NOT_FOUND, group row but no
  // active membership = FORBIDDEN. Both lookups are primary-key / unique-index probes.
  const row = await getDb()
    .prepare(
      `SELECT g.id AS group_id, g.deleted_at AS deleted_at, m.id AS member_id, m.name AS member_name
       FROM groups g
       LEFT JOIN group_members m
         ON m.group_id = g.id AND m.user_id = ? AND m.removed_at IS NULL
       WHERE g.id = ?`,
    )
    .bind(user.id, groupId)
    .first<{
      group_id: string;
      deleted_at: string | null;
      member_id: string | null;
      member_name: string | null;
    }>();

  if (!row) {
    throw notFound("Không tìm thấy nhóm.");
  }

  // The admin account manages every group (deleted ones too, to restore them) as a built-in
  // "Quản trị viên" actor, so each existing group route works for it unchanged and every
  // change it makes lands in the group's activity log under that name.
  if (user.role === "admin") {
    return { id: `admin:${user.id}`, groupId: row.group_id, name: ADMIN_ACTOR_NAME };
  }
  if (row.deleted_at !== null) {
    throw notFound("Không tìm thấy nhóm.");
  }
  if (!row.member_id || row.member_name === null) {
    throw forbidden("Bạn không phải là thành viên của nhóm này.");
  }

  return { id: row.member_id, groupId: row.group_id, name: row.member_name };
}
