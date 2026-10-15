import { getCurrentUser } from "./auth";
import { ApiError, badRequest, forbidden, internal, rateLimited } from "./errors";
import { isIpBanned, recordAbuse } from "./guard";
import { checkRateLimit, clientKey, type LimitKind } from "./rate-limit";

/**
 * HTTP plumbing shared by every route handler: the success envelope, the error envelope and
 * the wrapper that turns any thrown value into the documented error response.
 */

/** The second argument Next.js passes to a route handler. `params` is a promise in Next 16. */
export interface RouteContext {
  params: Promise<Record<string, string>>;
}

export type RouteHandler = (req: Request, ctx: RouteContext) => Promise<Response>;

/** Builds the success envelope. `status` is 200 by default and 201 on create. */
export function ok<T extends object>(data: T, status = 200): Response {
  return Response.json({ ok: true, data }, { status });
}

/** Builds the error envelope for an `ApiError`. */
export function errorResponse(error: ApiError): Response {
  return Response.json(
    { ok: false, error: { code: error.code, message: error.message } },
    {
      status: error.status,
      headers: error.retryAfterSec ? { "Retry-After": String(error.retryAfterSec) } : undefined,
    },
  );
}

/**
 * Wraps a route handler so it only ever returns a contract-shaped response:
 * `ApiError` maps to its own code/status, anything else is logged and returned as INTERNAL
 * (never leaked to the client).
 */
export interface RouteOptions {
  /** Per-address throttle ("api" by default, `false` to skip). */
  limit?: LimitKind | false;
  /** Serve banned addresses too. Only for admin routes, which authenticate before acting. */
  allowBanned?: boolean;
}

/** The `sid` cookie value, read straight off the request (no database, no cookie store). */
function sessionToken(req: Request): string | null {
  const match = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.get("cookie") ?? "");
  return match?.[1] ?? null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function route(handler: RouteHandler, options: RouteOptions = {}) {
  const kind = options.limit === undefined ? "api" : options.limit;

  return async (req: Request, ctx: RouteContext): Promise<Response> => {
    try {
      const ip = clientKey(req);

      // Cheapest checks first, all before any per-request DB work: a rejected request must
      // cost no D1 rows. The ban list lives in memory (reloaded once a minute).
      if (!options.allowBanned && (await isIpBanned(ip))) {
        throw forbidden("Địa chỉ IP của bạn đã bị chặn. Liên hệ quản trị viên nếu đây là nhầm lẫn.");
      }

      if (kind) {
        const verdict = await checkRateLimit(kind, ip);
        if (!verdict.allowed) {
          throw rateLimited(verdict.retryAfterSec);
        }
      }

      // Spam guard: mutations are budgeted per signed-in session, not just per address, so
      // one account cannot hammer the API from many addresses and a shared address does not
      // pool its users' budgets.
      const isWrite = req.method !== "GET" && req.method !== "HEAD";
      const token = isWrite && kind === "api" ? sessionToken(req) : null;
      if (token) {
        const verdict = await checkRateLimit("write", await sha256Hex(token));
        if (!verdict.allowed) {
          const user = await getCurrentUser().catch(() => null);
          await recordAbuse({ ip, userId: user?.id ?? null, kind: "write-rate" });
          throw rateLimited(verdict.retryAfterSec);
        }
      }

      return await handler(req, ctx);
    } catch (error) {
      if (error instanceof ApiError) {
        return errorResponse(error);
      }
      console.error("[api] unhandled error:", error);
      return errorResponse(internal("Đã xảy ra lỗi hệ thống, vui lòng thử lại sau."));
    }
  };
}

/**
 * Reads and validates a JSON request body. Malformed JSON is a VALIDATION error rather than an
 * unhandled exception; `parse` is responsible for validating the decoded shape.
 */
export const MAX_BODY_BYTES = 32_768;

export async function readJson<T>(req: Request, parse: (raw: unknown) => T): Promise<T> {
  // Every real payload here is a few hundred bytes: refuse a large body before parsing it.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    throw badRequest("Nội dung gửi lên quá lớn.");
  }

  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      throw badRequest("Nội dung gửi lên quá lớn.");
    }
    raw = JSON.parse(text);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw badRequest("Nội dung JSON trong yêu cầu không hợp lệ.");
  }
  return parse(raw);
}
