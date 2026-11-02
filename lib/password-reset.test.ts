import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ApiError } from "./errors";
import {
  CODE_LENGTH,
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  buildResetEmailText,
  clearResetCodes,
  createResetCode,
  generateNumericCode,
  parseNewPassword,
  parseResetCode,
  verifyResetCode,
} from "./password-reset";

/**
 * Unit tests for the numeric one-time code: the code itself is a pure function, and the storage
 * helpers are exercised against a REAL SQLite database with the real migration applied, so the
 * constraints and the atomic claim behave as they will on D1.
 */

/** A minimal deterministic byte source; `null` means "run out" (only used to assert the guard). */
function bytesOf(values: number[]): (length: number) => Uint8Array {
  let offset = 0;
  return (length) => {
    const window = values.slice(offset, offset + length);
    offset += window.length;
    return Uint8Array.from(window);
  };
}

describe("generateNumericCode", () => {
  it(`returns exactly ${CODE_LENGTH} digits`, () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateNumericCode()).toMatch(/^[0-9]{6}$/);
    }
  });

  it("keeps leading zeros (the code is a string, not a number)", () => {
    // One round draws 12 bytes; the first six accepted ones are 0,1,2,0,5,9 -> "012059".
    const code = generateNumericCode(bytesOf([0, 1, 2, 0, 5, 9, 1, 1, 1, 1, 1, 1]));
    expect(code).toBe("012059");
  });

  it("rejects every byte at or above 250 (no modulo bias)", () => {
    // 250..255 would bend `byte % 10` toward 0..5; they are skipped, and the accepted bytes
    // 7,8,9,1,2,3 form the code.
    const code = generateNumericCode(bytesOf([250, 251, 252, 253, 254, 255, 7, 8, 9, 1, 2, 3]));
    expect(code).toBe("789123");
  });

  it("draws each digit with (close to) equal probability over many codes", () => {
    // A biased generator shows up as a spike in the leading digit: deterministic sampling can
    // be checked exactly, this checks the real WebCrypto path end to end.
    const counts = new Array<number>(10).fill(0);
    const samples = 3_000;
    for (let i = 0; i < samples; i += 1) {
      const first = generateNumericCode()[0]!;
      counts[Number(first)] += 1;
    }

    const expected = samples / 10;
    // 3σ for a binomial with n=3000, p=0.1 is ~49; 120 is far outside noise for a fair
    // generator, while a 250..255 bias would push 0..5 ~7% over.
    for (const [digit, count] of counts.entries()) {
      expect(Math.abs(count - expected), `digit ${digit} count ${count}`).toBeLessThan(120);
    }
  });

  it("throws rather than loop forever on a source that yields no usable byte", () => {
    expect(() => generateNumericCode(() => Uint8Array.from([255, 255]))).toThrow();
  });
});

describe("parseResetCode", () => {
  it("accepts exactly six digits", () => {
    expect(parseResetCode("012345")).toBe("012345");
  });

  it("trims surrounding whitespace", () => {
    expect(parseResetCode(" 123456 ")).toBe("123456");
  });

  it.each(["12345", "1234567", "12345a", "", "abcdef", 123456, null, undefined])(
    "rejects %p as a VALIDATION error naming the field",
    (value) => {
      expect(() => parseResetCode(value)).toThrowError(ApiError);
      try {
        parseResetCode(value, "code");
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.code).toBe("VALIDATION");
        expect(apiError.status).toBe(400);
        expect(apiError.message).toContain("code");
        expect(apiError.message).toContain("chữ số");
      }
    },
  );
});

