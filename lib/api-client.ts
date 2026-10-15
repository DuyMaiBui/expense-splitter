import type { ApiErrorCode, ApiEnvelope } from "./types";

/**
 * The browser-side API client. Every page component talks to the API through `api()`, which
 * unwraps the response envelope and turns a failure into a typed `ApiClientError`.
 *
 * It is also the request-saving layer (each request is a billed Worker invocation):
 *   - GETs are cached for CACHE_TTL_MS, so moving between tabs of a group re-uses the data;
 *   - identical in-flight GETs are shared, so a nav bar and a page asking for the same
 *     resource send one request;
 *   - a successful mutation drops exactly the cached entries it can have changed.
 */

export class ApiClientError extends Error {
  readonly code: ApiErrorCode | "NETWORK";
  readonly status: number;

  constructor(code: ApiErrorCode | "NETWORK", status: number, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
  }
}

export interface ApiRequestInit {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** GET only: skip the cache and refetch (still shares an identical in-flight request). */
  fresh?: boolean;
}

/** How long a cached GET is served without asking the server again. */
export const CACHE_TTL_MS = 30_000;

const cache = new Map<string, { data: unknown; at: number }>();
const inflight = new Map<string, Promise<unknown>>();

/** Drop cached GETs whose path starts with `prefix`, or everything when omitted. */
export function invalidateApiCache(prefix?: string): void {
  if (prefix === undefined) {
    cache.clear();
    return;
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/**
 * The cached GETs a successful mutation on `path` can have changed.
 *   /api/auth/*              -> everything (the session, hence the viewer, changed)
 *   /api/groups[/join]       -> the group list
 *   /api/groups/:id/...      -> that group's data, and the list (memberCount)
 */
function invalidateAfterMutation(path: string): void {
  // The admin edits other people's data (renames, deletes, bans): drop everything.
  if (path.startsWith("/api/auth/") || path.startsWith("/api/admin/")) {
    invalidateApiCache();
    return;
  }
  const group = /^\/api\/groups\/([^/?]+)/.exec(path);
  if (group && group[1] !== "join") {
    invalidateApiCache(`/api/groups/${group[1]}`);
  }
  invalidateApiCache("/api/groups");
}

function redirectToLogin(): void {
  // Only meaningful in the browser; on the server there is no location to change.
  if (typeof window !== "undefined") {
    window.location.href = "/login";
  }
}

async function request<T>(path: string, method: string, body: unknown): Promise<T> {
  const hasBody = body !== undefined;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiClientError("NETWORK", 0, "Không thể kết nối tới máy chủ.");
  }

  if (response.status === 401) {
    invalidateApiCache();
    redirectToLogin();
    throw new ApiClientError("UNAUTHORIZED", 401, "Phiên đăng nhập đã hết hạn.");
  }

  let envelope: ApiEnvelope<Record<string, unknown>>;
  try {
    envelope = (await response.json()) as ApiEnvelope<Record<string, unknown>>;
  } catch {
    throw new ApiClientError(
      "INTERNAL",
      response.status,
      "Máy chủ trả về dữ liệu không hợp lệ.",
    );
  }

  if (!envelope.ok) {
    throw new ApiClientError(envelope.error.code, response.status, envelope.error.message);
  }

  return envelope.data as T;
}

/**
 * Calls the API and returns the unwrapped `data` payload.
 *
 * A 401 clears the client's view of the session by navigating to /login; every other failure
 * throws `ApiClientError` carrying the contract's code, status and Vietnamese message.
 */
export async function api<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const method = init?.method ?? "GET";

  if (method !== "GET") {
    const data = await request<T>(path, method, init?.body);
    invalidateAfterMutation(path);
    return data;
  }

  if (!init?.fresh) {
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return hit.data as T;
    }
  }

  const pending = inflight.get(path);
  if (pending) {
    return pending as Promise<T>;
  }

  const promise = request<T>(path, "GET", undefined)
    .then((data) => {
      cache.set(path, { data, at: Date.now() });
      return data;
    })
    .finally(() => {
      inflight.delete(path);
    });

  inflight.set(path, promise);
  return promise;
}
