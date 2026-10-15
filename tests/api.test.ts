import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "./helpers/d1";

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
import { GET as settlementGET } from "@/app/api/groups/[groupId]/settlement/route";
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

const MIGRATION = readFileSync(
  fileURLToPath(new URL("../migrations/0001_init.sql", import.meta.url)),
  "utf8",
);

beforeEach(() => {
  testDb = createTestDb(MIGRATION);
  activeJar = new Map();
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
  opts: { method?: string; path?: string; params?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; json: Json }> {
  activeJar = client.jar;
  const hasBody = opts.body !== undefined;
  const req = new Request(`http://localhost${opts.path ?? "/api/x"}`, {
    method: opts.method ?? "GET",
    headers: hasBody ? { "content-type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  return { status: res.status, json: await res.json() };
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
