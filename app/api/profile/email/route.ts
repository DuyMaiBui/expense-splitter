import { forgetUserSessions, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { badRequest, forbidden } from "@/lib/errors";
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
 */

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

export const PUT = route(async (req) => {
  const user = await requireUser();
  // The admin account has no recovery address: it is not a person anyone resets.
  if (user.role === "admin") {
    throw forbidden("Tài khoản quản trị không có địa chỉ email khôi phục.");
  }

  const email = await readJson(req, parseEmailBody);

  await getDb().prepare("UPDATE users SET email = ? WHERE id = ?").bind(email, user.id).run();

  // This isolate caches the resolved session for up to 30s. Drop it, so the very next
  // /api/auth/me serves the address that was just written.
  forgetUserSessions(user.id);

  const updated: User = { ...user, email };
  return ok({ user: updated });
});
