import { cookies } from "next/headers";

import { getDb, newId, nowIso } from "./db";
import { forbidden, notFound, unauthorized } from "./errors";
import type { User } from "./types";

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
    await getDb()
      .prepare("DELETE FROM sessions WHERE id = ?")
      .bind(await sha256Hex(token))
      .run();
  }

  store.delete(SESSION_COOKIE);
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  created_at: string;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
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

  const row = await getDb()
    .prepare(
      `SELECT u.id AS id, u.username AS username, u.display_name AS display_name, u.created_at AS created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .bind(await sha256Hex(token), nowIso())
    .first<UserRow>();

  return row ? toUser(row) : null;
}

/** Like `getCurrentUser`, but throws UNAUTHORIZED instead of returning null. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw unauthorized();
  }
  return user;
}

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
  const db = getDb();

  const group = await db
    .prepare("SELECT id FROM groups WHERE id = ?")
    .bind(groupId)
    .first<{ id: string }>();
  if (!group) {
    throw notFound("Không tìm thấy nhóm.");
  }

  const member = await db
    .prepare(
      `SELECT id, group_id, name
       FROM group_members
       WHERE group_id = ? AND user_id = ? AND removed_at IS NULL`,
    )
    .bind(groupId, user.id)
    .first<{ id: string; group_id: string; name: string }>();
  if (!member) {
    throw forbidden("Bạn không phải là thành viên của nhóm này.");
  }

  return { id: member.id, groupId: member.group_id, name: member.name };
}
