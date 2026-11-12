import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Balance, Transfer } from "@/lib/types";

import { MemberStatsView } from "./MemberStatsTable";
import {
  plainVnd,
  signedPlain,
  standingOf,
  statRowsOf,
  statTotalsOf,
  transferLinesFor,
  transferSummary,
} from "./settle-table";

/** A balance whose paid/owed/net are derived the way the server derives them. */
function balance(
  memberId: string,
  name: string,
  spentPaid: number,
  spentOwed: number,
  paymentsOut = 0,
  paymentsIn = 0,
  removed = false,
): Balance {
  const paid = spentPaid + paymentsOut;
  const owed = spentOwed + paymentsIn;
  return {
    memberId,
    name,
    removed,
    paid,
    owed,
    net: paid - owed,
    spentPaid,
    spentOwed,
    paymentsOut,
    paymentsIn,
  };
}

/**
 * A group of five. Total spending is 150.000 (An 120.000 + Dung 30.000 paid; 150.000 owed in shares).
 *   An    (A) paid 120.000, owed  40.000 → net +80.000 (owed)
 *   Bình  (B) paid   0,      owed  60.000 → net −60.000 (owes)
 *   Cường (C) paid   0,      owed  40.000 → net −40.000 (owes)
 *   Dung  (D) paid  30.000,  owed  10.000 → net +20.000 (owed)
 *   Em    (E) no activity at all
 * Transfers settle the debts: Bình → An 60.000, Cường → An 20.000, Cường → Dung 20.000.
 */
const balances: Balance[] = [
  balance("a", "An", 120_000, 40_000),
  balance("b", "Bình", 0, 60_000),
  balance("c", "Cường", 0, 40_000),
  balance("d", "Dung", 30_000, 10_000),
  balance("e", "Em", 0, 0),
];

const transfers: Transfer[] = [
  { fromMemberId: "b", toMemberId: "a", amount: 60_000 },
  { fromMemberId: "c", toMemberId: "a", amount: 20_000 },
  { fromMemberId: "c", toMemberId: "d", amount: 20_000 },
];

const TOTAL_SPENT = 150_000;

describe("plainVnd and signedPlain", () => {
  it("groups thousands with dots and drops the đ suffix", () => {
    expect(plainVnd(47_814)).toBe("47.814");
    expect(plainVnd(0)).toBe("0");
    expect(plainVnd(1_200_000)).toBe("1.200.000");
  });

  it("signs a change with + or the true minus, and shows zero unsigned", () => {
    expect(signedPlain(84_000)).toBe("+84.000");
    expect(signedPlain(-47_814)).toBe("−47.814");
    expect(signedPlain(0)).toBe("0");
  });
});

describe("standingOf", () => {
  it("reads the sign of the net position", () => {
    expect(standingOf(10)).toBe("owed");
    expect(standingOf(-10)).toBe("owes");
    expect(standingOf(0)).toBe("even");
  });
});

describe("transferLinesFor", () => {
  const nameOf = (id: string) => ({ a: "An", b: "Bình", c: "Cường", d: "Dung" })[id] ?? "?";

  it("lists every transfer a debtor must send, with the receiver's name", () => {
    expect(transferLinesFor("c", transfers, nameOf)).toEqual([
      { direction: "pay", counterpartyId: "a", counterpartyName: "An", amount: 20_000 },
      { direction: "pay", counterpartyId: "d", counterpartyName: "Dung", amount: 20_000 },
    ]);
  });

  it("lists every transfer a creditor receives, with the payer's name", () => {
    expect(transferLinesFor("a", transfers, nameOf)).toEqual([
      { direction: "receive", counterpartyId: "b", counterpartyName: "Bình", amount: 60_000 },
      { direction: "receive", counterpartyId: "c", counterpartyName: "Cường", amount: 20_000 },
    ]);
  });

  it("is empty for a member no transfer touches", () => {
    expect(transferLinesFor("e", transfers, nameOf)).toEqual([]);
  });
});

