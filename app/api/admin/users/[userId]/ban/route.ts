import { auditStatement } from "@/lib/admin-audit";
import { forgetUserSessions, requireAdmin } from "@/lib/auth";
import { getDb, nowIso } from "@/lib/db";
import { forbidden, notFound } from "@/lib/errors";
import { ok, readJson, route } from "@/lib/http";
import { obj, str } from "@/lib/validate";

/**
 * Bans an account: login is refused and every session is deleted, so it is signed out at once.
 * Data stays (the person's name still appears in groups); `unban` reverses it fully.
 */
export const POST = route(
  async (req, ctx) => {
    const { userId } = await ctx.params;
    const admin = await requireAdmin();
    const { reason } = await readJson(req, (raw) => {
      const body = obj(raw ?? {}, "body");
      const text = body.reason === undefined || body.reason === null ? "" : body.reason;
      return { reason: str(text, "reason", { max: 200 }) };
    });

    const db = getDb();
    const target = await db
      .prepare("SELECT id, role FROM users WHERE id = ?")
      .bind(userId)
      .first<{ id: string; role: string }>();
    if (!target) {
      throw notFound("Không tìm thấy tài khoản.");
    }
    if (target.role !== "user") {
      throw forbidden("Không thể khóa tài khoản quản trị.");
    }

    await db.batch([
      db
        .prepare("UPDATE users SET banned_at = ?, ban_reason = ? WHERE id = ? AND role = 'user'")
        .bind(nowIso(), reason === "" ? null : reason, target.id),
      db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(target.id),
      auditStatement(db, {
        adminUserId: admin.id,
        targetUserId: target.id,
        action: "user.ban",
        detail: reason === "" ? null : { reason },
      }),
    ]);
    forgetUserSessions(target.id);
    return ok({});
  },
  { allowBanned: true },
);
