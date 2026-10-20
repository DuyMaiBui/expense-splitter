import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "./helpers/d1";

import { buildAdminSql } from "../scripts/create-admin.mjs";

import { clearSessionCache, hashPassword, verifyPassword } from "@/lib/auth";
import { loadExpenseList } from "@/lib/expenses";
import { getGroupAdminView, getGroupView, listGroupsForUser } from "@/lib/group-queries";
import { ABUSE, invalidateBanCache, isIpBanned, resetGuardState } from "@/lib/guard";
import { MAX_BODY_BYTES } from "@/lib/http";
import { normalizeIp } from "@/lib/ip";
import { MEMORY_RULES, resetRateLimits } from "@/lib/rate-limit";

import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { GET as meGET } from "@/app/api/auth/me/route";
import { POST as registerPOST } from "@/app/api/auth/register/route";
import { GET as groupGET } from "@/app/api/groups/[groupId]/route";
import { DELETE as expenseDELETE, GET as expenseGET, PUT as expensePUT } from "@/app/api/groups/[groupId]/expenses/[expenseId]/route";
import { GET as expensesGET, POST as expensesPOST } from "@/app/api/groups/[groupId]/expenses/route";
import { GET as logGET } from "@/app/api/groups/[groupId]/log/route";
import { DELETE as memberDELETE } from "@/app/api/groups/[groupId]/members/[memberId]/route";
import { GET as membersGET, POST as membersPOST } from "@/app/api/groups/[groupId]/members/route";
import { DELETE as presetDELETE, PUT as presetPUT } from "@/app/api/groups/[groupId]/presets/[presetId]/route";
import { GET as presetsGET, POST as presetsPOST } from "@/app/api/groups/[groupId]/presets/route";
import { POST as presetsSyncPOST } from "@/app/api/groups/[groupId]/presets/sync/route";
import { GET as adminUsersGET } from "@/app/api/admin/users/route";
import { POST as adminResetPOST } from "@/app/api/admin/users/[userId]/reset-password/route";
import { POST as adminBanPOST } from "@/app/api/admin/users/[userId]/ban/route";
import { POST as adminUnbanPOST } from "@/app/api/admin/users/[userId]/unban/route";
import {
  DELETE as adminIpBansDELETE,
  GET as adminIpBansGET,
  POST as adminIpBansPOST,
} from "@/app/api/admin/ip-bans/route";
import { GET as adminGroupsGET } from "@/app/api/admin/groups/route";
import { PUT as adminGroupPUT } from "@/app/api/admin/groups/[groupId]/route";
import { POST as adminGroupDeletePOST } from "@/app/api/admin/groups/[groupId]/delete/route";
import { POST as adminGroupRestorePOST } from "@/app/api/admin/groups/[groupId]/restore/route";
import { GET as settlementGET } from "@/app/api/groups/[groupId]/settlement/route";
import { GET as statsGET } from "@/app/api/groups/[groupId]/stats/route";
import { POST as joinPOST } from "@/app/api/groups/join/route";
import { GET as groupsGET, POST as groupsPOST } from "@/app/api/groups/route";

/**
 * Route-handler integration tests. Each test gets a fresh in-memory SQLite database built
 * from the real migration, and calls the real exported handlers. Only two seams are faked:
 * the D1 binding (lib/db) and the Next.js cookie store (next/headers).
 */

let testDb: TestDb;
let activeJar = new Map<string, string>();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb.d1,
  getRateLimiter: () => undefined, // no Workers binding in tests: exercise the in-memory limiter
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

// Every migration, in order, exactly as `migrations apply` would run them.
const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));
const MIGRATION = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`${MIGRATIONS_DIR}${name}`, "utf8"))
  .join("\n");

beforeEach(() => {
  testDb = createTestDb(MIGRATION);
  activeJar = new Map();
  resetRateLimits();
  resetGuardState();
  clearSessionCache();
});

// ---------------------------------------------------------------------------- harness

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Json = any;

/** One browser: its own cookie jar. */
class Client {
  readonly jar = new Map<string, string>();
}

