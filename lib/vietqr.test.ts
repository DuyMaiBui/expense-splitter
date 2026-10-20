import { describe, expect, it } from "vitest";

import {
  bankByBin,
  bankLogoUrl,
  banksByShortName,
  buildVietQrUrl,
  matchBank,
  parseBankInfo,
  POPULAR_BANK_BINS,
  popularBanks,
  sanitizeTransferNote,
  searchBanks,
  stripDiacritics,
  TRANSFER_NOTE_MAX,
  VIETQR_BANKS,
} from "./vietqr";

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
};

const validBank = { bin: "970436", accountNo: "0123456789", accountName: "NGUYEN VAN A" };

describe("VIETQR_BANKS", () => {
  it("lists the mainstream banks with unique, well-formed BINs", () => {
    expect(VIETQR_BANKS.length).toBeGreaterThanOrEqual(30);

    const bins = VIETQR_BANKS.map((bank) => bank.bin);
    expect(new Set(bins).size).toBe(bins.length);
    for (const bin of bins) {
      expect(bin).toMatch(/^[0-9]{6}$/);
    }
  });

  it("gives every entry a code and both names", () => {
    for (const bank of VIETQR_BANKS) {
      expect(bank.code.trim()).not.toBe("");
      expect(bank.shortName.trim()).not.toBe("");
      expect(bank.name.trim()).not.toBe("");
    }
  });

  it("covers the banks named in the contract", () => {
    expect(bankByBin("970436")?.shortName).toBe("Vietcombank");
    expect(bankByBin("970415")?.shortName).toBe("VietinBank");
    expect(bankByBin("970418")?.shortName).toBe("BIDV");
    expect(bankByBin("970405")?.shortName).toBe("Agribank");
    expect(bankByBin("970407")?.shortName).toBe("Techcombank");
    expect(bankByBin("970422")?.shortName).toBe("MB Bank");
    expect(bankByBin("970416")?.shortName).toBe("ACB");
    expect(bankByBin("970432")?.shortName).toBe("VPBank");
  });

  it("returns undefined for a BIN outside the list", () => {
    expect(bankByBin("000000")).toBeUndefined();
    expect(bankByBin("")).toBeUndefined();
  });
});

describe("bank logos", () => {
  it("builds the CDN URL from the VietQR logo code, not our own code", () => {
    expect(bankLogoUrl(bankByBin("970415")!)).toBe("https://cdn.vietqr.io/img/ICB.png");
    expect(bankLogoUrl(bankByBin("970403")!)).toBe("https://cdn.vietqr.io/img/SACOMBANK.png");
    expect(bankLogoUrl(bankByBin("970454")!)).toBe("https://cdn.vietqr.io/img/VCCB.png");
    expect(bankLogoUrl(bankByBin("970444")!)).toBe("https://cdn.vietqr.io/img/VCBNeo.png");
    expect(bankLogoUrl(bankByBin("970406")!)).toBe("https://cdn.vietqr.io/img/DOB.png");
    expect(bankLogoUrl(bankByBin("970436")!)).toBe("https://cdn.vietqr.io/img/VCB.png");
  });

  it("gives every listed bank a logo code", () => {
    // Every URL below was GET-checked against cdn.vietqr.io (200 image/png) on 2026-10-20.
    for (const bank of VIETQR_BANKS) {
      expect(bank.logoCode, `${bank.shortName} has no logo code`).toBeTruthy();
    }
  });

  it("returns null instead of a broken URL when a bank has no logo", () => {
    expect(bankLogoUrl({ bin: "000000", code: "X", shortName: "X", name: "X" })).toBeNull();
  });
});

