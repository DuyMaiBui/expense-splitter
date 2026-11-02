import { forgetUserSessions, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { badRequest, conflict, forbidden } from "@/lib/errors";
import { ok, readJson, route } from "@/lib/http";
import type { User } from "@/lib/types";
import { obj, parseEmail } from "@/lib/validate";

/**
 * The caller's OWN recovery email (docs/CONTRACT.md § ENDPOINTS).
 *
 * There is no id parameter anywhere: the row written is always the session user's, so nobody can
 * point a reset flow at an address they do not control. `null` clears the address; a body without
 * the `email` key is rejected instead of being read as a clear. Profile data is not group-scoped,
 * so no activity_log row is written.
 *
 * ONE address per account, and one account per address: a second account asking for an address
 * that is already taken gets 409 CONFLICT, and setting the caller's own current address again is
 * a successful no-op.
 */

const EMAIL_TAKEN_MESSAGE = "Email này đã được dùng cho tài khoản khác.";

/**
 * `{email: null}` clears; `{email: string}` normalises (trim + lowercase) then validates through
 * lib/validate.ts#parseEmail. A missing `email` key is a 400: an empty body must never be
 * mistaken for "clear my address".
 */
function parseEmailBody(raw: unknown): string | null {
  const body = obj(raw, "body");
  if (!("email" in body)) {
    throw badRequest('Trường "email" là bắt buộc: gửi null để xóa địa chỉ email.');
  }
  return body.email === null ? null : parseEmail(body.email);
}

/**
 * Whether a database failure is this column's unique index refusing a duplicate.
 *
 * D1 and node:sqlite both report it as "UNIQUE constraint failed: users.email" — matching on that
 * exact text (not every UNIQUE error) keeps a different constraint's failure visible as a 500
 * rather than silently mislabelling it as "email taken".
 */
function isEmailConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed: users\.email\b/i.test(message);
}

export const PUT = route(async (req) => {
  const user = await requireUser();
  // The admin account has no recovery address: it is not a person anyone resets.
  if (user.role === "admin") {
    throw forbidden("Tài khoản quản trị không có địa chỉ email khôi phục.");
  }

  const email = await readJson(req, parseEmailBody);

  // Setting the caller's own current address again is a success, not a conflict: re-saving the
  // form must never be an error, and no row needs to move.
  if (email === user.email) {
    return ok({ user });
  }

  const db = getDb();

  if (email !== null) {
    // A clean message before the write, but NOT the guarantee: two accounts can race between this
    // read and the UPDATE below, so the unique index stays the authority (see the catch).
    const holder = await db
      .prepare("SELECT id FROM users WHERE email = ? AND id != ?")
      .bind(email, user.id)
      .first<{ id: string }>();
    if (holder) {
      throw conflict(EMAIL_TAKEN_MESSAGE);
    }
  }

  try {
    await db.prepare("UPDATE users SET email = ? WHERE id = ?").bind(email, user.id).run();
  } catch (error) {
    // The index refused the write: another account took the address after the pre-check. A race
    // must end in the same 409 the pre-check would have produced, never a 500.
    if (isEmailConflict(error)) {
      throw conflict(EMAIL_TAKEN_MESSAGE);
    }
    throw error;
  }

  // This isolate caches the resolved session for up to 30s. Drop it, so the very next
  // /api/auth/me serves the address that was just written.
  forgetUserSessions(user.id);

  const updated: User = { ...user, email };
  return ok({ user: updated });
});
