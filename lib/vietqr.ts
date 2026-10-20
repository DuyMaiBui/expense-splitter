import { badRequest } from "./errors";
import type { BankInfo } from "./types";
import { int, obj, str } from "./validate";

/**
 * VietQR helpers. The QR itself is an ordinary public image URL from img.vietqr.io, so this
 * module is import-safe on the server (routes) and in the browser (settle page): no node,
 * Workers-only or network API is touched. docs/CONTRACT.md is the authoritative spec.
 */

/** One receiving bank: its NAPAS BIN (the first segment of the image URL) and names for the UI. */
export interface BankEntry {
  /** 6-digit NAPAS BIN. */
  bin: string;
  /** Common ASCII code, e.g. "VCB". */
  code: string;
  /** Short display name, e.g. "Vietcombank". */
  shortName: string;
  /** Full Vietnamese name. */
  name: string;
  /**
   * The bank's code in VietQR's OWN bank list (`GET https://api.vietqr.io/v2/banks`), which is
   * what names its logo file. It differs from `code` for several banks (VietinBank is "ICB",
   * Sacombank is "SACOMBANK"), so it is stored per BIN rather than derived. Static data on
   * purpose: the app never calls the bank API at runtime. Absent when VietQR has no working
   * logo for the bank, in which case the UI falls back to a plain icon.
   */
  logoCode?: string;
}

/**
 * Mainstream Vietnamese banks. Only BINs we can vouch for are listed: an unknown BIN is not
 * rejected by `parseBankInfo` (the field is validated as 6 digits), the picker is just narrower.
 * Ordered A-Z by `name`; the picker sorts its own display order from this list.
 *
 * Every `logoCode` below was read from VietQR's bank list and its logo URL verified with an
 * HTTP GET returning 200 image/png (2026-10-20); all 42 banks have a working logo.
 */
