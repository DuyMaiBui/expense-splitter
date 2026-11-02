import { cookies } from "next/headers";

import { forgetUserSessions, hashPassword, requireUser, SESSION_COOKIE, verifyPassword } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { badRequest } from "@/lib/errors";
import { ok, readJson, route } from "@/lib/http";
import { parseNumericPassword } from "@/lib/password-reset";
import { obj, str } from "@/lib/validate";

interface CredentialRow {
  password_hash: string;
  password_salt: string;
}

/**
 * sha256 hex of the `sid` cookie — the `sessions.id` the session was created under.
 *
 * lib/auth.ts keeps this derivation private (lib/http.ts carries the same few lines for its
 * per-session budget), so the route mirrors it rather than exporting a helper from a file it does
 * not own. The value is used only to EXCLUDE one row from a delete.
 */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The caller's own session row id (sha256 of the cookie), or null when there is no cookie. */
async function currentSessionId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? sha256Hex(token) : null;
}

/**
 * Changes the caller's own password (docs/CONTRACT.md § PASSWORD RESET).
 *
 * The current password is checked with the same primitive login uses, so a borrowed device cannot
 * become a takeover. The new password is digits only (the product requirement). Every OTHER
 * session of the user is deleted — a password change must sign out the other devices — while the
 * caller's own session is kept, so changing a password does not bounce the person doing it.
 *
 * The admin account may use this like anyone else: it is changing its OWN password, not someone
 * else's. Profile/security data is not group-scoped, so no activity_log row is written.
 */
export const POST = route(
  async (req) => {
    const user = await requireUser();

    const body = await readJson(req, (raw) => {
      const o = obj(raw, "body");
      return {
        // Never trimmed: leading/trailing spaces are part of the existing secret.
        currentPassword: str(o.currentPassword, "currentPassword", { min: 1, max: 128, trim: false }),
        newPassword: parseNumericPassword(o.newPassword),
      };
    });

    const db = getDb();
    const row = await db
      .prepare("SELECT password_hash, password_salt FROM users WHERE id = ?")
      .bind(user.id)
      .first<CredentialRow>();

    if (!row) {
      // The session resolved to a user that no longer exists: treat it as an expired login.
      await hashPassword(body.currentPassword);
      throw badRequest("Mật khẩu hiện tại không đúng.");
    }

    const valid = await verifyPassword(body.currentPassword, row.password_hash, row.password_salt);
    if (!valid) {
      throw badRequest("Mật khẩu hiện tại không đúng.");
    }

    const { hash, salt } = await hashPassword(body.newPassword);

    // Delete every session of this user EXCEPT the one making the request. A missing cookie
    // (should not happen behind requireUser) simply means every session goes.
    const keep = await currentSessionId();
    const statements: D1PreparedStatement[] = [
      db.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").bind(hash, salt, user.id),
    ];

    if (keep) {
      statements.push(
        db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").bind(user.id, keep),
      );
    } else {
      statements.push(db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id));
    }

    await db.batch(statements);

    // The isolate caches the resolved session for up to 30s; the cached entry is still the same
    // user, but dropping it keeps every read consistent after a credential change.
    forgetUserSessions(user.id);

    return ok({});
  },
  // PBKDF2 (verify + hash) makes each call CPU-expensive: share the stricter login budget.
  { limit: "auth" },
);
