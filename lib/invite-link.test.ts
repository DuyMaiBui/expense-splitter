import { describe, expect, it } from "vitest";

import { inviteUrl, safeNext } from "./invite-link";

describe("inviteUrl", () => {
  it("builds an /invite link carrying the encoded code", () => {
    expect(inviteUrl("https://x.test", "AB 12")).toBe("https://x.test/invite/AB%2012");
  });
});

describe("safeNext", () => {
  it("keeps a same-origin path with its query", () => {
    expect(safeNext("/invite/AB12")).toBe("/invite/AB12");
  });

  it.each([null, undefined, "", "groups", "//evil.com", "/\\evil.com", "https://evil.com"])(
    "rejects %s",
    (value) => {
      expect(safeNext(value)).toBeNull();
    },
  );
});
