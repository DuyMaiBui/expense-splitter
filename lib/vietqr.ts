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
}

/**
 * Mainstream Vietnamese banks. Only BINs we can vouch for are listed: an unknown BIN is not
 * rejected by `parseBankInfo` (the field is validated as 6 digits), the picker is just narrower.
 * Ordered A-Z by `name` so the picker reads naturally.
 */
export const VIETQR_BANKS: readonly BankEntry[] = [
  { bin: "970425", code: "ABB", shortName: "ABBANK", name: "Ngân hàng An Bình" },
  { bin: "970409", code: "BAB", shortName: "Bac A Bank", name: "Ngân hàng Bắc Á" },
  { bin: "970438", code: "BVB", shortName: "BaoViet Bank", name: "Ngân hàng Bảo Việt" },
  { bin: "970418", code: "BIDV", shortName: "BIDV", name: "Ngân hàng Đầu tư và Phát triển Việt Nam" },
  { bin: "970454", code: "BVB", shortName: "BVBank", name: "Ngân hàng Bản Việt" },
  { bin: "546034", code: "CAKE", shortName: "Cake", name: "Cake by VPBank" },
  { bin: "970444", code: "CBB", shortName: "CBBank", name: "Ngân hàng Xây dựng Việt Nam" },
  { bin: "970446", code: "COOP", shortName: "Co-opBank", name: "Ngân hàng Hợp tác xã Việt Nam" },
  { bin: "970406", code: "DAB", shortName: "DongA Bank", name: "Ngân hàng Đông Á" },
  { bin: "970431", code: "EIB", shortName: "Eximbank", name: "Ngân hàng Xuất nhập khẩu Việt Nam" },
  { bin: "970408", code: "GPB", shortName: "GPBank", name: "Ngân hàng Dầu khí Toàn cầu" },
  { bin: "970437", code: "HDB", shortName: "HDBank", name: "Ngân hàng Phát triển TP.HCM" },
  { bin: "970434", code: "IVB", shortName: "Indovina Bank", name: "Ngân hàng Indovina" },
  { bin: "970452", code: "KLB", shortName: "KienlongBank", name: "Ngân hàng Kiên Long" },
  { bin: "970449", code: "LPB", shortName: "LPBank", name: "Ngân hàng Lộc Phát Việt Nam" },
  { bin: "970422", code: "MBB", shortName: "MB Bank", name: "Ngân hàng Quân đội" },
  { bin: "970426", code: "MSB", shortName: "MSB", name: "Ngân hàng Hàng hải Việt Nam" },
  { bin: "970428", code: "NAB", shortName: "Nam A Bank", name: "Ngân hàng Nam Á" },
  { bin: "970419", code: "NCB", shortName: "NCB", name: "Ngân hàng Quốc dân" },
  { bin: "970448", code: "OCB", shortName: "OCB", name: "Ngân hàng Phương Đông" },
  { bin: "970414", code: "OJB", shortName: "Oceanbank", name: "Ngân hàng Đại Dương" },
  { bin: "970430", code: "PGB", shortName: "PGBank", name: "Ngân hàng Xăng dầu Petrolimex" },
  { bin: "970412", code: "PVC", shortName: "PVcomBank", name: "Ngân hàng Đại chúng Việt Nam" },
  { bin: "970403", code: "STB", shortName: "Sacombank", name: "Ngân hàng Sài Gòn Thương Tín" },
  { bin: "970400", code: "SGB", shortName: "Saigonbank", name: "Ngân hàng Sài Gòn Công thương" },
  { bin: "970429", code: "SCB", shortName: "SCB", name: "Ngân hàng Sài Gòn" },
  { bin: "970440", code: "SEAB", shortName: "SeABank", name: "Ngân hàng Đông Nam Á" },
  { bin: "970443", code: "SHB", shortName: "SHB", name: "Ngân hàng Sài Gòn - Hà Nội" },
  { bin: "970424", code: "SVB", shortName: "Shinhan Bank", name: "Ngân hàng Shinhan Việt Nam" },
  { bin: "970410", code: "SCB", shortName: "Standard Chartered", name: "Ngân hàng Standard Chartered Việt Nam" },
  { bin: "970407", code: "TCB", shortName: "Techcombank", name: "Ngân hàng Kỹ thương Việt Nam" },
  { bin: "963388", code: "TIMO", shortName: "Timo", name: "Timo by BVBank" },
  { bin: "970423", code: "TPB", shortName: "TPBank", name: "Ngân hàng Tiên Phong" },
  { bin: "970415", code: "ICB", shortName: "VietinBank", name: "Ngân hàng Công thương Việt Nam" },
  { bin: "970436", code: "VCB", shortName: "Vietcombank", name: "Ngân hàng Ngoại thương Việt Nam" },
  { bin: "970433", code: "VBB", shortName: "VietBank", name: "Ngân hàng Việt Nam Thương Tín" },
  { bin: "970441", code: "VIB", shortName: "VIB", name: "Ngân hàng Quốc tế Việt Nam" },
  { bin: "970432", code: "VPB", shortName: "VPBank", name: "Ngân hàng Việt Nam Thịnh Vượng" },
  { bin: "970421", code: "VRB", shortName: "VRB", name: "Ngân hàng Liên doanh Việt - Nga" },
  { bin: "970405", code: "VBA", shortName: "Agribank", name: "Ngân hàng Nông nghiệp và Phát triển Nông thôn" },
  { bin: "970457", code: "WOO", shortName: "Woori Bank", name: "Ngân hàng Woori Việt Nam" },
  { bin: "970416", code: "ACB", shortName: "ACB", name: "Ngân hàng Á Châu" },
];

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

/** Longest transfer note a bank QR field takes well. */
export const TRANSFER_NOTE_MAX = 25;

const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * A bank-friendly transfer note: Vietnamese diacritics removed (including đ/Đ, which NFD does
 * not decompose), only [A-Za-z0-9 ] kept, whitespace collapsed and trimmed, capped at
 * `TRANSFER_NOTE_MAX` characters. Two calls with the same note always give the same string.
 */
export function sanitizeTransferNote(text: string): string {
  const ascii = text
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/[đĐ]/g, (char) => (char === "đ" ? "d" : "D"));

  return ascii
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TRANSFER_NOTE_MAX)
    .trim();
}
