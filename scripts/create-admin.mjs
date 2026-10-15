// Builds the SQL that creates (or rotates the password of) the dedicated admin account.
// It only WRITES A FILE of SQL; applying it to D1 is a separate, deliberate step.
//
//   ADMIN_PASSWORD='...' node scripts/create-admin.mjs --out admin.sql [--username admin]
//   node scripts/create-admin.mjs --out admin.sql --password-out admin-password.txt
//
// Without ADMIN_PASSWORD a random password is generated and written ONLY to --password-out
// (mode 0600); it is never printed. The hash parameters must match lib/auth.ts.
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_BYTES = 32;
const SALT_BYTES = 16;
const PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

const toBase64 = (bytes) => Buffer.from(bytes).toString("base64");

export function generatePassword(length = 16) {
  const limit = 256 - (256 % PASSWORD_ALPHABET.length);
  let result = "";
  while (result.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < limit && result.length < length) {
        result += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
      }
    }
  }
  return result;
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    PBKDF2_KEY_BYTES * 8,
  );
  return { hash: toBase64(new Uint8Array(bits)), salt: toBase64(salt) };
}

/** The SQL for one admin account. Re-running with the same username rotates its password. */
export async function buildAdminSql({ username, password, displayName = "Quản trị viên", now = new Date() }) {
  if (!/^[a-z0-9_.]{3,32}$/.test(username)) {
    throw new Error("username phải gồm 3-32 ký tự a-z, 0-9, _ hoặc .");
  }
  if (password.length < 12) {
    throw new Error("Mật khẩu admin phải có ít nhất 12 ký tự.");
  }
  const { hash, salt } = await hashPassword(password);
  const name = displayName.replaceAll("'", "''");

  // The DO UPDATE only fires for an existing ADMIN row, so this can never take over (or
  // overwrite) a normal user that happens to hold the same username: that case changes nothing.
  return [
    `INSERT INTO users (id, username, display_name, password_hash, password_salt, created_at, role) ` +
      `VALUES ('${randomUUID()}', '${username}', '${name}', '${hash}', '${salt}', '${now.toISOString()}', 'admin') ` +
      `ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, ` +
      `password_salt = excluded.password_salt WHERE users.role = 'admin';`,
    `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = '${username}' AND role = 'admin');`,
    "",
  ].join("\n");
}

async function main() {
  const { values } = parseArgs({
    options: {
      username: { type: "string", default: "admin" },
      out: { type: "string" },
      "password-out": { type: "string" },
    },
  });

  if (!values.out) {
    console.error("Thiếu --out <file.sql>");
    process.exit(2);
  }

  let password = process.env.ADMIN_PASSWORD;
  const generated = !password;
  if (generated) {
    if (!values["password-out"]) {
      console.error("Không có ADMIN_PASSWORD: cần --password-out <file> để lưu mật khẩu được tạo ngẫu nhiên.");
      process.exit(2);
    }
    password = generatePassword();
    writeFileSync(values["password-out"], `${password}\n`, { mode: 0o600 });
  }

  writeFileSync(values.out, await buildAdminSql({ username: values.username, password }));
  console.log(`Đã ghi SQL tạo/đặt lại tài khoản "${values.username}" vào ${values.out}.`);
  console.log(generated ? `Mật khẩu ngẫu nhiên nằm trong ${values["password-out"]} (không in ra màn hình).` : "Mật khẩu lấy từ ADMIN_PASSWORD.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
