import type { ApiErrorCode } from "./types";

/**
 * The single error type every route handler and library function throws.
 * `lib/http.ts` maps an instance straight onto the contract's error envelope.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** Seconds the client should wait; surfaced as a `Retry-After` header (RATE_LIMITED only). */
  readonly retryAfterSec?: number;

  constructor(code: ApiErrorCode, status: number, message: string, retryAfterSec?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

/** STATUS_BY_CODE is the contract's code → HTTP status table. */
export const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

function make(code: ApiErrorCode, fallback: string, message?: string): ApiError {
  return new ApiError(code, STATUS_BY_CODE[code], message ?? fallback);
}

/** 401 — no valid session. */
export function unauthorized(message?: string): ApiError {
  return make("UNAUTHORIZED", "Bạn cần đăng nhập để tiếp tục.", message);
}

/** 403 — authenticated but not allowed (e.g. not an active member of the group). */
export function forbidden(message?: string): ApiError {
  return make("FORBIDDEN", "Bạn không có quyền thực hiện thao tác này.", message);
}

/** 404 — the addressed resource does not exist. */
export function notFound(message?: string): ApiError {
  return make("NOT_FOUND", "Không tìm thấy dữ liệu yêu cầu.", message);
}

/** 400 — the request payload failed validation. */
export function badRequest(message?: string): ApiError {
  return make("VALIDATION", "Dữ liệu gửi lên không hợp lệ.", message);
}

/** 409 — the request conflicts with existing state (duplicate name, self-removal, …). */
export function conflict(message?: string): ApiError {
  return make("CONFLICT", "Dữ liệu đã tồn tại hoặc xung đột.", message);
}

/** 429 — too many requests from this client; retry after `retryAfterSec`. */
export function rateLimited(retryAfterSec: number): ApiError {
  return new ApiError(
    "RATE_LIMITED",
    STATUS_BY_CODE.RATE_LIMITED,
    "Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.",
    retryAfterSec,
  );
}

/** 500 — an unexpected server-side failure. */
export function internal(message?: string): ApiError {
  return make("INTERNAL", "Đã xảy ra lỗi hệ thống.", message);
}
