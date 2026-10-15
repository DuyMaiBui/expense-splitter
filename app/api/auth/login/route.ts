import { createSession, hashPassword, verifyPassword } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { unauthorized } from "@/lib/errors";
import { ok, readJson, route } from "@/lib/http";
import type { User } from "@/lib/types";
import { obj, str } from "@/lib/validate";

interface LoginRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  created_at: string;
}

export const POST = route(async (req) => {
  const body = await readJson(req, (raw) => {
    const o = obj(raw, "body");
    return {
      username: str(o.username, "username", { min: 1, max: 32 }).toLowerCase(),
      password: str(o.password, "password", { min: 1, max: 128, trim: false }),
    };
  });

  const row = await getDb()
    .prepare(
      `SELECT id, username, display_name, password_hash, password_salt, created_at
       FROM users WHERE username = ?`,
    )
    .bind(body.username)
    .first<LoginRow>();

  if (!row) {
    // Burn the same PBKDF2 cost as a real check so response time does not reveal
    // whether the username exists.
    await hashPassword(body.password);
    throw unauthorized("Tên đăng nhập hoặc mật khẩu không đúng.");
  }

  const valid = await verifyPassword(body.password, row.password_hash, row.password_salt);
  if (!valid) {
    throw unauthorized("Tên đăng nhập hoặc mật khẩu không đúng.");
  }

  await createSession(row.id);

  const user: User = {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
  return ok({ user });
}, { limit: "auth" }); // brute-force guard: PBKDF2 makes every attempt CPU-expensive