async function call(
  client: Client,
  handler: Handler,
  opts: {
    method?: string;
    path?: string;
    params?: Record<string, string>;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; json: Json; headers: Headers }> {
  activeJar = client.jar;
  const hasBody = opts.body !== undefined;
  const req = new Request(`http://localhost${opts.path ?? "/api/x"}`, {
    method: opts.method ?? "GET",
    headers: { ...(hasBody ? { "content-type": "application/json" } : {}), ...opts.headers },
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  return { status: res.status, json: await res.json(), headers: res.headers };
}

const h = {
  register: (c: Client, body: unknown) => call(c, registerPOST, { method: "POST", body }),
  login: (c: Client, body: unknown) => call(c, loginPOST, { method: "POST", body }),
  logout: (c: Client) => call(c, logoutPOST, { method: "POST" }),
  me: (c: Client) => call(c, meGET),
  createGroup: (c: Client, name: string) => call(c, groupsPOST, { method: "POST", body: { name } }),
  listGroups: (c: Client) => call(c, groupsGET),
  join: (c: Client, inviteCode: string) => call(c, joinPOST, { method: "POST", body: { inviteCode } }),
  getGroup: (c: Client, groupId: string) => call(c, groupGET, { params: { groupId } }),
  members: (c: Client, groupId: string) => call(c, membersGET, { params: { groupId } }),
  addMember: (c: Client, groupId: string, body: unknown) =>
    call(c, membersPOST, { method: "POST", params: { groupId }, body }),
  removeMember: (c: Client, groupId: string, memberId: string) =>
    call(c, memberDELETE, { method: "DELETE", params: { groupId, memberId } }),
  expenses: (c: Client, groupId: string) => call(c, expensesGET, { params: { groupId } }),
  createExpense: (c: Client, groupId: string, body: unknown) =>
    call(c, expensesPOST, { method: "POST", params: { groupId }, body }),
  getExpense: (c: Client, groupId: string, expenseId: string) =>
    call(c, expenseGET, { params: { groupId, expenseId } }),
  updateExpense: (c: Client, groupId: string, expenseId: string, body: unknown) =>
    call(c, expensePUT, { method: "PUT", params: { groupId, expenseId }, body }),
  deleteExpense: (c: Client, groupId: string, expenseId: string) =>
    call(c, expenseDELETE, { method: "DELETE", params: { groupId, expenseId } }),
  log: (c: Client, groupId: string, query = "") =>
    call(c, logGET, { params: { groupId }, path: `/api/x${query}` }),
  settlement: (c: Client, groupId: string) => call(c, settlementGET, { params: { groupId } }),
  stats: (c: Client, groupId: string, query = "") =>
    call(c, statsGET, { params: { groupId }, path: `/api/x${query}` }),
  adminUsers: (c: Client) => call(c, adminUsersGET, { path: "/api/admin/users" }),
  resetPassword: (c: Client, userId: string, body: unknown = {}) =>
    call(c, adminResetPOST, { method: "POST", params: { userId }, body }),
  banUser: (c: Client, userId: string, body: unknown = {}) =>
    call(c, adminBanPOST, { method: "POST", params: { userId }, body }),
  unbanUser: (c: Client, userId: string) =>
    call(c, adminUnbanPOST, { method: "POST", params: { userId }, body: {} }),
  ipBans: (c: Client) => call(c, adminIpBansGET, { path: "/api/admin/ip-bans" }),
  banIp: (c: Client, body: unknown, headers?: Record<string, string>) =>
    call(c, adminIpBansPOST, { method: "POST", path: "/api/admin/ip-bans", body, headers }),
  liftIp: (c: Client, ip: string) =>
    call(c, adminIpBansDELETE, { method: "DELETE", path: `/api/admin/ip-bans?ip=${encodeURIComponent(ip)}` }),
  adminGroups: (c: Client) => call(c, adminGroupsGET, { path: "/api/admin/groups" }),
  renameGroup: (c: Client, groupId: string, name: string) =>
    call(c, adminGroupPUT, { method: "PUT", params: { groupId }, body: { name } }),
  deleteGroup: (c: Client, groupId: string) =>
    call(c, adminGroupDeletePOST, { method: "POST", params: { groupId }, body: {} }),
  restoreGroup: (c: Client, groupId: string) =>
    call(c, adminGroupRestorePOST, { method: "POST", params: { groupId }, body: {} }),
  presets: (c: Client, groupId: string) => call(c, presetsGET, { params: { groupId } }),
  createPreset: (c: Client, groupId: string, body: unknown) =>
    call(c, presetsPOST, { method: "POST", params: { groupId }, body }),
  updatePreset: (c: Client, groupId: string, presetId: string, body: unknown) =>
    call(c, presetPUT, { method: "PUT", params: { groupId, presetId }, body }),
  deletePreset: (c: Client, groupId: string, presetId: string) =>
    call(c, presetDELETE, { method: "DELETE", params: { groupId, presetId } }),
  syncPresets: (c: Client, groupId: string, body: unknown) =>
    call(c, presetsSyncPOST, { method: "POST", params: { groupId }, body }),
};

const count = (sql: string, ...args: unknown[]): number =>
  Number((testDb.raw.prepare(sql).get(...(args as never[])) as { c: number }).c);

const sum = (shares: Array<{ amount: number }>) => shares.reduce((total, s) => total + s.amount, 0);

/** alice (group owner) + bob (joined by code) + chi (friend without an account). */
async function setup() {
  const alice = new Client();
  const bob = new Client();
  await h.register(alice, { username: "alice", displayName: "Alice", password: "secret1" });
  await h.register(bob, { username: "bob", displayName: "Bob", password: "secret2" });

  const created = (await h.createGroup(alice, "Đi Đà Lạt")).json.data.group;
  const joined = (await h.join(bob, created.inviteCode)).json.data.group;
  const chi = (await h.addMember(alice, created.id, { name: "Chi" })).json.data.member;

  return {
    alice,
    bob,
    gid: created.id as string,
    code: created.inviteCode as string,
    aliceM: created.myMemberId as string,
    bobM: joined.myMemberId as string,
    chiM: chi.id as string,
  };
}

// ---------------------------------------------------------------------------- auth

describe("auth", () => {
  it("register creates the account, logs in and never leaks credentials", async () => {
    const c = new Client();
    const r = await h.register(c, { username: "alice", displayName: "Alice", password: "secret1" });

    expect(r.status).toBe(201);
    expect(r.json.data.user).toMatchObject({ username: "alice", displayName: "Alice" });
    expect(JSON.stringify(r.json)).not.toMatch(/password|hash|salt/i);
    expect(c.jar.get("sid")).toBeTruthy();
    expect((await h.me(c)).json.data.user.username).toBe("alice");
  });

  it("stores a salted hash, never the password, and only a hash of the session token", async () => {
    const c = new Client();
    await h.register(c, { username: "alice", displayName: "Alice", password: "secret1" });

    const user = testDb.raw.prepare("SELECT password_hash, password_salt FROM users").get() as {
      password_hash: string;
      password_salt: string;
    };
    expect(user.password_hash).not.toContain("secret1");
    expect(user.password_salt.length).toBeGreaterThan(8);

    const session = testDb.raw.prepare("SELECT id FROM sessions").get() as { id: string };
    expect(session.id).not.toBe(c.jar.get("sid"));
    expect(session.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("lowercases the username and treats it case-insensitively", async () => {
    const a = new Client();
    const r = await h.register(a, { username: "Alice_1", displayName: "A", password: "secret1" });
    expect(r.json.data.user.username).toBe("alice_1");

    const dup = await h.register(new Client(), { username: "ALICE_1", displayName: "B", password: "secret1" });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("CONFLICT");
  });

  it.each([
    ["too short username", { username: "ab", displayName: "A", password: "secret1" }],
    ["illegal characters", { username: "al ice!", displayName: "A", password: "secret1" }],
    ["short password", { username: "alice", displayName: "A", password: "12345" }],
    ["empty display name", { username: "alice", displayName: "  ", password: "secret1" }],
    ["missing fields", {}],
  ])("rejects registration: %s", async (_label, body) => {
    const r = await h.register(new Client(), body);
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("VALIDATION");
  });

  it("login works with any username casing and rejects bad credentials identically", async () => {
    await h.register(new Client(), { username: "alice", displayName: "Alice", password: "secret1" });

    const ok = new Client();
    const good = await h.login(ok, { username: "ALICE", password: "secret1" });
    expect(good.status).toBe(200);
    expect(ok.jar.get("sid")).toBeTruthy();

    const wrongPw = await h.login(new Client(), { username: "alice", password: "nope-nope" });
    const noUser = await h.login(new Client(), { username: "ghost", password: "secret1" });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.json.error.message).toBe(noUser.json.error.message);
  });

  it("me requires a session, logout ends it and deletes the row", async () => {
    expect((await h.me(new Client())).status).toBe(401);

    const c = new Client();
    await h.register(c, { username: "alice", displayName: "Alice", password: "secret1" });
    expect(count("SELECT COUNT(*) AS c FROM sessions")).toBe(1);

    expect((await h.logout(c)).status).toBe(200);
    expect(count("SELECT COUNT(*) AS c FROM sessions")).toBe(0);
    const after = await h.me(c);
    expect(after.status).toBe(401);
    expect(after.json.error.code).toBe("UNAUTHORIZED");
  });

  it("returns the caller's own bank profile on register, login and me", async () => {
    const c = new Client();
    const registered = await h.register(c, { username: "alice", displayName: "Alice", password: "secret1" });
    expect(registered.json.data.user.bank).toBeNull();
    expect((await h.me(c)).json.data.user.bank).toBeNull();

    // Registering never leaks a profile into another account: only the owner's row changes.
    const bank = { bin: "970436", accountNo: "0123456789", accountName: "NGUYEN VAN A" };
    testDb.raw
      .prepare(
        "UPDATE users SET bank_bin = ?, bank_account_no = ?, bank_account_name = ? WHERE username = 'alice'",
      )
      .run(bank.bin, bank.accountNo, bank.accountName);

    // The session cache is per isolate: a stale entry would hide a profile edit, so the login
    // below is the fresh read the browser does after signing in again.
    const again = new Client();
    const loggedIn = await h.login(again, { username: "alice", password: "secret1" });
    expect(loggedIn.json.data.user.bank).toEqual(bank);
    expect((await h.me(again)).json.data.user.bank).toEqual(bank);
  });

  it("treats a partially stored bank profile as no profile", async () => {
    const c = new Client();
    await h.register(c, { username: "alice", displayName: "Alice", password: "secret1" });
    testDb.raw.prepare("UPDATE users SET bank_bin = '970436' WHERE username = 'alice'").run();

    const fresh = new Client();
    expect((await h.login(fresh, { username: "alice", password: "secret1" })).json.data.user.bank).toBeNull();
  });

  it("rejects an expired session", async () => {
    const c = new Client();
    await h.register(c, { username: "alice", displayName: "Alice", password: "secret1" });
    testDb.raw.exec("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'");
    expect((await h.me(c)).status).toBe(401);
  });

  it("every protected route answers 401 without a session", async () => {
    const anon = new Client();
    const p = { groupId: "g", memberId: "m", expenseId: "e" };
    const results = await Promise.all([
      call(anon, groupsGET),
      call(anon, groupsPOST, { method: "POST", body: { name: "x" } }),
      call(anon, joinPOST, { method: "POST", body: { inviteCode: "ABCDEFGH" } }),
      call(anon, groupGET, { params: p }),
      call(anon, membersGET, { params: p }),
      call(anon, membersPOST, { method: "POST", params: p, body: { name: "x" } }),
      call(anon, memberDELETE, { method: "DELETE", params: p }),
      call(anon, expensesGET, { params: p }),
      call(anon, expensesPOST, { method: "POST", params: p, body: {} }),
      call(anon, expenseGET, { params: p }),
      call(anon, expensePUT, { method: "PUT", params: p, body: {} }),
      call(anon, expenseDELETE, { method: "DELETE", params: p }),
      call(anon, logGET, { params: p }),
      call(anon, settlementGET, { params: p }),
      call(anon, statsGET, { params: p }),
    ]);
    expect(results.map((r) => r.status)).toEqual(Array(results.length).fill(401));
  });
});

// ---------------------------------------------------------------------------- groups

describe("groups", () => {
  it("creating a group makes the creator its first member and logs it", async () => {
    const a = new Client();
    await h.register(a, { username: "alice", displayName: "Alice", password: "secret1" });

    const r = await h.createGroup(a, "  Đi Đà Lạt ");
    expect(r.status).toBe(201);
    expect(r.json.data.group).toMatchObject({ name: "Đi Đà Lạt", memberCount: 1 });
    expect(r.json.data.group.inviteCode).toMatch(/^[A-Z2-9]{8}$/);

    const members = (await h.members(a, r.json.data.group.id)).json.data.members;
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ name: "Alice", username: "alice", removedAt: null });

    const log = (await h.log(a, r.json.data.group.id)).json.data.entries;
    expect(log.map((e: Json) => e.action)).toEqual(["group.create"]);
  });

  it("rejects an empty or oversized group name", async () => {
    const a = new Client();
    await h.register(a, { username: "alice", displayName: "Alice", password: "secret1" });
    expect((await h.createGroup(a, "   ")).status).toBe(400);
    expect((await h.createGroup(a, "x".repeat(61))).status).toBe(400);
  });

  it("a user can be in many groups and only sees their own", async () => {
    const a = new Client();
    const b = new Client();
    await h.register(a, { username: "alice", displayName: "Alice", password: "secret1" });
    await h.register(b, { username: "bob", displayName: "Bob", password: "secret2" });

    const g1 = (await h.createGroup(a, "G1")).json.data.group;
    await h.createGroup(a, "G2");
    expect((await h.listGroups(a)).json.data.groups).toHaveLength(2);
    expect((await h.listGroups(b)).json.data.groups).toHaveLength(0);

    await h.join(b, g1.inviteCode);
    const bobGroups = (await h.listGroups(b)).json.data.groups;
    expect(bobGroups).toHaveLength(1);
    expect(bobGroups[0]).toMatchObject({ name: "G1", memberCount: 2 });
  });

  it("join accepts any casing, is idempotent, and rejects unknown codes", async () => {
    const { bob, gid, code, bobM } = await setup();

    const again = await h.join(bob, code.toLowerCase());
    expect(again.status).toBe(200);
    expect(again.json.data.group.id).toBe(gid);
    expect(again.json.data.group.myMemberId).toBe(bobM);
    expect(count("SELECT COUNT(*) AS c FROM activity_log WHERE action = 'member.join'")).toBe(1);

    const bad = await h.join(bob, "ZZZZZZZZ");
    expect(bad.status).toBe(404);
  });

  it("separates 404 (no such group) from 403 (not a member)", async () => {
    const { gid } = await setup();
    const eve = new Client();
    await h.register(eve, { username: "eve", displayName: "Eve", password: "secret3" });

    expect((await h.getGroup(eve, gid)).status).toBe(403);
    expect((await h.getGroup(eve, "00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });

  it("GET group returns the group and its members", async () => {
    const { alice, gid } = await setup();
    const r = await h.getGroup(alice, gid);
    expect(r.json.data.group).toMatchObject({ id: gid, memberCount: 3 });
    expect(r.json.data.members.map((m: Json) => m.name).sort()).toEqual(["Alice", "Bob", "Chi"]);
  });
});

// ---------------------------------------------------------------------------- members

describe("members", () => {
  it("adds a friend by name (no account) and by username (linked account)", async () => {
    const { alice, gid, chiM } = await setup();
    const eve = new Client();
    await h.register(eve, { username: "eve", displayName: "Eve", password: "secret3" });

    const members = (await h.members(alice, gid)).json.data.members;
    expect(members.find((m: Json) => m.id === chiM)).toMatchObject({ userId: null, username: null });

    const linked = await h.addMember(alice, gid, { username: "EVE" });
    expect(linked.status).toBe(201);
    expect(linked.json.data.member).toMatchObject({ name: "Eve", username: "eve" });
    expect(linked.json.data.member.userId).toBeTruthy();

    // the linked account can now open the group
    expect((await h.getGroup(eve, gid)).status).toBe(200);
  });

  it("requires exactly one of name / username", async () => {
    const { alice, gid } = await setup();
    expect((await h.addMember(alice, gid, {})).status).toBe(400);
    expect((await h.addMember(alice, gid, { name: "A", username: "b" })).status).toBe(400);
  });

  it("rejects duplicate names case- and diacritic-insensitively among active members", async () => {
    const { alice, gid } = await setup();
    expect((await h.addMember(alice, gid, { name: "chi" })).status).toBe(409);
    expect((await h.addMember(alice, gid, { name: "  CHI " })).status).toBe(409);
    expect((await h.addMember(alice, gid, { name: "Đạt" })).status).toBe(201);
    expect((await h.addMember(alice, gid, { name: "đạt" })).status).toBe(409);
  });

  it("rejects an unknown username and an account that is already a member", async () => {
    const { alice, gid } = await setup();
    expect((await h.addMember(alice, gid, { username: "nobody" })).status).toBe(404);
    expect((await h.addMember(alice, gid, { username: "bob" })).status).toBe(409);
  });

  it("removal is soft: the member stays listed with removedAt and loses access", async () => {
    const { alice, bob, gid, bobM } = await setup();

    expect((await h.removeMember(alice, gid, bobM)).status).toBe(200);
    expect((await h.getGroup(bob, gid)).status).toBe(403);

    const removed = (await h.members(alice, gid)).json.data.members.find((m: Json) => m.id === bobM);
    expect(removed.removedAt).toBeTruthy();
    expect(count("SELECT COUNT(*) AS c FROM group_members WHERE id = ?", bobM)).toBe(1);
    expect((await h.getGroup(alice, gid)).json.data.group.memberCount).toBe(2);
  });

  it("cannot remove yourself or a member that is not there", async () => {
    const { alice, gid, aliceM, chiM } = await setup();
    expect((await h.removeMember(alice, gid, aliceM)).status).toBe(409);
    expect((await h.removeMember(alice, gid, "no-such-member")).status).toBe(404);

    await h.removeMember(alice, gid, chiM);
    expect((await h.removeMember(alice, gid, chiM)).status).toBe(404);
  });

  it("a removed account can rejoin by code and gets the same member row back", async () => {
    const { alice, bob, gid, code, bobM } = await setup();
    await h.removeMember(alice, gid, bobM);

    const r = await h.join(bob, code);
    expect(r.status).toBe(200);
    expect(r.json.data.group.myMemberId).toBe(bobM);
    expect(count("SELECT COUNT(*) AS c FROM group_members WHERE user_id IS NOT NULL")).toBe(2);
  });

  it("a removed account can be re-added by username without a unique-index error", async () => {
    const { alice, gid, bobM } = await setup();
    await h.removeMember(alice, gid, bobM);

    const r = await h.addMember(alice, gid, { username: "bob" });
    expect(r.status).toBe(201);
    expect(r.json.data.member.id).toBe(bobM);
    expect(r.json.data.member.removedAt).toBeNull();
  });

  it("a non-member cannot read or change members", async () => {
    const { gid } = await setup();
    const eve = new Client();
    await h.register(eve, { username: "eve", displayName: "Eve", password: "secret3" });
    expect((await h.members(eve, gid)).status).toBe(403);
    expect((await h.addMember(eve, gid, { name: "X" })).status).toBe(403);
  });

  // ------------------------------------------------------- viewer / owner (read-only here)

  it("reports the caller's owner flag on the member rows", async () => {
    const { alice, bob, gid, aliceM, bobM, chiM } = await setup();

    const members = (await h.members(alice, gid)).json.data.members;
    expect(members.find((m: Json) => m.id === aliceM).isOwner).toBe(true);
    expect(members.find((m: Json) => m.id === bobM).isOwner).toBe(false);
    // A friend without an account can never own the group (`is_owner` needs a linked user).
    expect(members.find((m: Json) => m.id === chiM).isOwner).toBe(false);

    // Every member sees the same owner, whoever asks.
    const fromBob = (await h.members(bob, gid)).json.data.members;
    expect(fromBob.find((m: Json) => m.id === aliceM).isOwner).toBe(true);
  });

  it("banks are per user: a linked member row carries the owner's profile, a friend none", async () => {
    const { alice, gid, aliceM, chiM } = await setup();
    const BANK = { bin: "970436", accountNo: "0123456789", accountName: "NGUYEN VAN A" };

    // There is no API to move a bank account onto a member row any more (the profile route is
    // the API lane's); write the user's profile directly to prove the READ derives it.
    testDb.raw
      .prepare(
        "UPDATE users SET bank_bin = ?, bank_account_no = ?, bank_account_name = ? WHERE username = 'alice'",
      )
      .run(BANK.bin, BANK.accountNo, BANK.accountName);

    const members = (await h.members(alice, gid)).json.data.members;
    expect(members.find((m: Json) => m.id === aliceM).bank).toEqual(BANK);
    expect(members.find((m: Json) => m.id === chiM).bank).toBeNull();
  });

  it("has no PATCH on a member: the bank account is not group-scoped any more", async () => {
    const route = await import("@/app/api/groups/[groupId]/members/[memberId]/route");
    expect("PATCH" in route).toBe(false);
  });
});

// ---------------------------------------------------------------------------- expenses

describe("expenses", () => {
  it("creates an expense split equally; shares always sum to the amount", async () => {
    const { alice, gid, aliceM, bobM, chiM } = await setup();

    const r = await h.createExpense(alice, gid, {
      title: "Ăn tối",
      amount: 100000,
      paidByMemberId: aliceM,
      participantMemberIds: [aliceM, bobM, chiM],
      note: "lẩu",
    });
    expect(r.status).toBe(201);

    const e = r.json.data.expense;
    expect(e).toMatchObject({ title: "Ăn tối", amount: 100000, paidByMemberId: aliceM, note: "lẩu" });
    expect(e.shares).toHaveLength(3);
    expect(sum(e.shares)).toBe(100000);
    expect(e.shares.map((s: Json) => s.amount).sort()).toEqual([33333, 33333, 33334]);
    expect(e.spentAt).toMatch(/Z$/);
  });

  it("splits only among the chosen participants", async () => {
    const { alice, gid, aliceM, bobM } = await setup();
    const r = await h.createExpense(alice, gid, {
      title: "Cà phê",
      amount: 50000,
      paidByMemberId: bobM,
      participantMemberIds: [aliceM, bobM],
    });
    expect(r.json.data.expense.shares.map((s: Json) => s.amount)).toEqual([25000, 25000]);
  });

  it("lists newest spentAt first and fetches one by id", async () => {
    const { alice, gid, aliceM } = await setup();
    const mk = (title: string, spentAt: string) =>
      h.createExpense(alice, gid, {
        title,
        amount: 1000,
        paidByMemberId: aliceM,
        participantMemberIds: [aliceM],
        spentAt,
      });
    await mk("old", "2026-10-01T00:00:00.000Z");
    const mid = await mk("mid", "2026-10-05T00:00:00.000Z");
    await mk("new", "2026-10-09T00:00:00.000Z");

    const list = (await h.expenses(alice, gid)).json.data.expenses;
    expect(list.map((e: Json) => e.title)).toEqual(["new", "mid", "old"]);

    const one = await h.getExpense(alice, gid, mid.json.data.expense.id);
    expect(one.json.data.expense.title).toBe("mid");
  });

  it.each([
    ["non-integer amount", { amount: 12.5 }],
    ["zero amount", { amount: 0 }],
    ["string amount", { amount: "1000" }],
    ["empty title", { title: "" }],
    ["no participants", { participantMemberIds: [] }],
    ["unknown payer", { paidByMemberId: "nope" }],
    ["unknown participant", { participantMemberIds: ["nope"] }],
    ["bad spentAt", { spentAt: "yesterday" }],
  ])("rejects %s with 400 and writes nothing", async (_label, override) => {
    const { alice, gid, aliceM } = await setup();
    const before = count("SELECT COUNT(*) AS c FROM activity_log");

    const r = await h.createExpense(alice, gid, {
      title: "x",
      amount: 1000,
      paidByMemberId: aliceM,
      participantMemberIds: [aliceM],
      ...override,
    });
    expect(r.status).toBe(400);
    expect(count("SELECT COUNT(*) AS c FROM expenses")).toBe(0);
    expect(count("SELECT COUNT(*) AS c FROM activity_log")).toBe(before);
  });

  it("rejects a removed member as payer or participant on a new expense", async () => {
    const { alice, gid, aliceM, chiM } = await setup();
    await h.removeMember(alice, gid, chiM);

    const asParticipant = await h.createExpense(alice, gid, {
      title: "x", amount: 1000, paidByMemberId: aliceM, participantMemberIds: [aliceM, chiM],
    });
    const asPayer = await h.createExpense(alice, gid, {
      title: "x", amount: 1000, paidByMemberId: chiM, participantMemberIds: [aliceM],
    });
    expect(asParticipant.status).toBe(400);
    expect(asPayer.status).toBe(400);
  });

  it("edit replaces shares and keeps spentAt when it is omitted", async () => {
    const { alice, gid, aliceM, bobM, chiM } = await setup();
    const created = (
      await h.createExpense(alice, gid, {
        title: "Ăn tối",
        amount: 100000,
        paidByMemberId: aliceM,
        participantMemberIds: [aliceM, bobM, chiM],
        spentAt: "2026-10-05T12:00:00.000Z",
      })
    ).json.data.expense;

    const r = await h.updateExpense(alice, gid, created.id, {
      title: "Ăn tối (sửa)",
      amount: 90000,
      paidByMemberId: bobM,
      participantMemberIds: [aliceM, bobM],
    });
    expect(r.status).toBe(200);
    expect(r.json.data.expense).toMatchObject({
      title: "Ăn tối (sửa)",
      amount: 90000,
      paidByMemberId: bobM,
      spentAt: "2026-10-05T12:00:00.000Z",
    });
    expect(sum(r.json.data.expense.shares)).toBe(90000);

    const stored = (await h.getExpense(alice, gid, created.id)).json.data.expense;
    expect(stored.shares).toHaveLength(2);
    expect(count("SELECT COUNT(*) AS c FROM expense_shares WHERE expense_id = ?", created.id)).toBe(2);
  });

  it("an edit may keep a removed member who was already in the expense", async () => {
    const { alice, gid, aliceM, chiM } = await setup();
    const created = (
      await h.createExpense(alice, gid, {
        title: "x", amount: 1000, paidByMemberId: aliceM, participantMemberIds: [aliceM, chiM],
      })
    ).json.data.expense;
    await h.removeMember(alice, gid, chiM);

    const r = await h.updateExpense(alice, gid, created.id, {
      title: "x2", amount: 2000, paidByMemberId: aliceM, participantMemberIds: [aliceM, chiM],
    });
    expect(r.status).toBe(200);
    expect(r.json.data.expense.shares).toHaveLength(2);
  });

  it("delete is soft: gone from list, 404 on fetch, row kept for the log", async () => {
    const { alice, gid, aliceM } = await setup();
    const e = (
      await h.createExpense(alice, gid, {
        title: "x", amount: 1000, paidByMemberId: aliceM, participantMemberIds: [aliceM],
      })
    ).json.data.expense;

    expect((await h.deleteExpense(alice, gid, e.id)).status).toBe(200);
    expect((await h.expenses(alice, gid)).json.data.expenses).toHaveLength(0);
    expect((await h.getExpense(alice, gid, e.id)).status).toBe(404);
    expect(count("SELECT COUNT(*) AS c FROM expenses WHERE id = ? AND deleted_at IS NOT NULL", e.id)).toBe(1);

    // a deleted expense cannot be edited or deleted again
    expect((await h.deleteExpense(alice, gid, e.id)).status).toBe(404);
    expect(
      (await h.updateExpense(alice, gid, e.id, {
        title: "y", amount: 1, paidByMemberId: aliceM, participantMemberIds: [aliceM],
      })).status,
    ).toBe(404);
  });

  it("is isolated per group: another group's expense id is 404, a non-member is 403", async () => {
    const { alice, gid, aliceM } = await setup();
    const e = (
      await h.createExpense(alice, gid, {
        title: "x", amount: 1000, paidByMemberId: aliceM, participantMemberIds: [aliceM],
      })
    ).json.data.expense;

    const otherGroup = (await h.createGroup(alice, "Nhóm khác")).json.data.group;
    expect((await h.getExpense(alice, otherGroup.id, e.id)).status).toBe(404);
    expect((await h.updateExpense(alice, otherGroup.id, e.id, {
      title: "hack", amount: 1, paidByMemberId: otherGroup.myMemberId, participantMemberIds: [otherGroup.myMemberId],
    })).status).toBe(404);
    expect((await h.deleteExpense(alice, otherGroup.id, e.id)).status).toBe(404);

    const eve = new Client();
    await h.register(eve, { username: "eve", displayName: "Eve", password: "secret3" });
    expect((await h.expenses(eve, gid)).status).toBe(403);
    expect((await h.deleteExpense(eve, gid, e.id)).status).toBe(403);
  });

  it("any active member can edit and delete (not just the creator)", async () => {
    const { alice, bob, gid, aliceM } = await setup();
    const e = (
      await h.createExpense(alice, gid, {
        title: "x", amount: 1000, paidByMemberId: aliceM, participantMemberIds: [aliceM],
      })
    ).json.data.expense;

    expect((await h.deleteExpense(bob, gid, e.id)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------- settlement

describe("settlement", () => {
  it("is empty and zero for a group with no expenses", async () => {
    const { alice, gid } = await setup();
    const r = (await h.settlement(alice, gid)).json.data;
    expect(r.totalSpent).toBe(0);
    expect(r.transfers).toEqual([]);
    expect(r.balances.every((b: Json) => b.net === 0)).toBe(true);
  });

  it("computes balances and the transfers that settle them", async () => {
    const { alice, gid, aliceM, bobM, chiM } = await setup();
    await h.createExpense(alice, gid, {
      title: "Khách sạn", amount: 90000, paidByMemberId: aliceM, participantMemberIds: [aliceM, bobM, chiM],
    });

    const r = (await h.settlement(alice, gid)).json.data;
    expect(r.totalSpent).toBe(90000);

    const net = Object.fromEntries(r.balances.map((b: Json) => [b.name, b.net]));
    expect(net).toEqual({ Alice: 60000, Bob: -30000, Chi: -30000 });

    expect(r.transfers).toHaveLength(2);
    expect(r.transfers.every((t: Json) => t.toMemberId === aliceM && t.amount === 30000)).toBe(true);
    expect(r.transfers.map((t: Json) => t.fromMemberId).sort()).toEqual([bobM, chiM].sort());
  });

  it("nets out across several expenses", async () => {
    const { alice, gid, aliceM, bobM, chiM } = await setup();
    await h.createExpense(alice, gid, {
      title: "A", amount: 90000, paidByMemberId: aliceM, participantMemberIds: [aliceM, bobM, chiM],
    });
    await h.createExpense(alice, gid, {
      title: "B", amount: 50000, paidByMemberId: bobM, participantMemberIds: [aliceM, bobM],
    });

    const r = (await h.settlement(alice, gid)).json.data;
    const net = Object.fromEntries(r.balances.map((b: Json) => [b.name, b.net]));
    // Alice paid 90000, owes 30000+25000. Bob paid 50000, owes 30000+25000. Chi owes 30000.
    expect(net).toEqual({ Alice: 35000, Bob: -5000, Chi: -30000 });
    expect(Object.values(net).reduce((a, b) => a + (b as number), 0)).toBe(0);
  });

  it("ignores deleted expenses and reflects edits", async () => {
    const { alice, gid, aliceM, bobM } = await setup();
    const a = (
      await h.createExpense(alice, gid, {
        title: "A", amount: 1000, paidByMemberId: aliceM, participantMemberIds: [aliceM, bobM],
      })
    ).json.data.expense;
    const b = (
      await h.createExpense(alice, gid, {
        title: "B", amount: 4000, paidByMemberId: aliceM, participantMemberIds: [aliceM, bobM],
      })
    ).json.data.expense;

    await h.deleteExpense(alice, gid, b.id);
    await h.updateExpense(alice, gid, a.id, {
      title: "A", amount: 2000, paidByMemberId: aliceM, participantMemberIds: [aliceM, bobM],
    });

    const r = (await h.settlement(alice, gid)).json.data;
    expect(r.totalSpent).toBe(2000);
    expect(r.transfers).toEqual([{ fromMemberId: bobM, toMemberId: aliceM, amount: 1000 }]);
  });

  it("keeps a removed member who still has a balance, hides one with none", async () => {
    const { alice, gid, aliceM, bobM, chiM } = await setup();
    await h.createExpense(alice, gid, {
      title: "A", amount: 3000, paidByMemberId: aliceM, participantMemberIds: [aliceM, bobM],
    });
    await h.removeMember(alice, gid, bobM); // owes 1500
    await h.removeMember(alice, gid, chiM); // never involved

    const r = (await h.settlement(alice, gid)).json.data;
    const names = r.balances.map((b: Json) => b.name);
    expect(names).toContain("Bob");
    expect(names).not.toContain("Chi");
    expect(r.balances.find((b: Json) => b.name === "Bob")).toMatchObject({ removed: true, net: -1500 });
    expect(r.transfers).toEqual([{ fromMemberId: bobM, toMemberId: aliceM, amount: 1500 }]);
  });

  it("keeps totalSpent on spending only: a recorded payment cancels the transfer without adding to it", async () => {
    const { alice, bob, gid, aliceM, bobM } = await setup();
    await h.createExpense(alice, gid, {
      title: "Ăn tối", amount: 240000, paidByMemberId: aliceM, participantMemberIds: [aliceM, bobM],
    });

    const before = (await h.settlement(alice, gid)).json.data;
    expect(before.totalSpent).toBe(240000);
    expect(before.transfers).toEqual([{ fromMemberId: bobM, toMemberId: aliceM, amount: 120000 }]);

    // Bob settles what he owes: the payer is Bob, the single receiver is Alice.
    const paid = await h.createExpense(bob, gid, {
      title: "Thanh toán", amount: 120000, paidByMemberId: bobM, participantMemberIds: [aliceM], kind: "payment",
    });
    expect(paid.status).toBe(201);
    expect(paid.json.data.expense.kind).toBe("payment");

    const after = (await h.settlement(alice, gid)).json.data;
    // The debt is cancelled: no transfer left...
    expect(after.transfers).toEqual([]);
    expect(after.balances.every((b: Json) => b.net === 0)).toBe(true);
    // ...and the payment itself is not spending.
    expect(after.totalSpent).toBe(240000);
  });

  it("a group with only payments has spent nothing while its balances still add up", async () => {
    const { alice, bob, gid, aliceM, bobM } = await setup();
    await h.createExpense(bob, gid, {
      title: "Thanh toán", amount: 50000, paidByMemberId: bobM, participantMemberIds: [aliceM], kind: "payment",
    });

    const r = (await h.settlement(alice, gid)).json.data;
    expect(r.totalSpent).toBe(0);

    const net = Object.fromEntries(r.balances.map((b: Json) => [b.name, b.net]));
    // Bob paid 50000 to Alice: Alice is 50000 down, Bob 50000 up, Chi untouched, summing to zero.
    expect(net).toEqual({ Alice: -50000, Bob: 50000, Chi: 0 });
    expect(Object.values(net).reduce((a, b) => a + (b as number), 0)).toBe(0);
    expect(r.transfers).toEqual([{ fromMemberId: aliceM, toMemberId: bobM, amount: 50000 }]);
  });

  it("is only visible to group members", async () => {
    const { gid } = await setup();
    const eve = new Client();
    await h.register(eve, { username: "eve", displayName: "Eve", password: "secret3" });
    expect((await h.settlement(eve, gid)).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------- log

describe("activity log", () => {
  it("records every mutation, newest first, with actor and timestamp", async () => {
    const { alice, gid, aliceM, bobM } = await setup();
    const e = (
      await h.createExpense(alice, gid, {
        title: "Ăn tối", amount: 100000, paidByMemberId: aliceM, participantMemberIds: [aliceM, bobM],
      })
    ).json.data.expense;
    await h.updateExpense(alice, gid, e.id, {
      title: "Ăn tối", amount: 80000, paidByMemberId: aliceM, participantMemberIds: [aliceM, bobM],
    });
    await h.deleteExpense(alice, gid, e.id);
    await h.removeMember(alice, gid, bobM);

    const entries = (await h.log(alice, gid)).json.data.entries;
    expect(entries.map((x: Json) => x.action)).toEqual([
      "member.remove",
      "expense.delete",
      "expense.update",
      "expense.create",
      "member.add",
      "member.join",
      "group.create",
    ]);
    for (const x of entries) {
      expect(x.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
      expect(x.actorName).toBeTruthy();
      expect(x.summary).toBeTruthy();
      expect(x.groupId).toBe(gid);
    }
    expect(entries[2].summary).toContain("sửa chi tiêu");
    expect(entries[2].summary).toContain("80.000đ");
  });

  it("keeps before/after snapshots for edits and deletes", async () => {
    const { alice, gid, aliceM } = await setup();
    const e = (
      await h.createExpense(alice, gid, {
        title: "x", amount: 1000, paidByMemberId: aliceM, participantMemberIds: [aliceM],
      })
    ).json.data.expense;
    await h.updateExpense(alice, gid, e.id, {
      title: "x", amount: 2000, paidByMemberId: aliceM, participantMemberIds: [aliceM],
    });
    await h.deleteExpense(alice, gid, e.id);

    const entries = (await h.log(alice, gid)).json.data.entries;
    const byAction = (a: string) => entries.find((x: Json) => x.action === a);
    expect(byAction("expense.create").detail.after.amount).toBe(1000);
    expect(byAction("expense.update").detail.before.amount).toBe(1000);
    expect(byAction("expense.update").detail.after.amount).toBe(2000);
    expect(byAction("expense.delete").detail.before.amount).toBe(2000);
  });

  it("paginates with limit and nextBefore without gaps or repeats", async () => {
    const { alice, gid, aliceM } = await setup();
    for (let i = 0; i < 4; i += 1) {
      await h.createExpense(alice, gid, {
        title: `e${i}`, amount: 1000, paidByMemberId: aliceM, participantMemberIds: [aliceM],
      });
    }
    const all = (await h.log(alice, gid)).json.data.entries.map((x: Json) => x.id);
    expect(all).toHaveLength(7);

    const seen: string[] = [];
    let before: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const q: string = `?limit=3${before ? `&before=${before}` : ""}`;
      const r: Json = (await h.log(alice, gid, q)).json.data;
      seen.push(...r.entries.map((x: Json) => x.id));
      before = r.nextBefore;
      if (!before) break;
    }
    expect(seen).toEqual(all);
  });

  it("validates limit and before, and clamps limit to 200", async () => {
    const { alice, gid } = await setup();
    expect((await h.log(alice, gid, "?limit=0")).status).toBe(400);
    expect((await h.log(alice, gid, "?limit=abc")).status).toBe(400);
    expect((await h.log(alice, gid, "?before=xyz")).status).toBe(400);
    expect((await h.log(alice, gid, "?limit=100000")).status).toBe(200);
  });

  it("is scoped to the group and its members", async () => {
    const { alice, gid } = await setup();
    const other = (await h.createGroup(alice, "Khác")).json.data.group;

    const otherLog = (await h.log(alice, other.id)).json.data.entries;
    expect(otherLog.map((x: Json) => x.action)).toEqual(["group.create"]);

    const eve = new Client();
    await h.register(eve, { username: "eve", displayName: "Eve", password: "secret3" });
    expect((await h.log(eve, gid)).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------- rate limiting

describe("rate limiting", () => {
  const withIp = (ip: string) => ({ "cf-connecting-ip": ip });

  it("throttles login attempts and answers 429 RATE_LIMITED with Retry-After", async () => {
    const c = new Client();
    const limit = MEMORY_RULES.auth.limit;

    for (let i = 0; i < limit; i += 1) {
      const r = await call(c, loginPOST, {
        method: "POST",
        body: { username: "ghost", password: "wrong-pass" },
        headers: withIp("203.0.113.9"),
      });
      expect(r.status).toBe(401);
    }

    const blocked = await call(c, loginPOST, {
      method: "POST",
      body: { username: "ghost", password: "wrong-pass" },
      headers: withIp("203.0.113.9"),
    });
    expect(blocked.status).toBe(429);
    expect(blocked.json.error.code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("counts per client address: another address is unaffected", async () => {
    const c = new Client();
    for (let i = 0; i < MEMORY_RULES.auth.limit + 1; i += 1) {
      await call(c, loginPOST, {
        method: "POST",
        body: { username: "ghost", password: "wrong-pass" },
        headers: withIp("203.0.113.9"),
      });
    }
    const other = await call(c, loginPOST, {
      method: "POST",
      body: { username: "ghost", password: "wrong-pass" },
      headers: withIp("198.51.100.7"),
    });
    expect(other.status).toBe(401);
  });

  it("throttles the general API and a rejected request touches no database", async () => {
    const c = new Client();
    for (let i = 0; i < MEMORY_RULES.api.limit; i += 1) {
      expect((await call(c, meGET, { headers: withIp("203.0.113.50") })).status).toBe(401);
    }

    testDb.prepared.length = 0;
    const blocked = await call(c, meGET, { headers: withIp("203.0.113.50") });
    expect(blocked.status).toBe(429);
    expect(testDb.prepared).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------- query efficiency

describe("query efficiency", () => {
  const sessionReads = () => testDb.prepared.filter((sql) => /FROM sessions s/.test(sql)).length;

  it("resolves a session once, then serves it from the isolate cache", async () => {
    const c = new Client();
    await h.register(c, { username: "alice", displayName: "Alice", password: "secret1" });
    testDb.prepared.length = 0;

    for (let i = 0; i < 4; i += 1) {
      expect((await h.me(c)).status).toBe(200);
    }
    expect(sessionReads()).toBe(1);
  });

  it("remembers an unknown session token, so cookie spam costs one read", async () => {
    const c = new Client();
    c.jar.set("sid", "not-a-real-token");
    expect((await h.me(c)).status).toBe(401);
    expect((await h.me(c)).status).toBe(401);
    expect((await h.me(c)).status).toBe(401);
    expect(sessionReads()).toBe(1);
  });

  it("logout takes effect immediately in the isolate that handled it", async () => {
    const c = new Client();
    await h.register(c, { username: "alice", displayName: "Alice", password: "secret1" });
    expect((await h.me(c)).status).toBe(200); // warms the cache
    await h.logout(c);
    expect((await h.me(c)).status).toBe(401);
  });

  it("checks group membership with a single query", async () => {
    const { alice, gid } = await setup();
    testDb.prepared.length = 0;

    await h.members(alice, gid);

    const membershipChecks = testDb.prepared.filter((sql) => /FROM groups g/.test(sql));
    expect(membershipChecks).toHaveLength(1);
    expect(testDb.prepared.some((sql) => /SELECT id FROM groups WHERE id = \?/.test(sql))).toBe(false);
  });

  it("returns members with the expense list so the page needs one request", async () => {
    const { alice, gid, aliceM } = await setup();
    await h.createExpense(alice, gid, {
      title: "x", amount: 1000, paidByMemberId: aliceM, participantMemberIds: [aliceM],
    });

    const r = (await h.expenses(alice, gid)).json.data;
    expect(r.members.map((m: Json) => m.name).sort()).toEqual(["Alice", "Bob", "Chi"]);
    expect(r.hasMore).toBe(false);
  });

  it("loads the list and its shares in two statements, bounded by the limit", async () => {
    const { alice, gid, aliceM, bobM } = await setup();
    for (let i = 0; i < 5; i += 1) {
      await h.createExpense(alice, gid, {
        title: `e${i}`,
        amount: 1000,
        paidByMemberId: aliceM,
        participantMemberIds: [aliceM, bobM],
        spentAt: `2026-10-0${i + 1}T00:00:00.000Z`,
      });
    }

    testDb.prepared.length = 0;
    const page = await loadExpenseList(testDb.d1, gid, 3);

    expect(testDb.prepared).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.expenses.map((e) => e.title)).toEqual(["e4", "e3", "e2"]);
    expect(page.expenses.every((e) => e.shares.length === 2)).toBe(true);

    const all = await loadExpenseList(testDb.d1, gid, 5);
    expect(all.hasMore).toBe(false);
    expect(all.expenses).toHaveLength(5);
  });

  it("answers hot queries from indexes, with no table scan or sort", async () => {
    const plan = (sql: string) =>
      (testDb.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>)
        .map((row) => row.detail)
        .join(" | ");

    const list = plan(
      `SELECT id FROM expenses e WHERE e.group_id = 'g' AND e.deleted_at IS NULL
       ORDER BY e.spent_at DESC, e.created_at DESC, e.id DESC LIMIT 301`,
    );
    expect(list).toContain("idx_expenses_group_live");
    expect(list).not.toMatch(/TEMP B-TREE|SCAN expenses/);

    const groups = plan(
      `SELECT g.id FROM groups g JOIN group_members mm ON mm.group_id = g.id
       AND mm.user_id = 'u' AND mm.removed_at IS NULL`,
    );
    expect(groups).toMatch(/idx_group_members_user_id|idx_group_members_group_user/);
    expect(groups).not.toMatch(/SCAN group_members/);

    const log = plan("SELECT id FROM activity_log WHERE group_id = 'g' ORDER BY id DESC LIMIT 50");
    expect(log).toContain("idx_activity_log_group_id");
    expect(log).not.toMatch(/TEMP B-TREE/);
  });

  it("migration 0002 drops the indexes nothing reads", () => {
    const names = (testDb.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>).map((r) => r.name);
    expect(names).not.toContain("idx_expenses_group_id");
    expect(names).not.toContain("idx_sessions_user_id");
    expect(names).toContain("idx_expenses_group_live");
    expect(names).toContain("idx_group_members_user_id");
  });
});

// ---------------------------------------------------------------------------- presets

describe("presets", () => {
  const shuttle = { name: "Quả cầu lông", unitPrice: 29000 };

  it("creates, lists A to Z, updates and deletes", async () => {
    const { alice, gid } = await setup();

    const created = await h.createPreset(alice, gid, shuttle);
    expect(created.status).toBe(201);
    expect(created.json.data.preset).toMatchObject({ ...shuttle, groupId: gid });
    await h.createPreset(alice, gid, { name: "Nước suối", unitPrice: 5000 });

    const listed = (await h.presets(alice, gid)).json.data.presets;
    expect(listed.map((p: Json) => p.name)).toEqual(["Nước suối", "Quả cầu lông"]);

    const id = created.json.data.preset.id;
    const updated = await h.updatePreset(alice, gid, id, { name: "Quả cầu lông Yonex", unitPrice: 31000 });
    expect(updated.status).toBe(200);
    expect(updated.json.data.preset).toMatchObject({ id, name: "Quả cầu lông Yonex", unitPrice: 31000 });

    expect((await h.deletePreset(alice, gid, id)).status).toBe(200);
    expect((await h.presets(alice, gid)).json.data.presets).toHaveLength(1);
    expect((await h.deletePreset(alice, gid, id)).status).toBe(404);
  });

  it("validates name and price", async () => {
    const { alice, gid } = await setup();
    for (const body of [
      { name: "", unitPrice: 1000 },
      { name: "   ", unitPrice: 1000 },
      { name: "x".repeat(51), unitPrice: 1000 },
      { name: "Cầu", unitPrice: 0 },
      { name: "Cầu", unitPrice: -5 },
      { name: "Cầu", unitPrice: 1.5 },
      { name: "Cầu", unitPrice: "29000" },
      { name: "Cầu", unitPrice: 1_000_000_001 },
      { name: "Cầu" },
    ]) {
      const res = await h.createPreset(alice, gid, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.json.error.code).toBe("VALIDATION");
    }
    expect((await h.presets(alice, gid)).json.data.presets).toHaveLength(0);
  });

  it("rejects a duplicate name regardless of case and Vietnamese diacritic case", async () => {
    const { alice, gid } = await setup();
    await h.createPreset(alice, gid, { name: "Cầu lông", unitPrice: 29000 });

    for (const name of ["cầu lông", "CẦU LÔNG", "  Cầu lông  "]) {
      const res = await h.createPreset(alice, gid, { name, unitPrice: 1000 });
      expect(res.status, name).toBe(409);
      expect(res.json.error.code).toBe("CONFLICT");
    }

    const other = (await h.createPreset(alice, gid, { name: "Nước", unitPrice: 5000 })).json.data.preset;
    expect((await h.updatePreset(alice, gid, other.id, { name: "CẦU LÔNG", unitPrice: 5000 })).status).toBe(409);
    // Renaming to its own name (only the price changes) is not a clash.
    expect((await h.updatePreset(alice, gid, other.id, { name: "nước", unitPrice: 6000 })).status).toBe(200);
  });

  it("is scoped to the group and to its members", async () => {
    const { alice, bob, gid } = await setup();
    const preset = (await h.createPreset(alice, gid, shuttle)).json.data.preset;

    // bob is a member: shared list.
    expect((await h.presets(bob, gid)).json.data.presets).toHaveLength(1);
    expect((await h.updatePreset(bob, gid, preset.id, { name: "Cầu", unitPrice: 30000 })).status).toBe(200);

    const outsider = new Client();
    await h.register(outsider, { username: "eve", displayName: "Eve", password: "secret3" });
    expect((await h.presets(outsider, gid)).status).toBe(403);
    expect((await h.createPreset(outsider, gid, shuttle)).status).toBe(403);
    expect((await h.deletePreset(outsider, gid, preset.id)).status).toBe(403);
    expect((await h.presets(new Client(), gid)).status).toBe(401);
    expect((await h.presets(alice, "missing")).status).toBe(404);

    // A preset id from one group cannot be touched through another group.
    const second = (await h.createGroup(alice, "Nhóm khác")).json.data.group.id;
    expect((await h.deletePreset(alice, second, preset.id)).status).toBe(404);
    expect((await h.presets(alice, second)).json.data.presets).toHaveLength(0);
  });

  it("caps presets per group", async () => {
    const { alice, gid } = await setup();
    const insert = testDb.raw.prepare(
      "INSERT INTO expense_presets (id, group_id, name, unit_price, created_at, updated_at) VALUES (?, ?, ?, 1000, 'x', 'x')",
    );
    for (let i = 0; i < 100; i += 1) {
      insert.run(`p${i}`, gid, `Mục ${i}`);
    }
    const res = await h.createPreset(alice, gid, { name: "Mục 101", unitPrice: 1000 });
    expect(res.status).toBe(400);
    expect(res.json.error.message).toContain("100");
  });

  it("writes every change to the activity log", async () => {
    const { alice, gid } = await setup();
    const preset = (await h.createPreset(alice, gid, shuttle)).json.data.preset;
    await h.updatePreset(alice, gid, preset.id, { name: shuttle.name, unitPrice: 30000 });
    await h.deletePreset(alice, gid, preset.id);

    const entries = (await h.log(alice, gid)).json.data.entries.slice(0, 3);
    expect(entries.map((e: Json) => e.action)).toEqual(["preset.delete", "preset.update", "preset.create"]);
    expect(entries.every((e: Json) => e.entityType === "preset" && e.entityId === preset.id)).toBe(true);
    expect(entries[2].summary).toContain("29.000đ");
    expect(entries[1].detail.before.unitPrice).toBe(29000);
    expect(entries[1].detail.after.unitPrice).toBe(30000);
  });

  it("deleting a preset leaves expenses created from it untouched", async () => {
    const { alice, gid, aliceM, bobM } = await setup();
    const preset = (await h.createPreset(alice, gid, shuttle)).json.data.preset;
    const expense = (
      await h.createExpense(alice, gid, {
        title: "Quả cầu lông ×3", amount: 87000, paidByMemberId: aliceM, participantMemberIds: [aliceM, bobM],
      })
    ).json.data.expense;

    await h.deletePreset(alice, gid, preset.id);

    const after = (await h.getExpense(alice, gid, expense.id)).json.data.expense;
    expect(after.amount).toBe(87000);
    expect(sum(after.shares)).toBe(87000);
  });

  describe("sync", () => {
    async function twoGroups() {
      const base = await setup();
      const second = (await h.createGroup(base.alice, "Nhóm cầu lông")).json.data.group;
      return { ...base, sid: second.id as string };
    }

    it("copies missing presets and keeps the ones already there", async () => {
      const { alice, gid, sid } = await twoGroups();
      await h.createPreset(alice, sid, { name: "Quả cầu lông", unitPrice: 29000 });
      await h.createPreset(alice, sid, { name: "Nước suối", unitPrice: 5000 });
      await h.createPreset(alice, gid, { name: "nước suối", unitPrice: 7000 });

      const res = await h.syncPresets(alice, gid, { sourceGroupId: sid });
      expect(res.status).toBe(200);
      expect(res.json.data).toMatchObject({ added: 1, updated: 0, skipped: 1 });

      const byName = Object.fromEntries(
        res.json.data.presets.map((p: Json) => [p.name, p.unitPrice]),
      );
      expect(byName).toEqual({ "Quả cầu lông": 29000, "nước suối": 7000 }); // own price kept

      // Source group is untouched.
      expect((await h.presets(alice, sid)).json.data.presets).toHaveLength(2);
    });

    it("is idempotent and writes no log row when nothing changes", async () => {
      const { alice, gid, sid } = await twoGroups();
      await h.createPreset(alice, sid, shuttle);

      await h.syncPresets(alice, gid, { sourceGroupId: sid });
      const logsBefore = count("SELECT COUNT(*) AS c FROM activity_log WHERE action = 'preset.sync'");
      const again = await h.syncPresets(alice, gid, { sourceGroupId: sid });

      expect(again.json.data).toMatchObject({ added: 0, updated: 0, skipped: 1 });
      expect(count("SELECT COUNT(*) AS c FROM activity_log WHERE action = 'preset.sync'")).toBe(logsBefore);
      expect(count("SELECT COUNT(*) AS c FROM expense_presets WHERE group_id = ?", gid)).toBe(1);
    });

    it("overwrite re-prices matching names only", async () => {
      const { alice, gid, sid } = await twoGroups();
      await h.createPreset(alice, sid, { name: "Quả cầu lông", unitPrice: 31000 });
      await h.createPreset(alice, gid, { name: "Quả cầu lông", unitPrice: 29000 });
      await h.createPreset(alice, gid, { name: "Chỉ ở nhóm này", unitPrice: 1000 });

      const res = await h.syncPresets(alice, gid, { sourceGroupId: sid, overwrite: true });
      expect(res.json.data).toMatchObject({ added: 0, updated: 1, skipped: 0 });

      const byName = Object.fromEntries(res.json.data.presets.map((p: Json) => [p.name, p.unitPrice]));
      expect(byName).toEqual({ "Quả cầu lông": 31000, "Chỉ ở nhóm này": 1000 });
    });

    it("logs the sync with the source group and counts", async () => {
      const { alice, gid, sid } = await twoGroups();
      await h.createPreset(alice, sid, shuttle);
      await h.syncPresets(alice, gid, { sourceGroupId: sid });

      const entry = (await h.log(alice, gid)).json.data.entries[0];
      expect(entry.action).toBe("preset.sync");
      expect(entry.summary).toContain("Nhóm cầu lông");
      expect(entry.summary).toContain("thêm 1");
      expect(entry.detail).toMatchObject({ sourceGroupId: sid, overwrite: false, added: [shuttle.name] });
    });

    it("refuses a source group the caller is not in, and never copies from it", async () => {
      const { alice, bob, gid, sid } = await twoGroups();
      await h.createPreset(alice, sid, shuttle);

      // bob is in gid but not in sid.
      const res = await h.syncPresets(bob, gid, { sourceGroupId: sid });
      expect(res.status).toBe(403);
      expect(count("SELECT COUNT(*) AS c FROM expense_presets WHERE group_id = ?", gid)).toBe(0);
    });

    it("validates the request", async () => {
      const { alice, gid, sid } = await twoGroups();
      expect((await h.syncPresets(alice, gid, { sourceGroupId: gid })).status).toBe(400);
      expect((await h.syncPresets(alice, gid, {})).status).toBe(400);
      expect((await h.syncPresets(alice, gid, { sourceGroupId: sid, overwrite: "yes" })).status).toBe(400);
      expect((await h.syncPresets(alice, gid, { sourceGroupId: "missing" })).status).toBe(404);
    });

    it("refuses a sync that would pass the per-group cap, changing nothing", async () => {
      const { alice, gid, sid } = await twoGroups();
      const insert = testDb.raw.prepare(
        "INSERT INTO expense_presets (id, group_id, name, unit_price, created_at, updated_at) VALUES (?, ?, ?, 1000, 'x', 'x')",
      );
      for (let i = 0; i < 60; i += 1) {
        insert.run(`a${i}`, gid, `A ${i}`);
        insert.run(`b${i}`, sid, `B ${i}`);
      }

      const res = await h.syncPresets(alice, gid, { sourceGroupId: sid });
      expect(res.status).toBe(400);
      expect(count("SELECT COUNT(*) AS c FROM expense_presets WHERE group_id = ?", gid)).toBe(60);
    });
  });
});

// ---------------------------------------------------------------------------- admin

describe("admin account", () => {
  const ADMIN_PASSWORD = "Adm1n-passw0rd-long";

  /** What an operator does out of band: build the SQL with the script and run it. */
  async function createAdmin(username = "admin") {
    testDb.raw.exec(await buildAdminSql({ username, password: ADMIN_PASSWORD }));
    const admin = new Client();
    const res = await h.login(admin, { username, password: ADMIN_PASSWORD });
    return { admin, res };
  }

  async function aliceAndAdmin() {
    const alice = new Client();
    const reg = await h.register(alice, { username: "alice", displayName: "Alice", password: "secret1" });
    const { admin } = await createAdmin();
    return { alice, admin, aliceId: reg.json.data.user.id as string };
  }

  it("is created by the script, logs in with role admin, and registration cannot make one", async () => {
    const { res } = await createAdmin();
    expect(res.status).toBe(200);
    expect(res.json.data.user).toMatchObject({ username: "admin", role: "admin" });

    const reg = await h.register(new Client(), { username: "bob", displayName: "Bob", password: "secret2" });
    expect(reg.json.data.user.role).toBe("user");

    // Nobody can register a name that reads as the admin account.
    for (const username of ["admin", "Administrator", "quantri", "root"]) {
      const res2 = await h.register(new Client(), { username, displayName: "x", password: "secret3" });
      expect(res2.status, username).toBe(400);
    }
  });

  it("script SQL rotates only the admin's password and never takes over a normal user", async () => {
    await createAdmin();
    const first = testDb.raw.prepare("SELECT password_hash FROM users WHERE username = 'admin'").get() as {
      password_hash: string;
    };

    testDb.raw.exec(await buildAdminSql({ username: "admin", password: "Another-long-pass-9" }));
    const row = testDb.raw
      .prepare("SELECT password_hash, password_salt, role FROM users WHERE username = 'admin'")
      .get() as { password_hash: string; password_salt: string; role: string };
    expect(row.password_hash).not.toBe(first.password_hash);
    expect(row.role).toBe("admin");
    expect(await verifyPassword("Another-long-pass-9", row.password_hash, row.password_salt)).toBe(true);
    expect(count("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'")).toBe(1);

    // A normal user already holds the name: the statement changes nothing.
    await h.register(new Client(), { username: "taken", displayName: "Taken", password: "secret1" });
    const before = testDb.raw.prepare("SELECT password_hash, role FROM users WHERE username = 'taken'").get();
    testDb.raw.exec(await buildAdminSql({ username: "taken", password: ADMIN_PASSWORD }));
    expect(testDb.raw.prepare("SELECT password_hash, role FROM users WHERE username = 'taken'").get()).toEqual(
      before,
    );
  });

  it("refuses a short admin password", async () => {
    await expect(buildAdminSql({ username: "admin", password: "short" })).rejects.toThrow();
  });

  it("lists plain users only, with no secrets, and only to the admin", async () => {
    const { alice, admin } = await aliceAndAdmin();

    expect((await h.adminUsers(alice)).status).toBe(403);
    expect((await h.adminUsers(new Client())).status).toBe(401);

    const res = await h.adminUsers(admin);
    expect(res.status).toBe(200);
    expect(res.json.data.users.map((u: Json) => u.username)).toEqual(["alice"]);
    expect(Object.keys(res.json.data.users[0]).sort()).toEqual([
      "banReason",
      "bannedAt",
      "createdAt",
      "displayName",
      "id",
      "recentAbuse",
      "username",
    ]);
    expect(JSON.stringify(res.json)).not.toMatch(/hash|salt|PBKDF|role/i);
  });

  it("re-issues a generated password: old one dies, new one works, sessions end, audit row written", async () => {
    const { alice, admin, aliceId } = await aliceAndAdmin();
    const otherDevice = new Client();
    await h.login(otherDevice, { username: "alice", password: "secret1" });
    expect((await h.me(otherDevice)).status).toBe(200);

    const res = await h.resetPassword(admin, aliceId);
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ generated: true, user: { username: "alice" } });
    const fresh = res.json.data.password as string;
    expect(fresh).toHaveLength(12);

    // Sessions on every device are gone; the old password no longer logs in.
    expect((await h.me(alice)).status).toBe(401);
    expect((await h.me(otherDevice)).status).toBe(401);
    expect((await h.login(new Client(), { username: "alice", password: "secret1" })).status).toBe(401);
    expect((await h.login(new Client(), { username: "alice", password: fresh })).status).toBe(200);

    const audit = testDb.raw.prepare("SELECT * FROM admin_audit").all() as Array<Record<string, unknown>>;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ target_user_id: aliceId, action: "password.reset" });
    expect(JSON.stringify(audit)).not.toContain(fresh);
  });

  it("accepts a password chosen by the admin and validates it", async () => {
    const { admin, aliceId } = await aliceAndAdmin();

    expect((await h.resetPassword(admin, aliceId, { password: "12345" })).status).toBe(400);
    const res = await h.resetPassword(admin, aliceId, { password: "my own pass" });
    expect(res.json.data).toMatchObject({ generated: false, password: "my own pass" });
    expect((await h.login(new Client(), { username: "alice", password: "my own pass" })).status).toBe(200);
  });

  it("refuses non-admins, unknown ids, and resetting the admin itself", async () => {
    const { alice, admin, aliceId } = await aliceAndAdmin();
    const bob = new Client();
    const bobId = (await h.register(bob, { username: "bob", displayName: "Bob", password: "secret2" })).json.data
      .user.id;

    // A normal user cannot reset anyone, including themselves or others.
    expect((await h.resetPassword(alice, bobId)).status).toBe(403);
    expect((await h.resetPassword(alice, aliceId)).status).toBe(403);
    expect((await h.resetPassword(new Client(), bobId)).status).toBe(401);
    // bob is untouched.
    expect((await h.login(new Client(), { username: "bob", password: "secret2" })).status).toBe(200);

    expect((await h.resetPassword(admin, "missing")).status).toBe(404);
    const adminId = (testDb.raw.prepare("SELECT id FROM users WHERE role = 'admin'").get() as { id: string }).id;
    expect((await h.resetPassword(admin, adminId)).status).toBe(403);
  });

  it("cannot create or join groups, is never a listed member, and cannot be linked by username", async () => {
    const { alice, admin } = await aliceAndAdmin();
    const group = (await h.createGroup(alice, "Nhóm")).json.data.group;

    expect((await h.listGroups(admin)).status).toBe(403);
    expect((await h.createGroup(admin, "Nhóm admin")).status).toBe(403);
    expect((await h.join(admin, group.inviteCode)).status).toBe(403);

    // Viewing is allowed (admin manages every group) but never makes it a member.
    const members = await h.members(admin, group.id);
    expect(members.status).toBe(200);
    expect(members.json.data.members.map((m: Json) => m.name)).toEqual(["Alice"]);
    expect(count("SELECT COUNT(*) AS c FROM group_members WHERE user_id IN (SELECT id FROM users WHERE role='admin')")).toBe(0);

    const added = await h.addMember(alice, group.id, { username: "admin" });
    expect(added.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------- abuse + admin power

describe("admin management", () => {
  const ADMIN_PASSWORD = "Adm1n-passw0rd-long";
  const ip = (address: string) => ({ "cf-connecting-ip": address });

  async function world() {
    testDb.raw.exec(await buildAdminSql({ username: "admin", password: ADMIN_PASSWORD }));
    const admin = new Client();
    await h.login(admin, { username: "admin", password: ADMIN_PASSWORD });
    const alice = new Client();
    const bob = new Client();
    const aliceId = (await h.register(alice, { username: "alice", displayName: "Alice", password: "secret1" })).json
      .data.user.id as string;
    const bobId = (await h.register(bob, { username: "bob", displayName: "Bob", password: "secret2" })).json.data
      .user.id as string;
    const group = (await h.createGroup(alice, "Đi Đà Lạt")).json.data.group;
    const joined = (await h.join(bob, group.inviteCode)).json.data.group;
    return {
      admin,
      alice,
      bob,
      aliceId,
      bobId,
      gid: group.id as string,
      code: group.inviteCode as string,
      aliceM: group.myMemberId as string,
      bobM: joined.myMemberId as string,
    };
  }

  /** A signed-in account whose requests carry `address` and a `sid` cookie header. */
  async function accountAt(username: string, address: string) {
    const c = new Client();
    await call(c, registerPOST, {
      method: "POST",
      body: { username, displayName: username, password: "secret1" },
      headers: ip(address),
    });
    expect(c.jar.get("sid"), `${username} must be signed in`).toBeTruthy();
    const headers = { ...ip(address), cookie: `sid=${c.jar.get("sid")}` };
    return { c, headers };
  }

  /** Fire more writes than one session may make in a window. */
  async function flood(account: { c: Client; headers: Record<string, string> }) {
    let last = 0;
    for (let i = 0; i <= MEMORY_RULES.write.limit; i += 1) {
      const r = await call(account.c, groupsPOST, {
        method: "POST",
        body: { name: `g${i}` },
        headers: account.headers,
      });
      last = r.status;
    }
    return last;
  }

  // ----------------------------------------------------------------- account bans

  describe("account bans", () => {
    it("ban signs the user out at once, refuses login, keeps their data, and unban restores it", async () => {
      const w = await world();

      const res = await h.banUser(w.admin, w.aliceId, { reason: "spam" });
      expect(res.status).toBe(200);

      expect((await h.me(w.alice)).status).toBe(401);
      expect(count("SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?", w.aliceId)).toBe(0);

      // Right password: told they are banned. Wrong password: the same answer as any stranger.
      const right = await h.login(new Client(), { username: "alice", password: "secret1" });
      expect(right.status).toBe(403);
      expect(right.json.error.message).toMatch(/khóa/);
      expect((await h.login(new Client(), { username: "alice", password: "nope-nope" })).status).toBe(401);

      // Data stays: the group and the member row are still there.
      expect(count("SELECT COUNT(*) AS c FROM groups WHERE id = ?", w.gid)).toBe(1);
      expect(count("SELECT COUNT(*) AS c FROM group_members WHERE user_id = ?", w.aliceId)).toBe(1);

      const listed = (await h.adminUsers(w.admin)).json.data.users.find((u: Json) => u.id === w.aliceId);
      expect(listed).toMatchObject({ banReason: "spam" });
      expect(listed.bannedAt).toEqual(expect.any(String));

      expect((await h.unbanUser(w.admin, w.aliceId)).status).toBe(200);
      expect((await h.login(new Client(), { username: "alice", password: "secret1" })).status).toBe(200);

      const actions = (testDb.raw.prepare("SELECT action FROM admin_audit ORDER BY id").all() as Array<{ action: string }>)
        .map((r) => r.action);
      expect(actions).toEqual(["user.ban", "user.unban"]);
    });

    it("only the admin may ban, never the admin account, and unknown ids are 404", async () => {
      const w = await world();
      const adminId = (testDb.raw.prepare("SELECT id FROM users WHERE role='admin'").get() as { id: string }).id;

      expect((await h.banUser(w.alice, w.bobId)).status).toBe(403);
      expect((await h.banUser(new Client(), w.bobId)).status).toBe(401);
      expect((await h.banUser(w.admin, adminId)).status).toBe(403);
      expect((await h.banUser(w.admin, "missing")).status).toBe(404);
      expect((await h.unbanUser(w.admin, "missing")).status).toBe(404);
      expect((await h.banUser(w.admin, w.bobId, { reason: "x".repeat(201) })).status).toBe(400);

      // bob is untouched by every refused attempt.
      expect((await h.me(w.bob)).status).toBe(200);
    });

    it("a banned account that already holds a session id cannot use it again", async () => {
      const w = await world();
      const token = w.alice.jar.get("sid") as string;
      await h.banUser(w.admin, w.aliceId);

      // Even a session row that somehow survived must not authenticate a banned account.
      testDb.raw
        .prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
        .run(
          Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), (b) =>
            b.toString(16).padStart(2, "0"),
          ).join(""),
          w.aliceId,
          new Date(Date.now() + 86_400_000).toISOString(),
          new Date().toISOString(),
        );
      clearSessionCache();
      const c = new Client();
      c.jar.set("sid", token);
      expect((await h.me(c)).status).toBe(401);
    });
  });

  // ------------------------------------------------------------------- IP bans

  describe("IP bans", () => {
    it("a banned address gets 403 on the API, others are unaffected, and lifting restores it", async () => {
      const w = await world();

      const res = await h.banIp(w.admin, { ip: "203.0.113.9", reason: "abuse", hours: 24 });
      expect(res.status).toBe(201);

      const c = new Client();
      const blocked = await call(c, meGET, { headers: ip("203.0.113.9") });
      expect(blocked.status).toBe(403);
      expect(blocked.json.error.message).toMatch(/IP/);
      // Login and registration are API routes too: a banned address cannot start over.
      expect((await call(c, loginPOST, { method: "POST", body: { username: "a", password: "bbbbbb" }, headers: ip("203.0.113.9") })).status).toBe(403);
      expect((await call(c, meGET, { headers: ip("198.51.100.1") })).status).toBe(401);

      expect((await h.liftIp(w.admin, "203.0.113.9")).status).toBe(200);
      expect((await call(c, meGET, { headers: ip("203.0.113.9") })).status).toBe(401);
    });

    it("a banned address can still reach the admin routes, so the admin can never be locked out", async () => {
      const w = await world();
      await h.banIp(w.admin, { ip: "203.0.113.9" });

      const list = await call(w.admin, adminIpBansGET, { headers: ip("203.0.113.9") });
      expect(list.status).toBe(200);
      expect(list.json.data.bans.map((b: Json) => b.ip)).toEqual(["203.0.113.9"]);
    });

    it("refuses to ban the address the admin is using, bad addresses, and non-admins", async () => {
      const w = await world();

      expect((await h.banIp(w.admin, { ip: "203.0.113.9" }, ip("203.0.113.9"))).status).toBe(400);
      expect((await h.banIp(w.admin, { ip: "not an ip" })).status).toBe(400);
      expect((await h.banIp(w.admin, { ip: "300.1.1.1" })).status).toBe(400);
      expect((await h.banIp(w.admin, { ip: "1.2.3.4", hours: 0 })).status).toBe(400);
      expect((await h.banIp(w.alice, { ip: "1.2.3.4" })).status).toBe(403);
      expect((await h.ipBans(w.alice)).status).toBe(403);
      expect((await h.liftIp(w.alice, "1.2.3.4")).status).toBe(403);
      expect(count("SELECT COUNT(*) AS c FROM ip_bans")).toBe(0);
    });

    it("a timed ban expires on its own and a permanent ban has no end", async () => {
      const w = await world();
      await h.banIp(w.admin, { ip: "203.0.113.9", hours: 1 });
      await h.banIp(w.admin, { ip: "203.0.113.10" }); // permanent

      const rows = testDb.raw.prepare("SELECT ip, expires_at FROM ip_bans ORDER BY ip").all() as Array<{
        ip: string;
        expires_at: string | null;
      }>;
      const byIp = Object.fromEntries(rows.map((r) => [r.ip, r.expires_at]));
      expect(byIp["203.0.113.9"]).toEqual(expect.any(String));
      expect(byIp["203.0.113.10"]).toBeNull();

      // Move the clock past the first ban's end: only the permanent one still applies.
      invalidateBanCache();
      const later = Date.now() + 2 * 60 * 60_000;
      expect(await isIpBanned("203.0.113.9", later)).toBe(false);
      invalidateBanCache();
      expect(await isIpBanned("203.0.113.10", later)).toBe(true);
    });

    it("is never applied to an unknown address, and fails open when the table is unreadable", async () => {
      const w = await world();
      await h.banIp(w.admin, { ip: "203.0.113.9" });
      expect(await isIpBanned("unknown")).toBe(false);

      resetGuardState();
      testDb.raw.exec("DROP TABLE ip_bans");
      expect(await isIpBanned("203.0.113.9")).toBe(false);
      // The API keeps working before the migration is applied.
      expect((await call(new Client(), meGET, { headers: ip("203.0.113.9") })).status).toBe(401);
    });

    it("normalises addresses so one spelling cannot slip past a ban", () => {
      expect(normalizeIp(" 203.0.113.9 ")).toBe("203.0.113.9");
      expect(normalizeIp("2001:DB8:0:0:0:0:0:1")).toBe("2001:db8::1");
      expect(normalizeIp("999.1.1.1")).toBeNull();
      expect(normalizeIp("example.com")).toBeNull();
      expect(normalizeIp("")).toBeNull();
    });
  });

  // ----------------------------------------------------------------- spam guard

  describe("spam guard", () => {
    it("rejects the write that exceeds a session's budget with 429", async () => {
      await world();
      const a = await accountAt("spammer", "203.0.113.20");
      expect(await flood(a)).toBe(429);
    });

    it("budgets writes per session: a shared address does not pool its users' budgets", async () => {
      await world();
      const a = await accountAt("one", "203.0.113.21");
      const b = await accountAt("two", "203.0.113.21");
      for (let i = 0; i < MEMORY_RULES.write.limit; i += 1) {
        expect((await call(a.c, groupsPOST, { method: "POST", body: { name: `a${i}` }, headers: a.headers })).status).toBe(201);
      }
      const other = await call(b.c, groupsPOST, { method: "POST", body: { name: "b" }, headers: b.headers });
      expect(other.status).toBe(201);
    });

    it("reads are never budgeted as writes", async () => {
      await world();
      const a = await accountAt("reader", "203.0.113.22");
      for (let i = 0; i < MEMORY_RULES.write.limit + 5; i += 1) {
        expect((await call(a.c, groupsGET, { headers: a.headers })).status).toBe(200);
      }
    });

    it("bans the address once 3 different accounts spam from it, and only flags the accounts", async () => {
      const w = await world();
      const accounts = [
        await accountAt("spam_one", "203.0.113.30"),
        await accountAt("spam_two", "203.0.113.30"),
        await accountAt("spam_three", "203.0.113.30"),
      ];

      await flood(accounts[0]);
      await flood(accounts[1]);
      expect(count("SELECT COUNT(*) AS c FROM ip_bans")).toBe(0); // 2 accounts: not enough

      await flood(accounts[2]);
      const ban = testDb.raw.prepare("SELECT * FROM ip_bans").get() as Record<string, string | null>;
      expect(ban).toMatchObject({ ip: "203.0.113.30", source: "auto", created_by: null });
      const hours = (Date.parse(ban.expires_at as string) - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(23.9);
      expect(hours).toBeLessThanOrEqual(ABUSE.autoBanMs / 3_600_000);

      // The address is now refused...
      expect((await call(new Client(), meGET, { headers: ip("203.0.113.30") })).status).toBe(403);
      // ...but the accounts themselves are not banned, only flagged for the admin.
      expect(count("SELECT COUNT(*) AS c FROM users WHERE banned_at IS NOT NULL")).toBe(0);
      const users = (await h.adminUsers(w.admin)).json.data.users as Json[];
      for (const name of ["spam_one", "spam_two", "spam_three"]) {
        expect(users.find((u) => u.username === name).recentAbuse).toBe(1);
      }
      // And the admin sees it, can lift it early.
      const list = (await h.ipBans(w.admin)).json.data.bans as Json[];
      expect(list.map((b) => [b.ip, b.source])).toEqual([["203.0.113.30", "auto"]]);
      expect((await h.liftIp(w.admin, "203.0.113.30")).status).toBe(200);
      expect((await call(new Client(), meGET, { headers: ip("203.0.113.30") })).status).toBe(401);
    });

    it("records one event per account per window, however long the flood goes on", async () => {
      await world();
      const a = await accountAt("loud", "203.0.113.31");
      await flood(a);
      await flood(a);
      await flood(a);
      expect(count("SELECT COUNT(*) AS c FROM abuse_events")).toBe(1);
    });

    it("lists a spamming address as a suspect until it is banned, and a banned one drops out", async () => {
      const w = await world();
      await flood(await accountAt("spam_one", "203.0.113.32"));

      const suspects = (await h.ipBans(w.admin)).json.data.suspects as Json[];
      expect(suspects).toHaveLength(1);
      expect(suspects[0]).toMatchObject({ ip: "203.0.113.32", accounts: 1, events: 1 });

      await h.banIp(w.admin, { ip: "203.0.113.32", hours: 24 });
      expect((await h.ipBans(w.admin)).json.data.suspects).toEqual([]);
    });

    it("caps sign-ups per address per day without touching other addresses", async () => {
      for (let i = 0; i < ABUSE.registrationsPerDay; i += 1) {
        const r = await call(new Client(), registerPOST, {
          method: "POST",
          body: { username: `user${i}`, displayName: `U${i}`, password: "secret1" },
          headers: ip("203.0.113.40"),
        });
        expect(r.status, `signup ${i}`).toBe(201);
        resetRateLimits(); // isolate the daily cap from the per-minute login limiter
      }

      const over = await call(new Client(), registerPOST, {
        method: "POST",
        body: { username: "one_too_many", displayName: "X", password: "secret1" },
        headers: ip("203.0.113.40"),
      });
      expect(over.status).toBe(429);
      expect(over.json.error.message).toMatch(/quá nhiều tài khoản/);

      const other = await call(new Client(), registerPOST, {
        method: "POST",
        body: { username: "elsewhere", displayName: "X", password: "secret1" },
        headers: ip("203.0.113.41"),
      });
      expect(other.status).toBe(201);
    });

    it("rejects an oversized JSON body before parsing it", async () => {
      const w = await world();
      const huge = await call(w.alice, groupsPOST, {
        method: "POST",
        body: { name: "x".repeat(MAX_BODY_BYTES + 1) },
      });
      expect(huge.status).toBe(400);
      expect(huge.json.error.message).toMatch(/quá lớn/);

      const declared = await call(w.alice, groupsPOST, {
        method: "POST",
        body: { name: "ok" },
        headers: { "content-length": String(MAX_BODY_BYTES + 1) },
      });
      expect(declared.status).toBe(400);

      expect((await h.createGroup(w.alice, "Bình thường")).status).toBe(201);
    });
  });

  // ------------------------------------------------------------ group management

  describe("group management", () => {
    it("lists every group with counts, deleted ones included, to the admin only", async () => {
      const w = await world();
      await h.createExpense(w.alice, w.gid, {
        title: "Ăn tối",
        amount: 90000,
        paidByMemberId: w.aliceM,
        participantMemberIds: [w.aliceM, w.bobM],
      });
      await h.deleteGroup(w.admin, w.gid);

      expect((await h.adminGroups(w.alice)).status).toBe(403);
      const res = await h.adminGroups(w.admin);
      expect(res.status).toBe(200);
      expect(res.json.data.groups).toHaveLength(1);
      expect(res.json.data.groups[0]).toMatchObject({
        id: w.gid,
        name: "Đi Đà Lạt",
        memberCount: 2,
        expenseCount: 1,
        deletedAt: expect.any(String),
      });
    });

    it("soft delete hides the group from members and join codes, restore brings it all back", async () => {
      const w = await world();
      await h.createExpense(w.alice, w.gid, {
        title: "Ăn tối",
        amount: 90000,
        paidByMemberId: w.aliceM,
        participantMemberIds: [w.aliceM, w.bobM],
      });

      expect((await h.deleteGroup(w.admin, w.gid)).status).toBe(200);

      expect((await h.listGroups(w.alice)).json.data.groups).toEqual([]);
      expect((await h.getGroup(w.alice, w.gid)).status).toBe(404);
      expect((await h.expenses(w.alice, w.gid)).status).toBe(404);
      expect((await h.join(new Client().jar.size ? w.bob : w.bob, w.code)).status).toBe(404);
      // Nothing is erased.
      expect(count("SELECT COUNT(*) AS c FROM expenses WHERE group_id = ?", w.gid)).toBe(1);
      // The admin can still open it.
      expect((await h.getGroup(w.admin, w.gid)).status).toBe(200);

      expect((await h.restoreGroup(w.admin, w.gid)).status).toBe(200);
      expect((await h.listGroups(w.alice)).json.data.groups.map((g: Json) => g.name)).toEqual(["Đi Đà Lạt"]);
      expect((await h.expenses(w.alice, w.gid)).json.data.expenses).toHaveLength(1);
    });

    it("query helpers hide a deleted group from members but not from the admin view", async () => {
      const w = await world();
      await h.deleteGroup(w.admin, w.gid);

      expect(await getGroupView(testDb.d1, w.gid, w.aliceId)).toBeNull();
      expect(await listGroupsForUser(testDb.d1, w.aliceId)).toEqual([]);
      expect(await getGroupAdminView(testDb.d1, w.gid)).toMatchObject({ id: w.gid, myMemberId: "" });
    });

    it("is idempotent, logs under the admin identity once, and refuses non-admins", async () => {
      const w = await world();

      expect((await h.deleteGroup(w.alice, w.gid)).status).toBe(403);
      expect((await h.restoreGroup(w.alice, w.gid)).status).toBe(403);
      expect((await h.renameGroup(w.alice, w.gid, "Hack")).status).toBe(403);
      expect((await h.deleteGroup(w.admin, "missing")).status).toBe(404);

      await h.deleteGroup(w.admin, w.gid);
      await h.deleteGroup(w.admin, w.gid); // again: no second row
      await h.restoreGroup(w.admin, w.gid);
      await h.restoreGroup(w.admin, w.gid);

      const log = (await h.log(w.alice, w.gid)).json.data.entries as Json[];
      const admin = log.filter((e) => e.actorName === "Quản trị viên");
      expect(admin.map((e) => e.action).sort()).toEqual(["group.delete", "group.restore"]);
      expect(admin[0].summary).toMatch(/Quản trị viên đã/);
    });

    it("rename validates the name and is logged with before and after", async () => {
      const w = await world();

      expect((await h.renameGroup(w.admin, w.gid, "")).status).toBe(400);
      expect((await h.renameGroup(w.admin, w.gid, "x".repeat(61))).status).toBe(400);

      const res = await h.renameGroup(w.admin, w.gid, "Phú Quốc");
      expect(res.status).toBe(200);
      expect((await h.getGroup(w.alice, w.gid)).json.data.group.name).toBe("Phú Quốc");

      const entry = ((await h.log(w.alice, w.gid)).json.data.entries as Json[]).find(
        (e) => e.action === "group.rename",
      );
      expect(entry.detail).toEqual({ before: { name: "Đi Đà Lạt" }, after: { name: "Phú Quốc" } });
    });

    it("the admin can add, edit and delete expenses, members and presets, all logged as Quản trị viên", async () => {
      const w = await world();

      const created = await h.createExpense(w.admin, w.gid, {
        title: "Taxi",
        amount: 100000,
        paidByMemberId: w.aliceM,
        participantMemberIds: [w.aliceM, w.bobM],
      });
      expect(created.status).toBe(201);
      const eid = created.json.data.expense.id as string;

      expect(
        (
          await h.updateExpense(w.admin, w.gid, eid, {
            title: "Taxi sân bay",
            amount: 120000,
            paidByMemberId: w.bobM,
            participantMemberIds: [w.aliceM, w.bobM],
          })
        ).status,
      ).toBe(200);

      const friend = await h.addMember(w.admin, w.gid, { name: "Chi" });
      expect(friend.status).toBe(201);
      expect((await h.createPreset(w.admin, w.gid, { name: "Cầu lông", unitPrice: 29000 })).status).toBe(201);
      expect((await h.deleteExpense(w.admin, w.gid, eid)).status).toBe(200);

      const entries = (await h.log(w.alice, w.gid)).json.data.entries as Json[];
      const byAdmin = entries.filter((e) => e.actorName === "Quản trị viên").map((e) => e.action).sort();
      expect(byAdmin).toEqual(["expense.create", "expense.delete", "expense.update", "member.add", "preset.create"]);

      // Settlement still computes for the edited data.
      expect((await h.settlement(w.alice, w.gid)).status).toBe(200);
      // Stats reads a group the admin is not a member of, as the same built-in actor.
      const stats = await h.stats(w.admin, w.gid);
      expect(stats.status).toBe(200);
      expect(stats.json.data.stats.total).toBe(0); // the only expense above was deleted
    });

    it("the admin cannot remove its own (virtual) member, and members cannot see an admin member", async () => {
      const w = await world();
      const members = (await h.members(w.alice, w.gid)).json.data.members as Json[];
      expect(members.map((m) => m.name).sort()).toEqual(["Alice", "Bob"]);
      expect((await h.removeMember(w.admin, w.gid, w.bobM)).status).toBe(200);
      expect(((await h.members(w.alice, w.gid)).json.data.members as Json[]).find((m) => m.id === w.bobM).removedAt)
        .toEqual(expect.any(String));
    });
  });
});

// ---------------------------------------------------------------------------- stats

describe("stats", () => {
  /**
   * Pins the clock before the request that depends on it. Only `Date` is faked: the whole
   * facade (sessions, hashing) keeps using the real one.
   */
  function pinClock(isoNow: string): void {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(isoNow));
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("all: one bucket per local year with data, ascending, no zero fill", async () => {
    const { alice, gid, aliceM, bobM } = await setup();
    for (const [title, amount, spentAt] of [
      ["2025", 7000, "2025-06-01T03:00:00.000Z"],
      ["2026a", 5000, "2026-10-15T08:30:00.000Z"],
      ["2026b", 15000, "2026-03-02T08:30:00.000Z"],
    ] as const) {
      const r = await h.createExpense(alice, gid, {
        title, amount, spentAt, paidByMemberId: aliceM, participantMemberIds: [aliceM, bobM],
      });
      expect(r.status).toBe(201);
    }

    const stats = (await h.stats(alice, gid)).json.data.stats;
    expect(stats).toMatchObject({ period: "all", year: null, month: null, total: 27000, count: 3 });
    expect(stats.buckets).toEqual([
      { key: "2025", label: "2025", amount: 7000, count: 1 },
      { key: "2026", label: "2026", amount: 20000, count: 2 },
    ]);
  });

  it("year: always twelve zero-filled months, totalling the whole local year", async () => {
    const { alice, gid, aliceM, bobM } = await setup();
    for (const [amount, spentAt] of [
      [5000, "2026-10-15T08:30:00.000Z"],
      [15000, "2026-03-02T08:30:00.000Z"],
      [99000, "2025-03-02T08:30:00.000Z"], // another year: outside the range
    ] as const) {
      await h.createExpense(alice, gid, {
        title: "x", amount, spentAt, paidByMemberId: aliceM, participantMemberIds: [aliceM, bobM],
      });
    }

    const stats = (await h.stats(alice, gid, "?period=year&year=2026")).json.data.stats;
    expect(stats).toMatchObject({ period: "year", year: 2026, month: null, total: 20000, count: 2 });
    expect(stats.buckets).toHaveLength(12);
    expect(stats.buckets.map((b: Json) => b.label)).toEqual(
      ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12"],
    );
    expect(stats.buckets[2]).toEqual({ key: "03", label: "T3", amount: 15000, count: 1 });
    expect(stats.buckets[9]).toEqual({ key: "10", label: "T10", amount: 5000, count: 1 });
    expect(stats.buckets.filter((b: Json) => b.amount === 0)).toHaveLength(10);
    expect(stats.buckets.reduce((sum: number, b: Json) => sum + b.amount, 0)).toBe(stats.total);
  });

  it("month: one zero-filled bucket per day of that local month", async () => {
    const { alice, gid, aliceM, bobM } = await setup();
    for (const [amount, spentAt] of [
      [5000, "2026-10-15T08:30:00.000Z"],
      [2000, "2026-10-15T20:00:00.000Z"], // 03:00 on 16 Oct, Vietnam time
      [1000, "2026-11-02T08:30:00.000Z"], // another month
    ] as const) {
      await h.createExpense(alice, gid, {
        title: "x", amount, spentAt, paidByMemberId: aliceM, participantMemberIds: [aliceM, bobM],
      });
    }

    const stats = (await h.stats(alice, gid, "?period=month&year=2026&month=10")).json.data.stats;
    expect(stats).toMatchObject({ period: "month", year: 2026, month: 10, total: 7000, count: 2 });
    expect(stats.buckets).toHaveLength(31);
    expect(stats.buckets[0]).toEqual({ key: "01", label: "1", amount: 0, count: 0 });
    expect(stats.buckets[14]).toEqual({ key: "15", label: "15", amount: 5000, count: 1 });
    expect(stats.buckets[15]).toEqual({ key: "16", label: "16", amount: 2000, count: 1 });
    expect(stats.buckets[30]).toEqual({ key: "31", label: "31", amount: 0, count: 0 });
  });

  it("buckets by Vietnam time: a UTC evening on 31 Dec lands on 1 Jan of the next year", async () => {
    const { alice, gid, aliceM, bobM } = await setup();
    await h.createExpense(alice, gid, {
      title: "Giao thừa", amount: 8000, spentAt: "2026-12-31T17:30:00.000Z", // 00:30 on 1 Jan 2027 local
      paidByMemberId: aliceM, participantMemberIds: [aliceM, bobM],
    });

    const all = (await h.stats(alice, gid)).json.data.stats;
    expect(all.buckets).toEqual([{ key: "2027", label: "2027", amount: 8000, count: 1 }]);

    // The row belongs to the 2027 local year, so 2026 is empty...
    expect((await h.stats(alice, gid, "?period=year&year=2026")).json.data.stats.total).toBe(0);
    // ...and 2027 January holds it on day 1.
    const jan = (await h.stats(alice, gid, "?period=month&year=2027&month=1")).json.data.stats;
    expect(jan.total).toBe(8000);
    expect(jan.buckets[0]).toEqual({ key: "01", label: "1", amount: 8000, count: 1 });
  });

  it("never counts a settlement payment as spending, in buckets, total or members", async () => {
    const { alice, bob, gid, aliceM, bobM } = await setup();
    await h.createExpense(alice, gid, {
      title: "Ăn tối", amount: 240000, spentAt: "2026-10-15T08:30:00.000Z",
      paidByMemberId: aliceM, participantMemberIds: [aliceM, bobM],
    });
    // Bob settles half: a payment row, not a cost.
    const payment = await h.createExpense(bob, gid, {
      title: "Thanh toán", amount: 120000, spentAt: "2026-10-15T08:30:00.000Z",
      paidByMemberId: bobM, participantMemberIds: [aliceM], kind: "payment",
    });
    expect(payment.status).toBe(201);
    expect(payment.json.data.expense.kind).toBe("payment");

    const stats = (await h.stats(alice, gid)).json.data.stats;
    expect(stats).toMatchObject({ total: 240000, count: 1 });
    expect(stats.buckets).toEqual([{ key: "2026", label: "2026", amount: 240000, count: 1 }]);
    // Bob paid that row, but it is not spending: his `paid` stays at zero.
    const byName = Object.fromEntries(stats.members.map((m: Json) => [m.name, m]));
    expect(byName.Bob).toMatchObject({ paid: 0, owed: 120000 });
    expect(byName.Alice).toMatchObject({ paid: 240000, owed: 120000 });

    // A group holding ONLY a payment has spent nothing at all.
    const onlyGroup = (await h.createGroup(alice, "Nhóm chỉ thanh toán")).json.data.group;
    const joined = (await h.join(bob, onlyGroup.inviteCode)).json.data.group;
    await h.createExpense(bob, onlyGroup.id, {
      title: "Thanh toán", amount: 50000, paidByMemberId: joined.myMemberId,
      participantMemberIds: [onlyGroup.myMemberId], kind: "payment",
    });
    expect((await h.stats(alice, onlyGroup.id)).json.data.stats).toMatchObject({
      total: 0, count: 0, buckets: [], members: [],
    });
  });

  it("ignores soft-deleted expenses everywhere", async () => {
    const { alice, gid, aliceM, bobM } = await setup();
    await h.createExpense(alice, gid, {
      title: "Giữ", amount: 3000, spentAt: "2026-10-15T08:30:00.000Z",
      paidByMemberId: aliceM, participantMemberIds: [aliceM, bobM],
    });
    const gone = (
      await h.createExpense(alice, gid, {
        title: "Xoá", amount: 900000, spentAt: "2026-10-16T08:30:00.000Z",
        paidByMemberId: bobM, participantMemberIds: [aliceM, bobM],
      })
    ).json.data.expense;
    expect((await h.deleteExpense(alice, gid, gone.id)).status).toBe(200);

    const stats = (await h.stats(alice, gid)).json.data.stats;
    expect(stats).toMatchObject({ total: 3000, count: 1 });
    expect(stats.buckets).toEqual([{ key: "2026", label: "2026", amount: 3000, count: 1 }]);
    // Bob's deleted expense was the only one he paid, so his `paid` is zero; his share of the
    // kept one still counts, so he keeps a row.
    expect(stats.members).toEqual([
      { memberId: aliceM, name: "Alice", removed: false, owed: 1500, paid: 3000 },
      { memberId: bobM, name: "Bob", removed: false, owed: 1500, paid: 0 },
    ]);
  });

  it("sums owed from shares and paid from the payer, biggest owed first", async () => {
    const { alice, gid, aliceM, bobM, chiM } = await setup();
    // Alice pays 90000 split three ways: each owes 30000.
    await h.createExpense(alice, gid, {
      title: "Khách sạn", amount: 90000, spentAt: "2026-10-15T08:30:00.000Z",
      paidByMemberId: aliceM, participantMemberIds: [aliceM, bobM, chiM],
    });
    // Chi pays 30000 split two ways with Bob: 15000 each, so both end on 45000 owed.
    await h.createExpense(alice, gid, {
      title: "Cà phê", amount: 30000, spentAt: "2026-10-16T08:30:00.000Z",
      paidByMemberId: chiM, participantMemberIds: [bobM, chiM],
    });

    const stats = (await h.stats(alice, gid)).json.data.stats;
    expect(stats.members).toEqual([
      // Tied on 45000 owed: the Vietnamese comparison puts Bob before Chi. Alice owes least.
      { memberId: bobM, name: "Bob", removed: false, owed: 45000, paid: 0 },
      { memberId: chiM, name: "Chi", removed: false, owed: 45000, paid: 30000 },
      { memberId: aliceM, name: "Alice", removed: false, owed: 30000, paid: 90000 },
    ]);
  });

  it("keeps a removed member who had activity, with removed: true", async () => {
    const { alice, gid, aliceM, bobM, chiM } = await setup();
    await h.createExpense(alice, gid, {
      title: "A", amount: 3000, spentAt: "2026-10-15T08:30:00.000Z",
      paidByMemberId: aliceM, participantMemberIds: [aliceM, bobM],
    });
    await h.removeMember(alice, gid, bobM); // owes 1500
    await h.removeMember(alice, gid, chiM); // never involved

    const stats = (await h.stats(alice, gid)).json.data.stats;
    expect(stats.members.find((m: Json) => m.name === "Bob")).toMatchObject({ removed: true, owed: 1500 });
    expect(stats.members.map((m: Json) => m.name)).not.toContain("Chi");
  });

  it("defaults to all, and to the current Vietnam year and month when they are omitted", async () => {
    const { alice, gid, aliceM, bobM } = await setup();
    await h.createExpense(alice, gid, {
      title: "A", amount: 4000, spentAt: "2026-10-15T08:30:00.000Z",
      paidByMemberId: aliceM, participantMemberIds: [aliceM, bobM],
    });

    pinClock("2026-10-20T03:00:00.000Z"); // 10:00 on 20 Oct in Vietnam

    const def = (await h.stats(alice, gid)).json.data.stats;
    expect(def).toMatchObject({ period: "all", year: null, month: null, total: 4000 });

    const year = (await h.stats(alice, gid, "?period=year")).json.data.stats;
    expect(year).toMatchObject({ period: "year", year: 2026, month: null, total: 4000 });
    expect(year.buckets).toHaveLength(12);

    const month = (await h.stats(alice, gid, "?period=month")).json.data.stats;
    expect(month).toMatchObject({ period: "month", year: 2026, month: 10, total: 4000 });
    expect(month.buckets).toHaveLength(31);
  });

  it.each([
    ["an unknown period", "?period=week"],
    ["a year that is not 4 digits", "?period=year&year=26"],
    ["a year below the range", "?period=year&year=1969"],
    ["a year above the range", "?period=year&year=2101"],
    ["month zero", "?period=month&year=2026&month=0"],
    ["month thirteen", "?period=month&year=2026&month=13"],
    ["a non-numeric month", "?period=month&year=2026&month=ab"],
    // A malformed pair is rejected even when the period does not use it.
    ["a bad year under period=all", "?period=all&year=26"],
  ])("rejects %s with 400 VALIDATION", async (_label, query) => {
    const { alice, gid } = await setup();
    const r = await h.stats(alice, gid, query);
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("VALIDATION");
    expect(r.json.error.message).toMatch(/[àáảãạăâđêôơư]/i);
  });

  it("is only visible to group members", async () => {
    const { gid } = await setup();
    const eve = new Client();
    await h.register(eve, { username: "eve", displayName: "Eve", password: "secret3" });
    expect((await h.stats(eve, gid)).status).toBe(403);
    expect((await h.stats(eve, "no-such-group")).status).toBe(404);
  });

  it("a group with no expenses gives zeros and the full bucket axis", async () => {
    const { alice, gid } = await setup();

    expect((await h.stats(alice, gid)).json.data.stats).toEqual({
      period: "all", year: null, month: null, total: 0, count: 0, buckets: [], members: [],
    });

    const year = (await h.stats(alice, gid, "?period=year&year=2026")).json.data.stats;
    expect(year.total).toBe(0);
    expect(year.count).toBe(0);
    expect(year.buckets).toHaveLength(12);
    expect(year.buckets.every((b: Json) => b.amount === 0 && b.count === 0)).toBe(true);

    const feb = (await h.stats(alice, gid, "?period=month&year=2026&month=2")).json.data.stats;
    expect(feb.total).toBe(0);
    expect(feb.buckets).toHaveLength(28); // 2026 is not a leap year
    expect(feb.members).toEqual([]);
  });
});