describe("POPULAR_BANK_BINS", () => {
  it("names only BINs that exist in the list, each once", () => {
    expect(POPULAR_BANK_BINS).toHaveLength(12);
    expect(new Set(POPULAR_BANK_BINS).size).toBe(POPULAR_BANK_BINS.length);
    for (const bin of POPULAR_BANK_BINS) {
      expect(VIETQR_BANKS.some((bank) => bank.bin === bin), `${bin} is not in VIETQR_BANKS`).toBe(true);
    }
  });

  it("covers the banks the task names as popular", () => {
    const shortNames = popularBanks().map((bank) => bank.shortName);
    expect(shortNames).toEqual([
      "Vietcombank",
      "VietinBank",
      "BIDV",
      "Agribank",
      "Techcombank",
      "MB Bank",
      "ACB",
      "VPBank",
      "TPBank",
      "Sacombank",
      "HDBank",
      "VIB",
    ]);
  });
});

describe("banksByShortName", () => {
  it("returns every bank, A-Z by short name", () => {
    const sorted = banksByShortName();
    expect(sorted).toHaveLength(VIETQR_BANKS.length);

    const names = sorted.map((bank) => bank.shortName.toLowerCase());
    expect(names).toEqual([...names].sort());
  });

  it("does not reorder the source list in place", () => {
    const before = VIETQR_BANKS.map((bank) => bank.bin);
    banksByShortName();
    expect(VIETQR_BANKS.map((bank) => bank.bin)).toEqual(before);
  });
});

describe("stripDiacritics", () => {
  it("removes Vietnamese diacritics and đ, keeping everything else", () => {
    expect(stripDiacritics("Ngân hàng Đầu tư")).toBe("Ngan hang Dau tu");
    expect(stripDiacritics("ĐỖ MINH")).toBe("DO MINH");
    expect(stripDiacritics("ACB")).toBe("ACB");
  });
});

describe("matchBank", () => {
  const vietcombank = bankByBin("970436")!;
  const mb = bankByBin("970422")!;

  it("matches an empty or blank query against every bank", () => {
    expect(matchBank(vietcombank, "")).toBe(true);
    expect(matchBank(vietcombank, "   ")).toBe(true);
  });

  it("matches the short name, case- and diacritic-insensitively", () => {
    expect(matchBank(vietcombank, "VIETCOMBANK")).toBe(true);
    expect(matchBank(vietcombank, "vietcom")).toBe(true);
    expect(matchBank(mb, "mb bank")).toBe(true);
    expect(matchBank(mb, "MB")).toBe(true);
  });

  it("matches the full name without diacritics", () => {
    expect(matchBank(mb, "ngan hang quan doi")).toBe(true);
    expect(matchBank(mb, "Ngân hàng Quân đội")).toBe(true);
    expect(matchBank(bankByBin("970406")!, "ngan hang dong a")).toBe(true);
  });

  it("matches the ASCII code and the BIN", () => {
    expect(matchBank(vietcombank, "vcb")).toBe(true);
    // VietinBank's code in this app is ICB: the search reads `code`, not the logo code.
    expect(matchBank(bankByBin("970415")!, "icb")).toBe(true);
    expect(matchBank(vietcombank, "970436")).toBe(true);
    expect(matchBank(vietcombank, "9704")).toBe(true);
  });

  it("does not match an unrelated query", () => {
    expect(matchBank(vietcombank, "techcombank")).toBe(false);
    expect(matchBank(vietcombank, "zzz")).toBe(false);
  });
});

describe("searchBanks", () => {
  it("returns the whole list for an empty query, A-Z", () => {
    const all = searchBanks("");
    expect(all).toHaveLength(VIETQR_BANKS.length);
    expect(all[0].shortName.localeCompare(all[1].shortName, "en", { sensitivity: "base" })).toBeLessThan(0);
  });

  it("narrows to the matching banks", () => {
    const hits = searchBanks("vietcombank");
    expect(hits).toHaveLength(1);
    expect(hits[0].bin).toBe("970436");
  });

  it("finds a bank by its full Vietnamese name typed without accents", () => {
    const hits = searchBanks("quan doi");
    expect(hits.map((bank) => bank.shortName)).toEqual(["MB Bank"]);
  });

  it("returns nothing when no bank matches", () => {
    expect(searchBanks("zzzz")).toEqual([]);
  });

  it("matches several banks on a shared code fragment", () => {
    const hits = searchBanks("9704");
    expect(hits.length).toBeGreaterThan(1);
    expect(hits.every((bank) => bank.bin.startsWith("9704"))).toBe(true);
  });
});

