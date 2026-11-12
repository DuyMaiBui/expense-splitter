import { describe, expect, it } from "vitest";

import type { PairStatement, Transfer } from "@/lib/types";

import {
  AFTER_PAYMENT_BADGE,
  balanceSentence,
  isQuietStatement,
  netSentence,
  paymentWarning,
  revisionSentence,
  transferExplanation,
} from "./pair-text";

function statement(name: string, net: number, extra: Partial<PairStatement> = {}): PairStatement {
  return {
    counterpartyMemberId: `m-${name}`,
    counterpartyName: name,
    removed: false,
    net,
    events: [],
    removedRevisions: [],
    ...extra,
  };
}

describe("netSentence", () => {
  it("says the counterparty owes the viewer when net is positive", () => {
    expect(netSentence("An", 120000)).toBe("An nợ bạn 120.000đ");
  });

  it("says the viewer owes the counterparty when net is negative", () => {
    expect(netSentence("An", -120000)).toBe("Bạn nợ An 120.000đ");
  });

  it("says they are even when net is zero", () => {
    expect(netSentence("An", 0)).toBe("Đã huề với An");
  });
});

describe("balanceSentence", () => {
  it("explains an empty pair list in plain words", () => {
    expect(balanceSentence([])).toBe("Bạn chưa có khoản chi nào liên quan đến ai.");
  });

  it("says the viewer is even with everyone when all nets are zero", () => {
    expect(balanceSentence([statement("An", 0)])).toBe("Bạn đã huề với mọi người.");
  });

  it("names the largest debtor first when the viewer is owed", () => {
    const text = balanceSentence([statement("Bình", 20000), statement("An", 150000)]);
    expect(text).toBe(
      "Bạn đang được nhận 170.000đ, chủ yếu vì An nợ bạn 150.000đ và Bình nợ bạn 20.000đ.",
    );
  });

  it("counts the rest after two names", () => {
    const text = balanceSentence([
      statement("An", 150000),
      statement("Bình", 20000),
      statement("Chi", 5000),
    ]);
    expect(text).toBe(
      "Bạn đang được nhận 175.000đ, chủ yếu vì An nợ bạn 150.000đ, Bình nợ bạn 20.000đ và 1 người khác.",
    );
  });

  it("adds the opposite side after 'Ngược lại' when the viewer is owed overall", () => {
    const text = balanceSentence([statement("An", 150000), statement("Dũng", -30000)]);
    expect(text).toBe(
      "Bạn đang được nhận 120.000đ, chủ yếu vì An nợ bạn 150.000đ. Ngược lại, bạn nợ Dũng 30.000đ.",
    );
  });

  it("says the viewer must pay when the total is negative", () => {
    expect(balanceSentence([statement("Dũng", -30000)])).toBe(
      "Bạn còn phải trả 30.000đ, chủ yếu vì bạn nợ Dũng 30.000đ.",
    );
  });

  it("says the totals match when received equals paid", () => {
    const text = balanceSentence([statement("An", 50000), statement("Dũng", -50000)]);
    expect(text).toBe("Bạn đã huề với mọi người, tổng được nhận bằng tổng phải trả.");
  });
});

describe("isQuietStatement", () => {
  it("is true for a net-zero counterparty with nothing to explain", () => {
    expect(isQuietStatement(statement("An", 0))).toBe(true);
  });

  it("is false when a removed revision is attached", () => {
    const withRemoved = statement("An", 0, {
      removedRevisions: [
        {
          expenseId: "e1",
          title: "Taxi",
          at: "2026-10-15T08:30:00.000Z",
          actorName: "Hưng",
          action: "delete",
          beforeAmount: 100000,
          afterAmount: null,
          beforeMemberShare: 50000,
          afterMemberShare: null,
          beforeCounterpartyShare: 50000,
          afterCounterpartyShare: null,
          afterLaterPayment: false,
        },
      ],
    });
    expect(isQuietStatement(withRemoved)).toBe(false);
  });

  it("is false when the net is not zero", () => {
    expect(isQuietStatement(statement("An", 1))).toBe(false);
  });
});

describe("paymentWarning", () => {
  it("returns the warning badge when the edit came after a payment", () => {
    expect(paymentWarning(true)).toBe(AFTER_PAYMENT_BADGE);
    expect(paymentWarning(true)).toBe("Sửa sau khi đã thanh toán");
  });

  it("returns null when the edit came before any payment", () => {
    expect(paymentWarning(false)).toBeNull();
  });
});

describe("revisionSentence", () => {
  it("states the update with before and after amounts and the viewer's share", () => {
    const text = revisionSentence({
      at: "2026-10-15T08:30:00.000Z",
      actorName: "Hưng",
      action: "update",
      beforeAmount: 120000,
      afterAmount: 90000,
      beforeMemberShare: 60000,
      afterMemberShare: 45000,
    });
    expect(text).toBe(
      "Sửa lúc 15/10/2026 15:30 bởi Hưng: 120.000đ -> 90.000đ, phần của bạn 60.000đ -> 45.000đ",
    );
  });

  it("states a delete with the after side marked as removed", () => {
    const text = revisionSentence({
      at: "2026-10-15T08:30:00.000Z",
      actorName: "Hưng",
      action: "delete",
      beforeAmount: 120000,
      afterAmount: null,
      beforeMemberShare: 60000,
      afterMemberShare: null,
    });
    expect(text).toBe(
      "Xóa lúc 15/10/2026 15:30 bởi Hưng: 120.000đ -> đã xóa, phần của bạn 60.000đ -> đã xóa",
    );
  });
});

describe("transferExplanation", () => {
  const direct: Transfer = {
    fromMemberId: "dung",
    toMemberId: "an",
    amount: 80000,
    basis: "direct",
    directDebt: 80000,
  };

  it("explains a direct transfer as paying the person who spent", () => {
    expect(transferExplanation(direct, "Dũng", "An")).toEqual({
      badge: "Trả đúng người đã chi",
      sentence: "An đã chi cho Dũng. Nợ trực tiếp 80.000đ.",
    });
  });

  it("explains an offset with no direct debt", () => {
    const offset: Transfer = { ...direct, basis: "offset", directDebt: 0 };
    expect(transferExplanation(offset, "Dũng", "An")).toEqual({
      badge: "Bù trừ",
      sentence:
        "Dũng không nợ trực tiếp An số này. Phần còn lại sau khi đã trả đúng người chi, chuyển cho An để cả nhóm về 0.",
    });
  });

  it("says the offset is only the part beyond a direct debt", () => {
    const offset: Transfer = { ...direct, basis: "offset", directDebt: 50000 };
    expect(transferExplanation(offset, "Dũng", "An").sentence).toBe(
      "Dũng không nợ trực tiếp An số này. Phần còn lại sau khi đã trả đúng người chi, chuyển cho An để cả nhóm về 0. Phần bù chỉ là phần vượt quá khoản nợ trực tiếp 50.000đ.",
    );
  });
});
