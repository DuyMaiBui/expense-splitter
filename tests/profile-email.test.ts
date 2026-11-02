import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "./helpers/d1";

import { buildAdminSql } from "../scripts/create-admin.mjs";

import { GET as meGET } from "@/app/api/auth/me/route";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as registerPOST } from "@/app/api/auth/register/route";
import { PUT as profileEmailPUT } from "@/app/api/profile/email/route";

import { clearSessionCache } from "@/lib/auth";
import { resetGuardState } from "@/lib/guard";
import { resetRateLimits } from "@/lib/rate-limit";

/**
 * `PUT /api/profile/email` (docs/CONTRACT.md § ENDPOINTS): the caller's OWN recovery address.
 *
 * Kept in its own file — with its own database and cookie jar — so the shared route harness in
 * tests/api.test.ts stays untouched. Every request below runs the real handler against a real
 * SQLite database built from migrations/, exactly like the rest of the suite.
 */

let testDb: TestDb;
let activeJar = new Map<string, string>();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb.d1,
  getRateLimiter: () => undefined,
  newId: () => crypto.randomUUID(),
  nowIso: () => new Date().toISOString(),
}));

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

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));
const MIGRATION = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`${MIGRATIONS_DIR}${name}`, "utf8"))
  .join("\n");

beforeEach(() => {
  testDb = createTestDb(MIGRATION);
  activeJar = new Map();
  clearSessionCache();
  // The throttles are module-level state (one in-memory window per isolate): without a reset the
  // second test would spend the first test's register/login budget and see 429s.
  resetRateLimits();
  resetGuardState();
});

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** One browser: its own cookie jar. */
class Client {
  readonly jar = new Map<string, string>();
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Json = any;

async function call(
  client: Client,
  handler: Handler,
  opts: { method?: string; body?: unknown } = {},
): Promise<{ status: number; json: Json }> {
  activeJar = client.jar;
  const hasBody = opts.body !== undefined;
  const req = new Request("http://localhost/api/x", {
    method: opts.method ?? "GET",
    headers: hasBody ? { "content-type": "application/json" } : {},
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  });
  const res = await handler(req, { params: Promise.resolve({}) });
  return { status: res.status, json: await res.json() };
}

const setEmail = (c: Client, body: unknown) =>
  call(c, profileEmailPUT, { method: "PUT", body });

/** A signed-in plain account. */
async function account(username: string): Promise<Client> {
  const c = new Client();
  const reg = await call(c, registerPOST, {
    method: "POST",
    body: { username, displayName: username, password: "secret1" },
  });
  expect(reg.status).toBe(201);
  return c;
}

/** The stored email column of one user row, straight from the database. */
function storedEmail(username: string): string | null {
  const row = testDb.raw.prepare("SELECT email FROM users WHERE username = ?").get(username) as
    | { email: string | null }
    | undefined;
  return row?.email ?? null;
}

describe("profile email", () => {
  it("sets the caller's own address and returns it on the user", async () => {
    const c = await account("alice");

    const r = await setEmail(c, { email: "alice@example.com" });
    expect(r.status).toBe(200);
    expect(r.json.data.user).toMatchObject({ username: "alice", email: "alice@example.com" });
    expect(storedEmail("alice")).toBe("alice@example.com");

    // The route drops this isolate's cached session, so a read straight after agrees.
    expect((await call(c, meGET)).json.data.user.email).toBe("alice@example.com");
  });

  it("normalises the address before storing it", async () => {
    const c = await account("alice");

    const r = await setEmail(c, { email: "  Alice.Example@GMAIL.com  " });
    expect(r.status).toBe(200);
    expect(r.json.data.user.email).toBe("alice.example@gmail.com");
    expect(storedEmail("alice")).toBe("alice.example@gmail.com");
  });

  it("clears the address with null", async () => {
    const c = await account("alice");
    await setEmail(c, { email: "alice@example.com" });

    const cleared = await setEmail(c, { email: null });
    expect(cleared.status).toBe(200);
    expect(cleared.json.data.user.email).toBeNull();
    expect(storedEmail("alice")).toBeNull();
    expect((await call(c, meGET)).json.data.user.email).toBeNull();
  });

  it("requires the email key: an empty body is never a silent clear", async () => {
    const c = await account("alice");
    await setEmail(c, { email: "alice@example.com" });

    for (const body of [{}, { address: "alice@example.com" }, { email: undefined }]) {
      const r = await setEmail(c, body);
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe("VALIDATION");
    }
    // The stored address survived every rejected request.
    expect(storedEmail("alice")).toBe("alice@example.com");
  });

  it.each([
    ["a missing @", "alice.example.com"],
    ["two @", "alice@@example.com"],
    ["a dotless domain", "alice@example"],
    ["a 1-character TLD", "alice@example.c"],
    ["an empty local part", "@example.com"],
    ["an empty string", ""],
    ["internal whitespace", "alice smith@example.com"],
    ["consecutive dots", "alice..smith@example.com"],
    ["an address over 254 chars", `${"a".repeat(250)}@example.com`],
    ["a non-string", 42],
  ])("rejects %s with 400 and stores nothing", async (_label, email) => {
    const c = await account("alice");

    const r = await setEmail(c, { email });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("VALIDATION");
    expect(storedEmail("alice")).toBeNull();
  });

  it("requires a session", async () => {
    const r = await setEmail(new Client(), { email: "alice@example.com" });
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("UNAUTHORIZED");
  });

  it("refuses the admin account", async () => {
    const password = "Adm1n-passw0rd-long";
    testDb.raw.exec(await buildAdminSql({ username: "admin", password }));
    const admin = new Client();
    await call(admin, loginPOST, { method: "POST", body: { username: "admin", password } });

    const r = await setEmail(admin, { email: "admin@example.com" });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("FORBIDDEN");
    expect(storedEmail("admin")).toBeNull();
  });

  it("writes only the caller's row, and the address stays private to its owner", async () => {
    const alice = await account("alice");
    const bob = await account("bob");

    await setEmail(bob, { email: "bob@example.com" });
    await setEmail(alice, { email: "alice@example.com" });

    expect(storedEmail("alice")).toBe("alice@example.com");
    expect(storedEmail("bob")).toBe("bob@example.com");

    // There is no id parameter and no route that returns another account's email: /api/auth/me
    // is the only read of `User`, and it always answers for the caller.
    expect((await call(alice, meGET)).json.data.user.email).toBe("alice@example.com");
    expect((await call(bob, meGET)).json.data.user.email).toBe("bob@example.com");
  });

  it("allows two accounts to share one address (no uniqueness constraint)", async () => {
    const alice = await account("alice");
    const bob = await account("bob");

    expect((await setEmail(alice, { email: "family@example.com" })).status).toBe(200);
    expect((await setEmail(bob, { email: "family@example.com" })).status).toBe(200);
    expect(storedEmail("alice")).toBe("family@example.com");
    expect(storedEmail("bob")).toBe("family@example.com");
  });
});