export const VIETQR_BANKS: readonly BankEntry[] = [
  { bin: "970425", code: "ABB", shortName: "ABBANK", name: "Ngân hàng An Bình", logoCode: "ABB" },
  { bin: "970409", code: "BAB", shortName: "Bac A Bank", name: "Ngân hàng Bắc Á", logoCode: "BAB" },
  { bin: "970438", code: "BVB", shortName: "BaoViet Bank", name: "Ngân hàng Bảo Việt", logoCode: "BVB" },
  { bin: "970418", code: "BIDV", shortName: "BIDV", name: "Ngân hàng Đầu tư và Phát triển Việt Nam", logoCode: "BIDV" },
  { bin: "970454", code: "BVB", shortName: "BVBank", name: "Ngân hàng Bản Việt", logoCode: "VCCB" },
  { bin: "546034", code: "CAKE", shortName: "Cake", name: "Cake by VPBank", logoCode: "CAKE" },
  { bin: "970444", code: "CBB", shortName: "CBBank", name: "Ngân hàng Xây dựng Việt Nam", logoCode: "VCBNeo" },
  { bin: "970446", code: "COOP", shortName: "Co-opBank", name: "Ngân hàng Hợp tác xã Việt Nam", logoCode: "COOPBANK" },
  { bin: "970406", code: "DAB", shortName: "DongA Bank", name: "Ngân hàng Đông Á", logoCode: "DOB" },
  { bin: "970431", code: "EIB", shortName: "Eximbank", name: "Ngân hàng Xuất nhập khẩu Việt Nam", logoCode: "EIB" },
  { bin: "970408", code: "GPB", shortName: "GPBank", name: "Ngân hàng Dầu khí Toàn cầu", logoCode: "GPB" },
  { bin: "970437", code: "HDB", shortName: "HDBank", name: "Ngân hàng Phát triển TP.HCM", logoCode: "HDB" },
  { bin: "970434", code: "IVB", shortName: "Indovina Bank", name: "Ngân hàng Indovina", logoCode: "IVB" },
  { bin: "970452", code: "KLB", shortName: "KienlongBank", name: "Ngân hàng Kiên Long", logoCode: "KLB" },
  { bin: "970449", code: "LPB", shortName: "LPBank", name: "Ngân hàng Lộc Phát Việt Nam", logoCode: "LPBANK" },
  { bin: "970422", code: "MBB", shortName: "MB Bank", name: "Ngân hàng Quân đội", logoCode: "MB" },
  { bin: "970426", code: "MSB", shortName: "MSB", name: "Ngân hàng Hàng hải Việt Nam", logoCode: "MSB" },
  { bin: "970428", code: "NAB", shortName: "Nam A Bank", name: "Ngân hàng Nam Á", logoCode: "NAB" },
  { bin: "970419", code: "NCB", shortName: "NCB", name: "Ngân hàng Quốc dân", logoCode: "NCB" },
  { bin: "970448", code: "OCB", shortName: "OCB", name: "Ngân hàng Phương Đông", logoCode: "OCB" },
  { bin: "970414", code: "OJB", shortName: "Oceanbank", name: "Ngân hàng Đại Dương", logoCode: "MBV" },
  { bin: "970430", code: "PGB", shortName: "PGBank", name: "Ngân hàng Xăng dầu Petrolimex", logoCode: "PGB" },
  { bin: "970412", code: "PVC", shortName: "PVcomBank", name: "Ngân hàng Đại chúng Việt Nam", logoCode: "PVCB" },
  { bin: "970403", code: "STB", shortName: "Sacombank", name: "Ngân hàng Sài Gòn Thương Tín", logoCode: "SACOMBANK" },
  { bin: "970400", code: "SGB", shortName: "Saigonbank", name: "Ngân hàng Sài Gòn Công thương", logoCode: "SGICB" },
  { bin: "970429", code: "SCB", shortName: "SCB", name: "Ngân hàng Sài Gòn", logoCode: "SCB" },
  { bin: "970440", code: "SEAB", shortName: "SeABank", name: "Ngân hàng Đông Nam Á", logoCode: "SEAB" },
  { bin: "970443", code: "SHB", shortName: "SHB", name: "Ngân hàng Sài Gòn - Hà Nội", logoCode: "SHB" },
  { bin: "970424", code: "SVB", shortName: "Shinhan Bank", name: "Ngân hàng Shinhan Việt Nam", logoCode: "SHBVN" },
  { bin: "970410", code: "SCB", shortName: "Standard Chartered", name: "Ngân hàng Standard Chartered Việt Nam", logoCode: "SCVN" },
  { bin: "970407", code: "TCB", shortName: "Techcombank", name: "Ngân hàng Kỹ thương Việt Nam", logoCode: "TCB" },
  { bin: "963388", code: "TIMO", shortName: "Timo", name: "Timo by BVBank", logoCode: "TIMO" },
  { bin: "970423", code: "TPB", shortName: "TPBank", name: "Ngân hàng Tiên Phong", logoCode: "TPB" },
  { bin: "970415", code: "ICB", shortName: "VietinBank", name: "Ngân hàng Công thương Việt Nam", logoCode: "ICB" },
  { bin: "970436", code: "VCB", shortName: "Vietcombank", name: "Ngân hàng Ngoại thương Việt Nam", logoCode: "VCB" },
  { bin: "970433", code: "VBB", shortName: "VietBank", name: "Ngân hàng Việt Nam Thương Tín", logoCode: "VIETBANK" },
  { bin: "970441", code: "VIB", shortName: "VIB", name: "Ngân hàng Quốc tế Việt Nam", logoCode: "VIB" },
  { bin: "970432", code: "VPB", shortName: "VPBank", name: "Ngân hàng Việt Nam Thịnh Vượng", logoCode: "VPB" },
  { bin: "970421", code: "VRB", shortName: "VRB", name: "Ngân hàng Liên doanh Việt - Nga", logoCode: "VRB" },
  { bin: "970405", code: "VBA", shortName: "Agribank", name: "Ngân hàng Nông nghiệp và Phát triển Nông thôn", logoCode: "VBA" },
  { bin: "970457", code: "WOO", shortName: "Woori Bank", name: "Ngân hàng Woori Việt Nam", logoCode: "WVN" },
  { bin: "970416", code: "ACB", shortName: "ACB", name: "Ngân hàng Á Châu", logoCode: "ACB" },
];

/**
 * The banks the picker lists first, in the order it shows them: the twelve most people in
 * Vietnam actually use, most-used first. BINs only, so the entries stay the single source.
 */
export const POPULAR_BANK_BINS: readonly string[] = [
  "970436", // Vietcombank
  "970415", // VietinBank
  "970418", // BIDV
  "970405", // Agribank
  "970407", // Techcombank
  "970422", // MB Bank
  "970416", // ACB
  "970432", // VPBank
  "970423", // TPBank
  "970403", // Sacombank
  "970437", // HDBank
  "970441", // VIB
];

/** VietQR's logo host. The file name is the bank's VietQR `logoCode`, not our `code`. */
const LOGO_BASE_URL = "https://cdn.vietqr.io/img/";

/** The public logo URL for a bank, or null when VietQR has no working logo for it. */
export function bankLogoUrl(entry: BankEntry): string | null {
  return entry.logoCode ? `${LOGO_BASE_URL}${encodeURIComponent(entry.logoCode)}.png` : null;
}

/** The popular banks, in the picker's display order; a BIN missing from the list is skipped. */
export function popularBanks(): BankEntry[] {
  return POPULAR_BANK_BINS.map((bin) => bankByBin(bin)).filter((bank): bank is BankEntry => bank !== undefined);
}

