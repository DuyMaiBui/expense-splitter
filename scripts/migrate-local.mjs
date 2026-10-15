// Applies migrations/*.sql to the LOCAL simulated D1 database used by `next dev`.
// Local only: it never touches Cloudflare. Compatible with wrangler's `d1_migrations`
// bookkeeping table, so a later CLI-driven migration will not re-run applied files.
//
// Usage: npm run db:migrate:local   (start `npm run dev` once first so the local DB file exists)
import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const STATE_DIR = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const MIGRATIONS_DIR = "migrations";

if (!existsSync(STATE_DIR)) {
  console.error("Chưa có DB local. Chạy `npm run dev` một lần rồi mở http://localhost:3000, sau đó chạy lại lệnh này.");
  process.exit(1);
}

const dbFiles = readdirSync(STATE_DIR).filter((n) => n.endsWith(".sqlite") && n !== "metadata.sqlite");
if (dbFiles.length !== 1) {
  console.error(`Cần đúng 1 file DB trong ${STATE_DIR}, thấy ${dbFiles.length}. Mở trang bất kỳ khi \`npm run dev\` đang chạy để tạo DB.`);
  process.exit(1);
}

const db = new DatabaseSync(join(STATE_DIR, dbFiles[0]));
db.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);

const applied = new Set(db.prepare("SELECT name FROM d1_migrations").all().map((r) => r.name));
const files = readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql")).sort();

let count = 0;
for (const name of files) {
  if (applied.has(name)) continue;
  db.exec("BEGIN");
  try {
    db.exec(readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
    db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(name);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    console.error(`Migration ${name} lỗi:`, error.message);
    process.exit(1);
  }
  console.log(`applied ${name}`);
  count += 1;
}
console.log(count === 0 ? "Không có migration mới." : `Đã áp dụng ${count} migration.`);
