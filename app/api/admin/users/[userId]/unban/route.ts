import { auditStatement } from "@/lib/admin-audit";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { ok, route } from "@/lib/http";

/** Lifts an account ban. The person has to log in again (their sessions were deleted). */
export const POST = route(
  async (_req, ctx) => {
    const { userId } = await ctx.params;
    const admin = await requireAdmin();

    const db = getDb();
    const target = await db
      .prepare("SELECT id FROM users WHERE id = ? AND role = 'user'")
      .bind(userId)
      .first<{ id: string }>();
    if (!target) {
      throw notFound("Không tìm thấy tài khoản.");
    }

    await db.batch([
      db.prepare("UPDATE users SET banned_at = NULL, ban_reason = NULL WHERE id = ?").bind(target.id),
      auditStatement(db, { adminUserId: admin.id, targetUserId: target.id, action: "user.unban" }),
    ]);
    return ok({});
  },
  { allowBanned: true },
);
