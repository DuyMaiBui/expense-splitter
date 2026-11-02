import { hashPassword } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { buildResetEmailText, createResetCode, RESET_CODE_SUBJECT } from "@/lib/password-reset";
import { getEmailSenderDetails } from "@/lib/email";
import { ok, readJson, route } from "@/lib/http";
import type { UserRole } from "@/lib/types";
import { obj, str } from "@/lib/validate";

interface RecipientRow {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  role: UserRole;
}

/**
 * Starts the "quên mật khẩu" flow (docs/CONTRACT.md § PASSWORD RESET).
 *
 * ALWAYS answers 200 `{ok:true,data:{}}`, whatever happened underneath: unknown username, no
 * address on file, a provider that is not configured, a provider that rejected the message. That
 * is the whole point — the response must not tell an attacker which usernames exist or which
 * accounts have a recovery address.
 *
 * The per-address cost is equalised the same way the login route does it: the code path that
 * issues nothing still pays one PBKDF2 derivation, so response time does not separate "no such
 * user" from "code sent".
 */
export const POST = route(
  async (req) => {
    const body = await readJson(req, (raw) => {
      const o = obj(raw, "body");
      // The column is COLLATE NOCASE, so the comparison itself is case-insensitive; the value is
      // lowercased anyway to keep one spelling of a username in the code below.
      return { username: str(o.username, "username", { min: 1, max: 32 }).toLowerCase() };
    });

    const db = getDb();
    const user = await db
      .prepare(
        `SELECT id, username, display_name, email, role
         FROM users WHERE username = ? AND banned_at IS NULL`,
      )
      .bind(body.username)
      .first<RecipientRow>();

    // No account, no address, or the admin account (it has no recovery address and is not a
    // person anyone resets): burn the same derivation cost, then report the same success.
    if (!user || !user.email || user.role === "admin") {
      await hashPassword(body.username);
      return ok({});
    }

    try {
      const code = await createResetCode(db, user.id);
      const { sender, provider } = getEmailSenderDetails();

      await sender.send({
        to: user.email,
        subject: RESET_CODE_SUBJECT,
        text: buildResetEmailText({
          displayName: user.display_name,
          username: user.username,
          code,
        }),
      });

      if (!provider) {
        // Nothing was delivered, so this user's reset can never complete. Log the fact once per
        // attempt (the NoOp sender also warns once per isolate); the client still sees success.
        console.warn("[auth] forgot-password: RESEND_API_KEY is not set; code not delivered");
      }
    } catch (error) {
      // Delivery failing is not the caller's business, and it must not turn the always-200 into
      // a 500 that reveals the account exists. The stored code stays valid until its TTL.
      console.error("[auth] forgot-password: could not send the reset email:", error);
    }

    return ok({});
  },
  // PBKDF2 makes each call CPU-expensive and this address sends mail: share the login budget.
  { limit: "auth" },
);
