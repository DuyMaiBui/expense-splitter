import { forgetUserSessions, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { badRequest, forbidden } from "@/lib/errors";
import { ok, readJson, route } from "@/lib/http";
import type { BankInfo } from "@/lib/types";
import { obj } from "@/lib/validate";
import { parseBankInfo } from "@/lib/vietqr";

/**
 * The caller's OWN receiving account (docs/CONTRACT.md § ENDPOINTS).
 *
 * There is no id parameter anywhere: the row written is always the session user's, so a member
 * can never point someone else's payments at an account they do not own. `null` clears the
 * profile; a partial or malformed account is a 400 rather than a silently half-stored one, and a
 * body without the `bank` key is rejected instead of being read as a clear. Profile data is not
 * group-scoped, so no activity_log row is written.
 */

/**
 * `{bank: null}` clears; `{bank: BankInfo}` sets all three columns. A missing `bank` key is a
 * 400: an empty body must never be mistaken for "clear my account".
 */
function parseBankBody(raw: unknown): BankInfo | null {
  const body = obj(raw, "body");
  if (!("bank" in body)) {
    throw badRequest('Trường "bank" là bắt buộc: gửi null để xóa hồ sơ ngân hàng.');
  }
  return body.bank === null ? null : parseBankInfo(body.bank);
}

export const PUT = route(async (req) => {
  const user = await requireUser();
  // The admin account holds no group profile and never receives money.
  if (user.role === "admin") {
    throw forbidden("Tài khoản quản trị không có hồ sơ ngân hàng.");
  }

  const bank = await readJson(req, parseBankBody);

  // All three columns move together, or all three become NULL: a row can never hold a
  // half-filled account (see `toBankInfo`, which reads such a row as no account at all).
  await getDb()
    .prepare(
      "UPDATE users SET bank_bin = ?, bank_account_no = ?, bank_account_name = ? WHERE id = ?",
    )
    .bind(bank?.bin ?? null, bank?.accountNo ?? null, bank?.accountName ?? null, user.id)
    .run();

  // This isolate caches the resolved session for up to 30s. Drop it, so the very next
  // /api/auth/me (or any other read) serves the profile that was just written.
  forgetUserSessions(user.id);

  return ok({ user: { ...user, bank } });
});