/** Every bank, A-Z by short name: the picker's "Tất cả" section and the search's base order. */
export function banksByShortName(): BankEntry[] {
  return [...VIETQR_BANKS].sort((a, b) =>
    a.shortName.localeCompare(b.shortName, "en", { sensitivity: "base" }),
  );
}

const BIN_DIGITS = /^[0-9]{6}$/;
const ACCOUNT_DIGITS = /^[0-9]{6,19}$/;

/** The bank entry for a NAPAS BIN, or undefined when the BIN is not in our list. */
export function bankByBin(bin: string): BankEntry | undefined {
  return VIETQR_BANKS.find((bank) => bank.bin === bin);
}

/**
 * Validates a `BankInfo` body value. A partial or malformed account is a 400, never a silent
 * half-stored account: the DB keeps all three columns set or all three null.
 */
export function parseBankInfo(raw: unknown): BankInfo {
  const body = obj(raw, "bank");

  const bin = str(body.bin, "bank.bin", { min: 6, max: 6 });
  if (!BIN_DIGITS.test(bin)) {
    throw badRequest('Trường "bank.bin" phải là 6 chữ số (mã BIN ngân hàng).');
  }

  const accountNo = str(body.accountNo, "bank.accountNo", { min: 6, max: 19 });
  if (!ACCOUNT_DIGITS.test(accountNo)) {
    throw badRequest('Trường "bank.accountNo" chỉ được chứa chữ số, từ 6 đến 19 ký tự.');
  }

  const accountName = str(body.accountName, "bank.accountName", { min: 1, max: 50 });

  return { bin, accountNo, accountName };
}

export interface VietQrUrlInput {
  bin: string;
  accountNo: string;
  accountName: string;
  /** Integer VND, the exact amount the payer scans for. */
  amount: number;
  /** Transfer note; callers pass `sanitizeTransferNote(...)` so banks that drop diacritics still match. */
  addInfo: string;
}

/**
 * The public VietQR image URL (compact2 template, no API key, no server call by us).
 * Every variable segment is URI-encoded, so a note with spaces or accents cannot break the URL.
 */
export function buildVietQrUrl(input: VietQrUrlInput): string {
  const amount = int(input.amount, "amount", { min: 1, max: 1_000_000_000_000 });
  const bin = encodeURIComponent(input.bin);
  const accountNo = encodeURIComponent(input.accountNo);
  const addInfo = encodeURIComponent(input.addInfo);
  const accountName = encodeURIComponent(input.accountName);

  return `https://img.vietqr.io/image/${bin}-${accountNo}-compact2.png?amount=${amount}&addInfo=${addInfo}&accountName=${accountName}`;
}

const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Vietnamese text with every diacritic removed, đ/Đ included (NFD does not decompose those two),
 * keeping the rest of the string as it is. One helper for every accent-insensitive comparison —
 * the transfer note and the bank search must agree on what "a" matches.
 */
export function stripDiacritics(text: string): string {
  return text
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/[đĐ]/g, (char) => (char === "đ" ? "d" : "D"));
}

/** Lower-cased, diacritic-free, single-spaced: the form every search comparison runs on. */
function foldForSearch(text: string): string {
  return stripDiacritics(text).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Whether a bank matches a search query: case- and diacritic-insensitive, over the short name,
 * the full name, the ASCII code and the BIN. An empty query matches everything, and so does a
 * query of only spaces, so the picker can call this without special-casing.
 */
export function matchBank(entry: BankEntry, query: string): boolean {
  const needle = foldForSearch(query);
  if (needle === "") {
    return true;
  }
  const haystacks = [entry.shortName, entry.name, entry.code, entry.bin].map(foldForSearch);
  return haystacks.some((haystack) => haystack.includes(needle));
}

/**
 * The banks matching a query, in "Tất cả" order (A-Z by short name). An empty query returns the
 * whole list rather than nothing: the picker shows its sections when the search box is untouched.
 */
export function searchBanks(query: string): BankEntry[] {
  return banksByShortName().filter((entry) => matchBank(entry, query));
}

/** Longest transfer note a bank QR field takes well. */
export const TRANSFER_NOTE_MAX = 25;

/**
 * A bank-friendly transfer note: Vietnamese diacritics removed (including đ/Đ, which NFD does
 * not decompose), only [A-Za-z0-9 ] kept, whitespace collapsed and trimmed, capped at
 * `TRANSFER_NOTE_MAX` characters. Two calls with the same note always give the same string.
 */
export function sanitizeTransferNote(text: string): string {
  return stripDiacritics(text)
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TRANSFER_NOTE_MAX)
    .trim();
}
