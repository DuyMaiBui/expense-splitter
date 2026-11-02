import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Email transport settings, read from the Worker's environment bindings.
 *
 * These three bindings are NOT declared in wrangler.jsonc yet. Provisioning them is a deploy-time
 * step (see docs/CONTRACT.md § PASSWORD RESET):
 *   EMAIL_PROVIDER  — plain var, "resend" selects the Resend sender; anything else, or unset,
 *                     yields the NoOp sender.
 *   EMAIL_API_KEY   — SECRET (`wrangler secret put EMAIL_API_KEY`), never a plain var.
 *   EMAIL_FROM      — plain var, the verified sender, e.g. "Chia tiền nhóm <no-reply@example.com>".
 *
 * Reading is defensive on purpose: this module is imported by the always-200 forgot-password
 * path, so an environment that has no bindings at all (tests, `next dev` without the adapter,
 * a Worker with the secrets not provisioned yet) must resolve to "not configured", never throw.
 */

export interface EmailEnv {
  EMAIL_PROVIDER?: string;
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
}

/** Resend's shared test sender, used only when EMAIL_FROM is unset. */
export const DEFAULT_FROM = "Chia tiền nhóm <onboarding@resend.dev>";

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The email bindings for the current request.
 *
 * `getCloudflareContext()` reads a request-scoped AsyncLocalStorage context and throws outside
 * one, so a failure is a normal "no bindings here" and falls through to `process.env` (which is
 * how the Vitest run and a plain `next dev` see them).
 */
export function readEmailEnv(): EmailEnv {
  let bindings: Record<string, unknown> = {};

  try {
    bindings = getCloudflareContext().env as unknown as Record<string, unknown>;
  } catch {
    // Outside a Cloudflare request (tests, build, plain Node): fall back below.
  }

  return {
    EMAIL_PROVIDER: optionalString(bindings.EMAIL_PROVIDER) ?? optionalString(process.env.EMAIL_PROVIDER),
    EMAIL_API_KEY: optionalString(bindings.EMAIL_API_KEY) ?? optionalString(process.env.EMAIL_API_KEY),
    EMAIL_FROM: optionalString(bindings.EMAIL_FROM) ?? optionalString(process.env.EMAIL_FROM),
  };
}
