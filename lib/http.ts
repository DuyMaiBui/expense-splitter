import { ApiError, badRequest, internal } from "./errors";

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
    { status: error.status },
  );
}

/**
 * Wraps a route handler so it only ever returns a contract-shaped response:
 * `ApiError` maps to its own code/status, anything else is logged and returned as INTERNAL
 * (never leaked to the client).
 */
export function route(handler: RouteHandler) {
  return async (req: Request, ctx: RouteContext): Promise<Response> => {
    try {
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
export async function readJson<T>(req: Request, parse: (raw: unknown) => T): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Nội dung JSON trong yêu cầu không hợp lệ.");
  }
  return parse(raw);
}
