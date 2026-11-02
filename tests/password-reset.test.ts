import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "./helpers/d1";

import { SESSION_COOKIE, clearSessionCache } from "@/lib/auth";
import { checkRateLimit, resetRateLimits } from "@/lib/rate-limit";

import { POST as loginPOST } from "@/app/api/auth/login/route";
import { GET as meGET } from "@/app/api/auth/me/route";
import { POST as registerPOST } from "@/app/api/auth/register/route";
import { POST as changePasswordPOST } from "@/app/api/auth/change-password/route";
import { POST as forgotPasswordPOST } from "@/app/api/auth/forgot-password/route";
import { POST as resetPasswordPOST } from "@/app/api/auth/reset-password/route";

/**
 * Route-handler tests for the three password endpoints, run against a real SQLite database built
 * from every migration (the same harness tests/api.test.ts uses). Only two seams are faked: the
 * D1 binding (lib/db) and the Next.js cookie store (next/headers). The email sender is REFUSED
 * here — the reset tests inject their code through the module's deterministic seam instead.
 */

let testDb: TestDb;
let activeJar = new Map<string, string>();

vi.mock("@/lib/db", async () => {
  // Spread the real module inside the factory (hoisted factories cannot close over file vars),
  // keep its `getRateLimiter` (so the existing auth limiter is what the routes exercise), and
  // only replace the per-request D1 handle and the id/clock helpers.
  const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  return {
    ...actual,
    getDb: () => testDb.d1,
    newId: () => crypto.randomUUID(),
    nowIso: () => new Date().toISOString(),
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (activeJar.has(name) ? { name, value: activeJar.get(name) } : undefined),
    set: (name: string, value: string) => {
      activeJar.set(name, value);
    },
    delete: (name: string) => {
      activeJar.delete(name);
    },
  }),
}));

/**
 * The route's Transport is `lib/email`; swap the whole module so nothing can reach a network.
 * `sent` records what the route asked to deliver, which is the only observable of that seam.
 */
const sent: Array<{ to: string; subject: string; text: string }> = [];
let emailConfigured = true;

vi.mock("@/lib/email", async () => {
  return {
    NoOpEmailSender: class {},
    ResendEmailSender: class {},
    getEmailSenderDetails: () => ({
      provider: emailConfigured ? "resend" : null,
      sender: {
        send: async (msg: { to: string; subject: string; text: string }) => {
          sent.push(msg);
        },
      },
    }),
    getEmailSender: () => ({
      send: async (msg: { to: string; subject: string; text: string }) => {
        sent.push(msg);
      },
    }),
  };
});

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));
const MIGRATION = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`${MIGRATIONS_DIR}${name}`, "utf8"))
  .join("\n");

