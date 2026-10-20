import { describe, expect, it } from "vitest";

import {
  bankByBin,
  buildVietQrUrl,
  parseBankInfo,
  sanitizeTransferNote,
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
