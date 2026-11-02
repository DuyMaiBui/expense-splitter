import { hashPassword, verifyPassword } from "./auth";
import { badRequest } from "./errors";

/**
 * The "quên mật khẩu" one-time code: generation, storage and verification.
 *
 * The code is SIX DIGITS, drawn from `crypto.getRandomValues` with rejection sampling, so every
 * code in 000000..999999 is equally likely (no modulo bias). Only a PBKDF2 hash of the code and a
 * per-code salt are stored — reusing `lib/auth.ts#hashPassword`, the same primitive that protects
 * passwords — so a database read cannot yield a usable code, and the plaintext is never logged.
 *
 * Rules enforced here (docs/CONTRACT.md § PASSWORD RESET):
 *   - 10 minute TTL;
 *   - single use (the row is claimed atomically before the password is written);
 *   - issuing a new code deletes the user's previous outstanding rows;
 *   - 5 wrong guesses invalidate the code, so a 6-digit space cannot be brute-forced.
 */

export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;

/** Same minimum as registration (docs/CONTRACT.md § ENDPOINTS), maximum matches every password. */
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 128;

const DIGIT_SPACE = 10;
/** Bytes at or above this would bend the distribution toward the low digits. */
const MAX_UNBIASED_BYTE = 256 - (256 % DIGIT_SPACE); // 250
const DIGITS_ONLY = /^[0-9]+$/;
const CODE_PATTERN = /^[0-9]{6}$/;

/** Test seam: the byte source `generateNumericCode` draws from (WebCrypto by default). */
export type RandomBytes = (length: number) => Uint8Array;

function secureRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * A fresh 6-digit code as a string (leading zeros preserved).
 *
 * Each byte is accepted only when it is below 250, where `byte % 10` is uniform over 0..9;
 * bytes 250..255 are drawn again. That is the same rejection-sampling shape as
 * `scripts/create-admin.mjs#generatePassword`.
 */
export function generateNumericCode(random: RandomBytes = secureRandomBytes): string {
  let code = "";

  // Bounded so a broken injected source cannot spin forever; the real source never empties
  // the loop (250 of 256 byte values are accepted).
  for (let round = 0; round < 1_000 && code.length < CODE_LENGTH; round += 1) {
    for (const byte of random(CODE_LENGTH * 2)) {
      if (byte < MAX_UNBIASED_BYTE && code.length < CODE_LENGTH) {
        code += String(byte % DIGIT_SPACE);
      }
    }
  }

  if (code.length !== CODE_LENGTH) {
    throw new Error("Không tạo được mã xác nhận: nguồn số ngẫu nhiên trả về dữ liệu không hợp lệ.");
  }
  return code;
}

/** Everything a code may be: exactly six digits, nothing else. */
export function parseResetCode(value: unknown, field = "code"): string {
  if (typeof value !== "string" || !CODE_PATTERN.test(value.trim())) {
    throw badRequest(`Trường "${field}" phải là ${CODE_LENGTH} chữ số.`);
  }
  return value.trim();
}

/**
 * A NEW password for the reset and change flows: digits only (the product requirement), at
 * least 6 and at most 128 characters.
 *
 * The length/type checks reuse `lib/validate.ts#str` conventions, so the messages match every
 * other payload error; the digits rule is specific to a new password and names its field.
 */
