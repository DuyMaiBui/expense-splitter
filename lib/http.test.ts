import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, badRequest, conflict, forbidden, notFound, unauthorized } from "./errors";
import { errorResponse, ok, readJson, route } from "./http";

const ctx = { params: Promise.resolve({}) };
const req = (body?: string) =>
  new Request("http://localhost/x", { method: "POST", body, headers: { "content-type": "application/json" } });

afterEach(() => vi.restoreAllMocks());

describe("errors", () => {
  it("map each helper to the contract's code and HTTP status", () => {
    const cases: Array<[ApiError, string, number]> = [
      [unauthorized(), "UNAUTHORIZED", 401],
      [forbidden(), "FORBIDDEN", 403],
      [notFound(), "NOT_FOUND", 404],
      [badRequest(), "VALIDATION", 400],
      [conflict(), "CONFLICT", 409],
    ];
    for (const [error, code, status] of cases) {
      expect(error).toBeInstanceOf(ApiError);
      expect([error.code, error.status]).toEqual([code, status]);
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it("carry a custom message through", () => {
    expect(notFound("Không tìm thấy nhóm.").message).toBe("Không tìm thấy nhóm.");
  });
});

describe("ok / errorResponse", () => {
  it("wrap data in the success envelope with 200 by default and 201 on create", async () => {
    const res = ok({ a: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { a: 1 } });
    expect(ok({}, 201).status).toBe(201);
  });

  it("build the error envelope", async () => {
    const res = errorResponse(conflict("trùng"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: { code: "CONFLICT", message: "trùng" } });
  });
});

describe("route", () => {
  it("passes a handler's response through", async () => {
    const res = await route(async () => ok({ hi: true }))(req(), ctx);
    expect(await res.json()).toEqual({ ok: true, data: { hi: true } });
  });

  it("turns a thrown ApiError into its envelope and status", async () => {
    const res = await route(async () => {
      throw forbidden("Không có quyền.");
    })(req(), ctx);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: "Không có quyền." },
    });
  });

  it("hides unexpected errors behind a generic INTERNAL 500 and logs them", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await route(async () => {
      throw new Error("SQLITE_ERROR: secret table name");
    })(req(), ctx);

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(body)).not.toContain("SQLITE_ERROR");
    expect(spy).toHaveBeenCalled();
  });
});

describe("readJson", () => {
  it("parses and validates a body", async () => {
    const value = await readJson(req('{"n":2}'), (raw) => (raw as { n: number }).n * 2);
    expect(value).toBe(4);
  });

  it("rejects malformed JSON as VALIDATION", async () => {
    await expect(readJson(req("{not json"), (raw) => raw)).rejects.toMatchObject({
      code: "VALIDATION",
      status: 400,
    });
  });

  it("lets the parser's own error through", async () => {
    await expect(
      readJson(req("{}"), () => {
        throw badRequest("thiếu trường");
      }),
    ).rejects.toMatchObject({ code: "VALIDATION", message: "thiếu trường" });
  });
});
