import { forgetUserSessions, hashPassword, requireAdmin } from "@/lib/auth";
import { generateTempPassword, parseResetBody } from "@/lib/admin";
import { auditStatement } from "@/lib/admin-audit";
import { getDb } from "@/lib/db";
import { forbidden, notFound } from "@/lib/errors";
import { ok, readJson, route } from "@/lib/http";
import type { AdminUserRef, UserRole } from "@/lib/types";

interface TargetRow {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  created_at: string;
}

/**
 * Re-issues a user's password. The new password is returned ONCE in this response (the admin
 * relays it); only its hash is stored. All of the user's sessions are deleted so a stolen or
 * forgotten login stops working, and the action is recorded in admin_audit (never the password).
 */
export const POST = route(
  async (req, ctx) => {
    const { userId } = await ctx.params;
    const admin = await requireAdmin();
    const { password } = await readJson(req, parseResetBody);

    const db = getDb();
    const target = await db
      .prepare("SELECT id, username, display_name, role, created_at FROM users WHERE id = ?")
      .bind(userId)
      .first<TargetRow>();
    if (!target) {
      throw notFound("Không tìm thấy tài khoản.");
    }
    if (target.role !== "user") {
      throw forbidden("Không thể đặt lại mật khẩu của tài khoản quản trị.");
    }

    const generated = password === undefined;
    const newPassword = password ?? generateTempPassword();
    const { hash, salt } = await hashPassword(newPassword);

    await db.batch([
      db
        .prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ? AND role = 'user'")
        .bind(hash, salt, target.id),
      db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(target.id),
      auditStatement(db, { adminUserId: admin.id, targetUserId: target.id, action: "password.reset" }),
    ]);
    forgetUserSessions(target.id);

    const user: AdminUserRef = {
      id: target.id,
      username: target.username,
      displayName: target.display_name,
      createdAt: target.created_at,
    };
    return ok({ user, password: newPassword, generated });
  },
  // PBKDF2 makes each call CPU-expensive: share the stricter login budget.
  { limit: "auth", allowBanned: true },
);