export function parseNumericPassword(value: unknown, field = "newPassword"): string {
  if (typeof value !== "string") {
    throw badRequest(`Trường "${field}" phải là chuỗi.`);
  }

  // Passwords are never trimmed: a space is never part of a valid numeric password, and
  // trimming would silently accept it.
  const password = value;

  if (password.length < PASSWORD_MIN_LENGTH) {
    throw badRequest(`Trường "${field}" phải có ít nhất ${PASSWORD_MIN_LENGTH} ký tự.`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw badRequest(`Trường "${field}" không được vượt quá ${PASSWORD_MAX_LENGTH} ký tự.`);
  }
  if (!DIGITS_ONLY.test(password)) {
    throw badRequest(`Trường "${field}" chỉ được gồm các chữ số.`);
  }

  return password;
}

/** The subject line of the reset email (Vietnamese, like the rest of the UI). */
export const RESET_CODE_SUBJECT = "Mã đặt lại mật khẩu — Chia tiền nhóm";

/**
 * The email body: plain text, Vietnamese, the code on its own line, and the expiry spelled out.
 * Nothing else about the account is included — the recipient already knows their username.
 */
export function buildResetEmailText(input: {
  displayName: string;
  username: string;
  code: string;
}): string {
  const minutes = Math.round(CODE_TTL_MS / 60_000);
  return [
    `Xin chào ${input.displayName},`,
    "",
    `Có yêu cầu đặt lại mật khẩu cho tài khoản "${input.username}".`,
    `Mã xác nhận của bạn là: ${input.code}`,
    "",
    `Mã này chỉ dùng được một lần và hết hạn sau ${minutes} phút.`,
    "Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này; mật khẩu hiện tại vẫn giữ nguyên.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------

interface ResetCodeRow {
  id: string;
  code_hash: string;
  code_salt: string;
  attempts: number;
  expires_at: string;
  used_at: string | null;
}

/** Why a code was refused. Only `ok` lets a route change a password. */
export type ResetCodeVerdict = "ok" | "invalid";

function isoAt(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Issues a code for `userId` and returns its plaintext, which the caller emails and then drops.
 *
 * The user's outstanding rows are deleted first, in the same batch as the insert, so a second
 * request invalidates the first code rather than leaving two valid codes alive.
 *
 * `random` is a test seam only: production always uses WebCrypto.
 */
export async function createResetCode(
  db: D1Database,
  userId: string,
  now: number = Date.now(),
  random: RandomBytes = secureRandomBytes,
): Promise<string> {
  const code = generateNumericCode(random);
  const { hash, salt } = await hashPassword(code);

  await db.batch([
    db.prepare("DELETE FROM password_reset_codes WHERE user_id = ?").bind(userId),
    db
      .prepare(
        `INSERT INTO password_reset_codes
           (id, user_id, code_hash, code_salt, attempts, expires_at, used_at, created_at)
         VALUES (?, ?, ?, ?, 0, ?, NULL, ?)`,
      )
      .bind(crypto.randomUUID(), userId, hash, salt, isoAt(now + CODE_TTL_MS), isoAt(now)),
  ]);

  return code;
}

/**
 * Checks `code` against the user's newest row and, when it matches, CLAIMS that row for single
 * use before returning `ok`.
 *
 * Every refusal looks identical to the caller (`invalid`); which check failed — no row, used,
 * expired, attempt cap, wrong digits — is deliberately not distinguishable in the API response.
 *
 * A wrong guess increments `attempts`; the fifth one also stamps `used_at`, so the code is dead
 * even if the right digits arrive afterwards. The claim uses `WHERE used_at IS NULL` and checks
 * the affected-row count, so two concurrent resets cannot both succeed.
 */
export async function verifyResetCode(
  db: D1Database,
  userId: string,
  code: string,
  now: string = new Date().toISOString(),
): Promise<ResetCodeVerdict> {
  const row = await db
    .prepare(
      `SELECT id, code_hash, code_salt, attempts, expires_at, used_at
       FROM password_reset_codes
       WHERE user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(userId)
    .first<ResetCodeRow>();

  if (!row || row.used_at !== null || row.expires_at <= now || row.attempts >= MAX_ATTEMPTS) {
    return "invalid";
  }

  if (!(await verifyPassword(code, row.code_hash, row.code_salt))) {
    await db
      .prepare(
        `UPDATE password_reset_codes
         SET attempts = attempts + 1,
             used_at = CASE WHEN attempts + 1 >= ? THEN ? ELSE used_at END
         WHERE id = ?`,
      )
      .bind(MAX_ATTEMPTS, now, row.id)
      .run();
    return "invalid";
  }

  const claimed = await db
    .prepare("UPDATE password_reset_codes SET used_at = ? WHERE id = ? AND used_at IS NULL")
    .bind(now, row.id)
    .run();
  return claimed.meta.changes === 1 ? "ok" : "invalid";
}

/** Drops every code row of a user (after a successful reset). */
export async function clearResetCodes(db: D1Database, userId: string): Promise<void> {
  await db.prepare("DELETE FROM password_reset_codes WHERE user_id = ?").bind(userId).run();
}