describe("transferSummary", () => {
  it("writes a debtor's payments as 'trả … · trả …' with plain amounts", () => {
    const rows = statRowsOf(balances, transfers);
    const cuong = rows.find((r) => r.memberId === "c");
    expect(cuong && transferSummary(cuong.lines)).toBe("trả An 20.000 · trả Dung 20.000");
  });

  it("writes a creditor's receipts as 'nhận từ …' with plain amounts", () => {
    const rows = statRowsOf(balances, transfers);
    const an = rows.find((r) => r.memberId === "a");
    expect(an && transferSummary(an.lines)).toBe("nhận từ Bình 60.000 · nhận từ Cường 20.000");
  });

  it("is an empty string for a member with no transfers", () => {
    const rows = statRowsOf(balances, transfers);
    const em = rows.find((r) => r.memberId === "e");
    expect(em && transferSummary(em.lines)).toBe("");
  });
});

describe("statRowsOf", () => {
  const rows = statRowsOf(balances, transfers);

  it("keeps one row per balance, in server order", () => {
    expect(rows.map((r) => r.name)).toEqual(["An", "Bình", "Cường", "Dung", "Em"]);
  });

  it("copies the four split figures and the net from the balance", () => {
    const binh = rows.find((r) => r.memberId === "b");
    expect(binh).toMatchObject({
      standing: "owes",
      net: -60_000,
      spentPaid: 0,
      spentOwed: 60_000,
      paymentsOut: 0,
      paymentsIn: 0,
    });
  });

  it("gives a member with no activity zeros, a settled standing and no lines", () => {
    expect(rows.find((r) => r.memberId === "e")).toMatchObject({
      standing: "even",
      net: 0,
      spentPaid: 0,
      spentOwed: 0,
      lines: [],
    });
  });

  it("keeps a removed member's row with the removed flag set", () => {
    const withRemoved = statRowsOf(
      [...balances, balance("f", "Gia", 0, 0, 0, 0, true)],
      transfers,
    );
    expect(withRemoved.find((r) => r.memberId === "f")?.removed).toBe(true);
  });
});

describe("statTotalsOf", () => {
  const totals = statTotalsOf(balances);

  it("sums spending paid to the group total", () => {
    expect(totals.spentPaid).toBe(TOTAL_SPENT);
  });

  it("sums shares owed to the same group total", () => {
    expect(totals.spentOwed).toBe(TOTAL_SPENT);
  });

  it("nets to zero across the group", () => {
    expect(totals.net).toBe(0);
  });

  it("has equal payments out and in", () => {
    expect(totals.paymentsOut).toBe(totals.paymentsIn);
  });
});

describe("MemberStatsView server render", () => {
  const render = (readOnly: boolean) =>
    renderToStaticMarkup(
      createElement(MemberStatsView, { balances, transfers, readOnly, onOpen: () => {} }),
    );

  it("renders a debtor row with its signed balance and its own 'trả' lines", () => {
    const html = render(false);
    expect(html).toContain("−40.000");
    expect(html).toContain("còn phải trả");
    expect(html).toContain("trả An 20.000 · trả Dung 20.000");
  });

  it("renders a creditor row with its signed balance and its 'nhận từ' lines", () => {
    const html = render(false);
    expect(html).toContain("+80.000");
    expect(html).toContain("nhận lại");
    expect(html).toContain("nhận từ Bình 60.000 · nhận từ Cường 20.000");
  });

  it("renders the totals row with the group sums and no payment control in readOnly", () => {
    const readOnlyHtml = render(true);
    expect(readOnlyHtml).toContain("Cả nhóm");
    expect(readOnlyHtml).toContain("150.000");
    expect(readOnlyHtml).toContain('data-readonly="true"');
    expect(readOnlyHtml).not.toContain("Thanh toán");
  });

  it("renders one detail button per member, and no payment control in either mode", () => {
    const html = render(false);
    const detailButtons = html.match(/aria-label="Chi tiết [^"]+"/g) ?? [];
    expect(detailButtons).toHaveLength(balances.length);
    expect(html).not.toContain("Thanh toán");
    expect(html).not.toContain("Vì sao");
    expect(html).not.toContain("Đối chiếu");
  });
});
