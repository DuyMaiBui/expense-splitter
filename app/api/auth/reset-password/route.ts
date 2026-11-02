import { forgetUserSessions, hashPassword } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { badRequest } from "@/lib/errors";
import { ok, readJson, route } from "@/lib/http";
import { clearResetCodes, parseNumericPassword, parseResetCode, verifyResetCode } from "@/lib/password-reset";
import type { UserRole } from "@/lib/types";
import { obj, str } from "@/lib/validate";

interface ResetTargetRow {
  id: string;
  role: UserRole;
}

/** One message for every kind of refusal: which part failed is deliberately not revealed. */
const INVALID_CODE = "Mã xác nhận không đúng hoặc đã hết hạn. Vui lòng yêu cầu mã mới.";

/**
 * Completes the "quên mật khẩu" flow (docs/CONTRACT.md § PASSWORD RESET).
 *
 * Looks the user up by username, verifies the emailed code, then replaces the password with a
 * digits-only one. EVERY session of that user is deleted, so anyone holding a stolen login is
 * signed out at once. A wrong username and a wrong code produce the same 400, so the response
 * reveals nothing about which accounts exist.
 */
export const POST = route(
  async (req) => {
    const body = await readJson(req, (raw) => {
      const o = obj(raw, "body");
      return {
        username: str(o.username, "username", { min: 1, max: 32 }).toLowerCase(),
        code: parseResetCode(o.code),
        newPassword: parseNumericPassword(o.newPassword),
      };
    });

    const db = getDb();
    const user = await db
      .prepare("SELECT id, role FROM users WHERE username = ? AND banned_at IS NULL")
      .bind(body.username)
      .first<ResetTargetRow>();

    if (!user || user.role === "admin") {
      throw badRequest(INVALID_CODE);
    }

    const verdict = await verifyResetCode(db, user.id, body.code);
    if (verdict !== "ok") {
      throw badRequest(INVALID_CODE);
    }

    const { hash, salt } = await hashPassword(body.newPassword);

    // The password and every session move together: a reset that lands but leaves a session
    // alive would be no reset at all. The code row is already claimed by verifyResetCode.
    await db.batch([
      db
        .prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ? AND role = 'user'")
        .bind(hash, salt, user.id),
      db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    ]);
    await clearResetCodes(db, user.id);
    forgetUserSessions(user.id);

    // No session is issued here: the user signs in again with the new password.
    return ok({});
  },
  // PBKDF2 per attempt: share the stricter login budget so a caller cannot grind codes.
  { limit: "auth" },
);
