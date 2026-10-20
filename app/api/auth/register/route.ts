import { createSession, hashPassword } from "@/lib/auth";
import { getDb, newId, nowIso } from "@/lib/db";
import { badRequest, conflict, rateLimited } from "@/lib/errors";
import { ABUSE } from "@/lib/guard";
import { clientKey } from "@/lib/rate-limit";
import { ok, readJson, route } from "@/lib/http";
import type { User } from "@/lib/types";
import { obj, str } from "@/lib/validate";

const USERNAME_PATTERN = /^[a-z0-9_.]+$/;

/** Names that read as the admin account: nobody may register them (phishing and squatting). */
const RESERVED_USERNAMES = new Set(["admin", "administrator", "quantri", "root", "support"]);

export const POST = route(async (req) => {
  const ip = clientKey(req);
  const body = await readJson(req, (raw) => {
    const o = obj(raw, "body");
    const username = str(o.username, "username", { min: 3, max: 32 }).toLowerCase();
    if (!USERNAME_PATTERN.test(username)) {
      throw badRequest("Tên đăng nhập chỉ gồm chữ thường, số, dấu gạch dưới và dấu chấm.");
    }
    if (RESERVED_USERNAMES.has(username)) {
      throw badRequest("Tên đăng nhập này được dành riêng, hãy chọn tên khác.");
    }
    return {
      username,
      displayName: str(o.displayName, "displayName", { min: 1, max: 50 }),
      // Passwords are never trimmed: leading/trailing spaces are part of the secret.
      password: str(o.password, "password", { min: 6, max: 128, trim: false }),
    };
  });

  const db = getDb();

  const taken = await db
    .prepare("SELECT id FROM users WHERE username = ?")
    .bind(body.username)
    .first<{ id: string }>();
  if (taken) {
    throw conflict("Tên đăng nhập đã được sử dụng.");
  }

  // Sign-up spam cap per address and day. Counted from users.created_ip, so no extra table.
  if (ip !== "unknown") {
    const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const recent = await db
      .prepare("SELECT COUNT(*) AS c FROM users WHERE created_ip = ? AND created_at > ?")
      .bind(ip, since)
      .first<{ c: number }>();
    if ((recent?.c ?? 0) >= ABUSE.registrationsPerDay) {
      throw rateLimited(3600, "Đã tạo quá nhiều tài khoản từ địa chỉ này hôm nay. Hãy thử lại sau.");
    }
  }

  const { hash, salt } = await hashPassword(body.password);
  const id = newId();
  const createdAt = nowIso();

  try {
    await db
      .prepare(
        `INSERT INTO users (id, username, display_name, password_hash, password_salt, created_at, created_ip)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, body.username, body.displayName, hash, salt, createdAt, ip === "unknown" ? null : ip)
      .run();
  } catch {
    // Lost a race with a concurrent registration of the same username (UNIQUE index).
    throw conflict("Tên đăng nhập đã được sử dụng.");
  }

  await createSession(id);

  const user: User = {
    id,
    username: body.username,
    displayName: body.displayName,
    role: "user",
    createdAt,
    // A fresh account has no bank profile; it is set later through PUT /api/profile/bank.
    bank: null,
  };
  return ok({ user }, 201);
}, { limit: "auth" }); // also caps account-spam writes to D1