describe("parseNewPassword", () => {
  it("accepts letters, digits and symbols", () => {
    for (const value of ["abc123", "P@ssw0rd!", "mật khẩu", "123456", "!!!@@@###"]) {
      expect(parseNewPassword(value), value).toBe(value);
    }
  });

  it("accepts exactly 6 and exactly 128 characters", () => {
    const shortest = "a".repeat(6);
    const longest = "a".repeat(128);
    expect(parseNewPassword(shortest)).toBe(shortest);
    expect(parseNewPassword(longest)).toBe(longest);
  });

  it("keeps the 6-character minimum and the 128-character maximum", () => {
    expect(() => parseNewPassword("a".repeat(5))).toThrowError(/ít nhất 6 ký tự/);
    expect(() => parseNewPassword("a".repeat(129))).toThrowError(/vượt quá 128 ký tự/);
  });

  it("rejects a non-string with a VALIDATION error naming the field", () => {
    for (const value of [42, null, undefined, {}, ["123456"]]) {
      expect(() => parseNewPassword(value), String(value)).toThrowError(ApiError);
    }
    try {
      parseNewPassword(42, "newPassword");
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.code).toBe("VALIDATION");
      expect(apiError.status).toBe(400);
      expect(apiError.message).toContain("newPassword");
      expect(apiError.message).toContain("chuỗi");
    }
  });

  it("does not trim: padded and whitespace-only values are valid and returned unchanged", () => {
    expect(parseNewPassword(" 123456 ")).toBe(" 123456 ");
    expect(parseNewPassword("      ")).toBe("      ");
  });

  it("enforces no character class: no message names digits", () => {
    for (const value of ["", "a".repeat(5), "a".repeat(129)]) {
      try {
        parseNewPassword(value);
      } catch (error) {
        expect((error as ApiError).message).not.toContain("chữ số");
      }
    }
  });
});

describe("buildResetEmailText", () => {
  it("names the account, carries the code and states the 10-minute expiry", () => {
    const text = buildResetEmailText({ displayName: "Hưng", username: "hung", code: "123456" });
    expect(text).toContain("Hưng");
    expect(text).toContain("hung");
    expect(text).toContain("123456");
    expect(text).toContain("10 phút");
    expect(text).toContain("một lần");
  });

  it("derives its expiry wording from the TTL constant", () => {
    expect(CODE_TTL_MS).toBe(10 * 60 * 1000);
    const text = buildResetEmailText({ displayName: "A", username: "a", code: "000000" });
    expect(text).toContain(`${CODE_TTL_MS / 60_000} phút`);
  });
});

// ---------------------------------------------------------------------------
// storage: real SQLite, real migration
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));
const MIGRATION = ["0001_init.sql", "0009_password_reset.sql"]
  .map((name) => readFileSync(`${MIGRATIONS_DIR}${name}`, "utf8"))
  .join("\n");

interface CodeRow {
  id: string;
  user_id: string;
  attempts: number;
  expires_at: string;
  used_at: string | null;
}

/**
 * A D1 stand-in over node:sqlite carrying exactly the surface the reset helpers use
 * (`prepare().bind().first()/run()` and a transactional `batch`), plus a raw handle for
 * assertions the API does not expose. The migration is the real one.
 */
function makeDb(): { db: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec(MIGRATION);

  const now = new Date().toISOString();
  const insertUser = raw.prepare(
    "INSERT INTO users (id, username, display_name, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  insertUser.run("u1", "hung", "Hưng", "hash", "salt", now);
  insertUser.run("u2", "lan", "Lan", "hash", "salt", now);

  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => {
      const row = raw.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined;
      return row ? { ...row } : null;
    },
    run: async () => {
      const info = raw.prepare(sql).run(...(args as never[]));
      return {
        success: true as const,
        meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
      };
    },
  });

  const db = {
    prepare: (sql: string) => statement(sql),
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      raw.exec("BEGIN");
      try {
        for (const item of statements) {
          await item.run();
        }
        raw.exec("COMMIT");
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
      return [];
    },
  } as unknown as D1Database;

  return { db, raw };
}

function codeRows(raw: DatabaseSync): CodeRow[] {
  return raw
    .prepare("SELECT id, user_id, attempts, expires_at, used_at FROM password_reset_codes ORDER BY created_at")
    .all() as unknown as CodeRow[];
}

/** A code from a fixed digit sequence, so a test knows the plaintext without cracking the hash. */
function createKnownCode(db: D1Database, userId: string, now = Date.now()): Promise<string> {
  return createResetCode(db, userId, now, bytesOf(Array.from({ length: 64 }, (_, i) => i % 10)));
}