describe("parseBankInfo", () => {
  it("accepts a full account and trims the name", () => {
    expect(parseBankInfo({ ...validBank, accountName: "  NGUYEN VAN A  " })).toEqual(validBank);
  });

  it.each([
    ["non-object body", "970436"],
    ["missing bin", { ...validBank, bin: undefined }],
    ["short bin", { ...validBank, bin: "97043" }],
    ["long bin", { ...validBank, bin: "9704361" }],
    ["non-numeric bin", { ...validBank, bin: "97043X" }],
    ["missing account number", { ...validBank, accountNo: undefined }],
    ["5-digit account", { ...validBank, accountNo: "12345" }],
    ["20-digit account", { ...validBank, accountNo: "1".repeat(20) }],
    ["account with letters", { ...validBank, accountNo: "01234567a9" }],
    ["account with spaces", { ...validBank, accountNo: "0123 456789" }],
    ["empty name", { ...validBank, accountName: "   " }],
    ["name over 50 chars", { ...validBank, accountName: "A".repeat(51) }],
    ["non-string name", { ...validBank, accountName: 42 }],
  ])("rejects %s with VALIDATION", (_label, body) => {
    expect(codeOf(() => parseBankInfo(body))).toBe("VALIDATION");
  });
});

describe("buildVietQrUrl", () => {
  it("builds the documented img.vietqr.io URL", () => {
    expect(
      buildVietQrUrl({
        bin: "970436",
        accountNo: "0123456789",
        accountName: "NGUYEN VAN A",
        amount: 120000,
        addInfo: "Tra no An com trua",
      }),
    ).toBe(
      "https://img.vietqr.io/image/970436-0123456789-compact2.png" +
        "?amount=120000&addInfo=Tra%20no%20An%20com%20trua&accountName=NGUYEN%20VAN%20A",
    );
  });

  it("URI-encodes every variable segment", () => {
    const url = buildVietQrUrl({
      bin: "970436",
      accountNo: "0123456789",
      accountName: "Nguyễn Văn A",
      amount: 50000,
      addInfo: "Trả nợ & cà phê",
    });
    expect(url).toContain("addInfo=Tr%E1%BA%A3%20n%E1%BB%A3%20%26%20c%C3%A0%20ph%C3%AA");
    expect(url).toContain("accountName=Nguy%E1%BB%85n%20V%C4%83n%20A");
  });

  it.each([
    ["zero amount", 0],
    ["negative amount", -1],
    ["fractional amount", 12.5],
  ])("rejects a %s", (_label, amount) => {
    expect(
      codeOf(() =>
        buildVietQrUrl({ ...validBank, amount, addInfo: "x" }),
      ),
    ).toBe("VALIDATION");
  });
});

describe("sanitizeTransferNote", () => {
  it("strips Vietnamese diacritics, đ included", () => {
    expect(sanitizeTransferNote("Trả nợ Đạt")).toBe("Tra no Dat");
    expect(sanitizeTransferNote("Ăn trưa")).toBe("An trua");
    expect(sanitizeTransferNote("ĐỖ MINH")).toBe("DO MINH");
  });

  it("keeps only letters, digits and single spaces", () => {
    expect(sanitizeTransferNote("An  Ăn — 100k!!")).toBe("An An 100k");
    expect(sanitizeTransferNote("  a\tb\nc  ")).toBe("a b c");
    expect(sanitizeTransferNote("😀")).toBe("");
  });

  it("caps the note at 25 characters without a trailing space", () => {
    const long = sanitizeTransferNote("Tra no bua trua hom nay rat ngon");
    expect(long.length).toBe(TRANSFER_NOTE_MAX);
    expect(long).toBe("Tra no bua trua hom nay r");
    expect(long.endsWith(" ")).toBe(false);
  });

  it("is stable for repeated input", () => {
    const note = "Chuyển khoản cho Hưng";
    expect(sanitizeTransferNote(note)).toBe(sanitizeTransferNote(note));
  });
});
