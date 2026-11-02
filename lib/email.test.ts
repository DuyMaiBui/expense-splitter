import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_FROM, readEmailEnv } from "./env";
import { NoOpEmailSender, ResendEmailSender, getEmailSender, getEmailSenderDetails } from "./email";

/**
 * The provider seam: which sender `getEmailSender` resolves, and what each sender puts on the
 * wire. The Resend sender is exercised against a recorded `fetch`, so no network is involved.
 */

describe("getEmailSenderDetails", () => {
  it("returns a NoOp sender when nothing is configured", async () => {
    const { sender, provider } = getEmailSenderDetails({});
    expect(provider).toBeNull();
    expect(sender).toBeInstanceOf(NoOpEmailSender);
    await expect(sender.send({ to: "a@b.com", subject: "s", text: "t" })).resolves.toBeUndefined();
  });

  it("warns once and delivers nothing with the NoOp sender", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sender = new NoOpEmailSender();

    await sender.send({ to: "a@b.com", subject: "s", text: "t" });
    await sender.send({ to: "a@b.com", subject: "s", text: "t" });

    expect(warn).toHaveBeenCalledTimes(1);
    // The warning names the one variable an operator has to set.
    expect(String(warn.mock.calls[0]![0])).toContain("RESEND_API_KEY");
    warn.mockRestore();
  });

  it("treats a blank key as unconfigured (never a half-built sender)", () => {
    expect(getEmailSenderDetails({ RESEND_API_KEY: "" }).provider).toBeNull();
    expect(getEmailSenderDetails({ RESEND_API_KEY: "   " }).provider).toBeNull();
  });

  it("resolves Resend when the key is present", () => {
    const { sender, provider } = getEmailSenderDetails({
      RESEND_API_KEY: "re_123",
      RESEND_FROM: "App <no-reply@app.test>",
    });
    expect(provider).toBe("resend");
    expect(sender).toBeInstanceOf(ResendEmailSender);
  });

  it("getEmailSender is the details call without the provider name", () => {
    expect(getEmailSender({})).toBeInstanceOf(NoOpEmailSender);
  });
});

describe("readEmailEnv", () => {
  const saved = { ...process.env };
  const NAMES = ["RESEND_API_KEY", "RESEND_FROM"];

  afterEach(() => {
    for (const name of NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it("resolves nothing when no binding is set", () => {
    for (const name of NAMES) delete process.env[name];
    expect(readEmailEnv()).toEqual({ RESEND_API_KEY: undefined, RESEND_FROM: undefined });
  });

  it("reads RESEND_API_KEY from the environment (.env locally, Worker secret in production)", () => {
    process.env.RESEND_API_KEY = "re_abc";

    expect(readEmailEnv()).toEqual({ RESEND_API_KEY: "re_abc", RESEND_FROM: undefined });
    expect(getEmailSenderDetails(readEmailEnv()).provider).toBe("resend");
  });

  it("ignores a blank value instead of building a sender from it", () => {
    process.env.RESEND_API_KEY = "   ";

    expect(getEmailSenderDetails(readEmailEnv()).provider).toBeNull();
  });
});

describe("ResendEmailSender", () => {
  function recordingFetch(response: Response, calls: Array<{ url: string; init: RequestInit }>) {
    return (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response;
    }) as typeof fetch;
  }

  it("POSTs the documented Resend payload with the bearer token", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const sender = new ResendEmailSender(
      "re_secret",
      "Chia tiền <no-reply@app.test>",
      recordingFetch(new Response("{}", { status: 200 }), calls),
    );

    await sender.send({ to: "user@example.com", subject: "Mã đặt lại", text: "123456" });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect(calls[0]!.init.method).toBe("POST");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_secret");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      from: "Chia tiền <no-reply@app.test>",
      to: ["user@example.com"],
      subject: "Mã đặt lại",
      text: "123456",
    });
  });

  it("falls back to the documented sender when RESEND_FROM is not set", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const sender = new ResendEmailSender(
      "re_secret",
      undefined,
      recordingFetch(new Response("{}", { status: 200 }), calls),
    );

    await sender.send({ to: "user@example.com", subject: "s", text: "t" });

    expect(JSON.parse(String(calls[0]!.init.body)).from).toBe(DEFAULT_FROM);
  });

  it("throws (does not silently swallow) when Resend refuses the message", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const sender = new ResendEmailSender(
      "re_secret",
      "App <no-reply@app.test>",
      recordingFetch(new Response("invalid_api_key", { status: 401 }), calls),
    );

    await expect(sender.send({ to: "user@example.com", subject: "s", text: "t" })).rejects.toThrow(
      /HTTP 401/,
    );
  });
});