describe("reset code storage", () => {
  it("stores only a hash: the plaintext code appears nowhere in the row", async () => {
    const { db, raw } = makeDb();
    const code = await createResetCode(db, "u1");

    expect(JSON.stringify(codeRows(raw))).not.toContain(code);
    const stored = raw.prepare("SELECT * FROM password_reset_codes").get() as Record<string, unknown>;
    expect(JSON.stringify(stored)).not.toContain(code);
  });

  it("verifies the correct code and refuses a wrong one", async () => {
    const { db } = makeDb();
    const code = await createKnownCode(db, "u1");

    expect(await verifyResetCode(db, "u1", "000000" === code ? "000001" : "000000")).toBe("invalid");
    expect(await verifyResetCode(db, "u1", code)).toBe("ok");
  });

  it("is single use: a claimed code cannot be verified again", async () => {
    const { db } = makeDb();
    const code = await createKnownCode(db, "u1");

    expect(await verifyResetCode(db, "u1", code)).toBe("ok");
    expect(await verifyResetCode(db, "u1", code)).toBe("invalid");
  });

  it("invalidates the previous code when a new one is requested", async () => {
    const { db, raw } = makeDb();
    const first = await createKnownCode(db, "u1");
    const second = await createKnownCode(db, "u1", Date.now() + 1);

    expect(codeRows(raw)).toHaveLength(1);
    // The deterministic source yields the same digits both times, so this only proves the OLD
    // row is gone; the second code is the only live one.
    expect(await verifyResetCode(db, "u1", first)).toBe("ok");
    expect(await verifyResetCode(db, "u1", second)).toBe("invalid");
  });

  it("accepts a code just inside the 10-minute window", async () => {
    const { db } = makeDb();
    const issuedAt = Date.parse("2026-01-01T00:00:00.000Z");
    const code = await createKnownCode(db, "u1", issuedAt);

    const justInside = new Date(issuedAt + CODE_TTL_MS - 1).toISOString();
    expect(await verifyResetCode(db, "u1", code, justInside)).toBe("ok");
  });

  it("refuses a code once the 10-minute window has closed", async () => {
    const { db } = makeDb();
    const issuedAt = Date.parse("2026-01-01T00:00:00.000Z");
    const code = await createKnownCode(db, "u1", issuedAt);

    const justOutside = new Date(issuedAt + CODE_TTL_MS).toISOString();
    expect(await verifyResetCode(db, "u1", code, justOutside)).toBe("invalid");
  });

  it(`invalidates the code after ${MAX_ATTEMPTS} wrong attempts`, async () => {
    const { db, raw } = makeDb();
    const code = await createKnownCode(db, "u1");
    const wrong = code === "000000" ? "000001" : "000000";

    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      expect(await verifyResetCode(db, "u1", wrong), `attempt ${attempt}`).toBe("invalid");
      expect(codeRows(raw)[0]!.attempts).toBe(attempt);
      expect(codeRows(raw)[0]!.used_at).toBeNull();
    }

    // The fifth wrong guess kills the code...
    expect(await verifyResetCode(db, "u1", wrong)).toBe("invalid");
    expect(codeRows(raw)[0]!.attempts).toBe(MAX_ATTEMPTS);
    expect(codeRows(raw)[0]!.used_at).not.toBeNull();

    // ...so the RIGHT code is refused afterwards and a new one must be requested.
    expect(await verifyResetCode(db, "u1", code)).toBe("invalid");
  });

  it("does not count a SUCCESSFUL verification as an attempt", async () => {
    const { db, raw } = makeDb();
    const code = await createKnownCode(db, "u1");

    expect(await verifyResetCode(db, "u1", code)).toBe("ok");
    expect(codeRows(raw)[0]!.attempts).toBe(0);
  });

  it("scopes codes per user: one user's code cannot reset another", async () => {
    const { db } = makeDb();
    const code = await createKnownCode(db, "u1");

    expect(await verifyResetCode(db, "u2", code)).toBe("invalid");
  });

  it("clearResetCodes removes every row of one user only", async () => {
    const { db, raw } = makeDb();
    await createResetCode(db, "u1");
    await createResetCode(db, "u2");

    await clearResetCodes(db, "u1");

    expect(codeRows(raw).map((row) => row.user_id)).toEqual(["u2"]);
  });
});