beforeEach(() => {
  testDb = createTestDb(MIGRATION);
  activeJar = new Map();
  sent.length = 0;
  emailConfigured = true;
  resetRateLimits();
  clearSessionCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------- harness

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Json = any;

class Client {
  readonly jar = new Map<string, string>();
}

async function call(
  client: Client,
  handler: Handler,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: Json; headers: Headers }> {
  activeJar = client.jar;
  const hasBody = opts.body !== undefined;
  const req = new Request("http://localhost/api/x", {
    method: opts.method ?? "POST",
    headers: { ...(hasBody ? { "content-type": "application/json" } : {}), ...opts.headers },
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  });
  const response = await handler(req, { params: Promise.resolve({}) });
  activeJar = client.jar;
  return { status: response.status, json: await response.json(), headers: response.headers };
}

let counter = 0;

/** Registers and signs in one client; returns its account. */
async function signUp(password = "secret1"): Promise<{ client: Client; userId: string; username: string }> {
  counter += 1;
  const username = `user${counter}`;
  const client = new Client();
  const res = await call(client, registerPOST, {
    body: { username, displayName: username, password },
    headers: { "cf-connecting-ip": `10.${counter}.0.1` },
  });
  expect(res.status).toBe(201);
  return { client, userId: res.json.data.user.id as string, username };
}

/** Signs an existing account in from a NEW client, so the first client's session is a second one. */
async function signInSecondDevice(username: string, password: string): Promise<Client> {
  const client = new Client();
  const res = await call(client, loginPOST, {
    body: { username, password },
    // The login route's own limiter counts per address; a distinct address isolates devices.
    headers: { "cf-connecting-ip": `10.0.${(counter += 1)}.2` },
  });
  expect(res.status).toBe(200);
  return client;
}

async function setEmail(userId: string, email: string | null): Promise<void> {
  await testDb.d1.prepare("UPDATE users SET email = ? WHERE id = ?").bind(email, userId).run();
}

function sessionCount(userId: string): number {
  const row = testDb.raw
    .prepare("SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?")
    .get(userId) as { c: number };
  return Number(row.c);
}

function passwordRow(userId: string): { password_hash: string; password_salt: string } {
  return testDb.raw
    .prepare("SELECT password_hash, password_salt FROM users WHERE id = ?")
    .get(userId) as { password_hash: string; password_salt: string };
}

/** The 6-digit code the route emailed last (the only place the plaintext exists). */
function lastCode(): string {
  const match = /Mã xác nhận của bạn là: ([0-9]{6})/.exec(sent.at(-1)?.text ?? "");
  expect(match).not.toBeNull();
  return match![1]!;
}

// ---------------------------------------------------------------------------- forgot

describe("POST /api/auth/forgot-password", () => {
  it("emails a 6-digit code to the account's address and answers {}", async () => {
    const { userId, username } = await signUp();
    await setEmail(userId, "an@example.com");

    const res = await call(new Client(), forgotPasswordPOST, { body: { username } });

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, data: {} });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("an@example.com");
    expect(lastCode()).toMatch(/^[0-9]{6}$/);
  });

  it("answers the SAME 200 for an unknown username (no enumeration)", async () => {
    const res = await call(new Client(), forgotPasswordPOST, { body: { username: "khong_ton_tai" } });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, data: {} });
    expect(sent).toHaveLength(0);
  });

  it("answers the same 200 when the account has no email on file", async () => {
    const { username } = await signUp();

    const res = await call(new Client(), forgotPasswordPOST, { body: { username } });

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, data: {} });
    expect(sent).toHaveLength(0);
  });

  it("matches the username case-insensitively", async () => {
    const { userId, username } = await signUp();
    await setEmail(userId, "an@example.com");

    const res = await call(new Client(), forgotPasswordPOST, { body: { username: username.toUpperCase() } });

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it("still answers 200 when no email provider is configured", async () => {
    emailConfigured = false;
    const { userId, username } = await signUp();
    await setEmail(userId, "an@example.com");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await call(new Client(), forgotPasswordPOST, { body: { username } });

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, data: {} });
    // The code is stored either way, so the honest degraded state is "never delivered".
    expect(sent).toHaveLength(1);
    warn.mockRestore();
  });

  it("never emails the admin account, even with an address set", async () => {
    testDb.raw
      .prepare(
        "INSERT INTO users (id, username, display_name, password_hash, password_salt, created_at, role, email) VALUES (?, ?, ?, ?, ?, ?, 'admin', ?)",
      )
      .run("admin1", "admin", "Quản trị viên", "h", "s", new Date().toISOString(), "admin@example.com");

    const res = await call(new Client(), forgotPasswordPOST, { body: { username: "admin" } });

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it("rejects a missing or non-string username with 400 VALIDATION", async () => {
    const missing = await call(new Client(), forgotPasswordPOST, { body: {} });
    expect(missing.status).toBe(400);
    expect(missing.json.error.code).toBe("VALIDATION");

    const wrongType = await call(new Client(), forgotPasswordPOST, { body: { username: 42 } });
    expect(wrongType.status).toBe(400);
    expect(wrongType.json.error.code).toBe("VALIDATION");
  });

  it("requires no session", async () => {
    const { userId, username } = await signUp();
    await setEmail(userId, "an@example.com");

    // A brand-new jar holds no cookie at all.
    const res = await call(new Client(), forgotPasswordPOST, { body: { username } });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------- reset

describe("POST /api/auth/reset-password", () => {
  it("sets a digits-only password, deletes every session and burns the code", async () => {
    const { client, userId, username } = await signUp("secret1");
    await signInSecondDevice(username, "secret1");
    await setEmail(userId, "an@example.com");

    await call(new Client(), forgotPasswordPOST, { body: { username } });
    const code = lastCode();

    expect(sessionCount(userId)).toBe(2);

    const res = await call(new Client(), resetPasswordPOST, {
      body: { username, code, newPassword: "987654" },
    });

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, data: {} });
    expect(sessionCount(userId)).toBe(0);

    // The old password no longer works; the new one does.
    const oldLogin = await call(new Client(), loginPOST, {
      body: { username, password: "secret1" },
      headers: { "cf-connecting-ip": "10.9.9.1" },
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await call(new Client(), loginPOST, {
      body: { username, password: "987654" },
      headers: { "cf-connecting-ip": "10.9.9.2" },
    });
    expect(newLogin.status).toBe(200);

    // The first client's cookie is dead: its session row is gone.
    const meAfter = await call(client, meGET, { method: "GET" });
    expect(meAfter.status).toBe(401);
  });

  it("refuses a wrong code with 400 VALIDATION and leaves the password alone", async () => {
    const { userId, username } = await signUp("secret1");
    await setEmail(userId, "an@example.com");
    const before = passwordRow(userId);

    await call(new Client(), forgotPasswordPOST, { body: { username } });
    const code = lastCode();
    const wrong = code === "000000" ? "000001" : "000000";

    const res = await call(new Client(), resetPasswordPOST, {
      body: { username, code: wrong, newPassword: "987654" },
    });

    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("VALIDATION");
    expect(res.json.error.message).toContain("Mã xác nhận");
    expect(passwordRow(userId)).toEqual(before);
  });

  it("is single use: the same code cannot be presented twice", async () => {
    const { userId, username } = await signUp("secret1");
    await setEmail(userId, "an@example.com");
    await call(new Client(), forgotPasswordPOST, { body: { username } });
    const code = lastCode();

    expect((await call(new Client(), resetPasswordPOST, { body: { username, code, newPassword: "111111" } })).status).toBe(200);
    expect((await call(new Client(), resetPasswordPOST, { body: { username, code, newPassword: "222222" } })).status).toBe(400);
  });

  it("gives the same 400 for a wrong username as for a wrong code", async () => {
    const { userId, username } = await signUp("secret1");
    await setEmail(userId, "an@example.com");
    await call(new Client(), forgotPasswordPOST, { body: { username } });
    const code = lastCode();

    const wrongUser = await call(new Client(), resetPasswordPOST, {
      body: { username: "khong_ton_tai", code, newPassword: "987654" },
    });
    const wrongCode = await call(new Client(), resetPasswordPOST, {
      body: { username, code: code === "000000" ? "000001" : "000000", newPassword: "987654" },
    });

    expect(wrongUser.status).toBe(400);
    expect(wrongCode.status).toBe(400);
    expect(wrongUser.json.error.message).toBe(wrongCode.json.error.message);
  });

  it("rejects a non-digit or too-short new password with 400 VALIDATION", async () => {
    const { userId, username } = await signUp("secret1");
    await setEmail(userId, "an@example.com");
    await call(new Client(), forgotPasswordPOST, { body: { username } });
    const code = lastCode();

    for (const newPassword of ["abcdef", "12345", "12a456", "123 456"]) {
      const res = await call(new Client(), resetPasswordPOST, { body: { username, code, newPassword } });
      expect(res.status, newPassword).toBe(400);
      expect(res.json.error.code).toBe("VALIDATION");
    }
  });

  it("invalidates the code after 5 wrong attempts", async () => {
    const { userId, username } = await signUp("secret1");
    await setEmail(userId, "an@example.com");
    await call(new Client(), forgotPasswordPOST, { body: { username } });
    const code = lastCode();
    const wrong = code === "000000" ? "000001" : "000000";

    for (let i = 0; i < 5; i += 1) {
      await call(new Client(), resetPasswordPOST, { body: { username, code: wrong, newPassword: "987654" } });
    }

    // Even the right code is dead now; a new request is required.
    const res = await call(new Client(), resetPasswordPOST, { body: { username, code, newPassword: "987654" } });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------- change

describe("POST /api/auth/change-password", () => {
  it("changes the password and keeps the caller signed in", async () => {
    const { client, username } = await signUp("secret1");

    const res = await call(client, changePasswordPOST, {
      body: { currentPassword: "secret1", newPassword: "123456" },
    });

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, data: {} });

    const me = await call(client, meGET, { method: "GET" });
    expect(me.status).toBe(200);

    const relogin = await call(new Client(), loginPOST, {
      body: { username, password: "123456" },
      headers: { "cf-connecting-ip": "10.9.8.1" },
    });
    expect(relogin.status).toBe(200);
  });

  it("signs out every OTHER device but not this one", async () => {
    const { client, userId, username } = await signUp("secret1");
    await signInSecondDevice(username, "secret1");
    await signInSecondDevice(username, "secret1");
    expect(sessionCount(userId)).toBe(3);

    const res = await call(client, changePasswordPOST, {
      body: { currentPassword: "secret1", newPassword: "123456" },
    });

    expect(res.status).toBe(200);
    expect(sessionCount(userId)).toBe(1);

    // The surviving row is the caller's cookie's session.
    const cookie = client.jar.get(SESSION_COOKIE)!;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cookie));
    const id = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    const kept = testDb.raw.prepare("SELECT id FROM sessions WHERE user_id = ?").get(userId) as { id: string };
    expect(kept.id).toBe(id);
  });

  it("refuses a wrong current password with 400 and changes nothing", async () => {
    const { client, userId } = await signUp("secret1");
    const before = passwordRow(userId);

    const res = await call(client, changePasswordPOST, {
      body: { currentPassword: "sai_mat_khau", newPassword: "123456" },
    });

    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("VALIDATION");
    expect(res.json.error.message).toContain("hiện tại");
    expect(passwordRow(userId)).toEqual(before);
  });

  it("rejects a non-digit new password", async () => {
    const { client } = await signUp("secret1");

    for (const newPassword of ["abcdef", "12a456", "123 456"]) {
      const res = await call(client, changePasswordPOST, { body: { currentPassword: "secret1", newPassword } });
      expect(res.status, newPassword).toBe(400);
      expect(res.json.error.message).toContain("chữ số");
    }
  });

  it("requires a session: 401 without one", async () => {
    const res = await call(new Client(), changePasswordPOST, {
      body: { currentPassword: "secret1", newPassword: "123456" },
    });
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe("UNAUTHORIZED");
  });

  it("works for the admin account changing its OWN password", async () => {
    const { buildAdminSql } = await import("../scripts/create-admin.mjs");
    testDb.raw.exec(await buildAdminSql({ username: "admin", password: "adminpass1234" }));

    const admin = new Client();
    const login = await call(admin, loginPOST, {
      body: { username: "admin", password: "adminpass1234" },
      headers: { "cf-connecting-ip": "10.9.7.1" },
    });
    expect(login.status).toBe(200);

    const res = await call(admin, changePasswordPOST, {
      body: { currentPassword: "adminpass1234", newPassword: "555555" },
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------- rate limit

describe("rate limiting", () => {
  it("uses the existing auth limiter budget for the reset endpoints", async () => {
    // The login route and these routes share one "auth" bucket per address: exhausting it from
    // one address must refuse the reset endpoint too, with the contract's 429.
    const ip = "10.9.6.1";
    for (let i = 0; i < 10; i += 1) {
      await checkRateLimit("auth", ip);
    }

    const res = await call(new Client(), forgotPasswordPOST, {
      body: { username: "bat_ky" },
      headers: { "cf-connecting-ip": ip },
    });

    expect(res.status).toBe(429);
    expect(res.json.error.code).toBe("RATE_LIMITED");
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});
