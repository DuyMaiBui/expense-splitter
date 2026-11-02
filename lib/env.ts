import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Email transport settings, read from the Worker's environment.
 *
 * Resend is the provider; the only required value is the API key, read from the scalar
 * `RESEND_API_KEY`:
 *   - production — a Worker SECRET (`cf workers secrets bulk`, never a plain var);
 *   - local — a line in `.env` (gitignored; `.env.example` carries the placeholder), which both
 *     `npm run dev` and `npx opennextjs-cloudflare dev` read.
 *
 * `RESEND_FROM` is optional: the verified sender `From` address. Unset means Resend's shared test
 * sender, which only delivers to the Resend account owner — fine locally, not for real users.
 *
 * Reading is defensive on purpose: this module is imported by the always-200 forgot-password
 * path, so an environment with no bindings at all (tests, a Worker whose secret is not set yet)
 * must resolve to "not configured", never throw.
 */

export interface EmailEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
}

/** Resend's shared test sender, used only when RESEND_FROM is unset. */
export const DEFAULT_FROM = "Chia tiền nhóm <onboarding@resend.dev>";

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The email settings for the current request.
 *
 * `getCloudflareContext()` reads a request-scoped AsyncLocalStorage context and throws outside
 * one, so a failure is a normal "no bindings here" and falls through to `process.env` (which is
 * how the Vitest run and a plain `next dev` see `.env`).
 */
export function readEmailEnv(): EmailEnv {
  let bindings: Record<string, unknown> = {};

  try {
    bindings = getCloudflareContext().env as unknown as Record<string, unknown>;
  } catch {
    // Outside a Cloudflare request (tests, build, plain Node): fall back below.
  }

  function read(name: string): string | undefined {
    return optionalString(bindings[name]) ?? optionalString(process.env[name]);
  }

  return {
    RESEND_API_KEY: read("RESEND_API_KEY"),
    RESEND_FROM: read("RESEND_FROM"),
  };
}
