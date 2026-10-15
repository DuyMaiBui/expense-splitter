// Ambient Cloudflare Workers types plus the app's own bindings.
//
// `@opennextjs/cloudflare` already declares a global `CloudflareEnv` interface (with the
// adapter's own optional bindings). This file adds the bindings this app actually uses, so
// `getCloudflareContext().env.DB` is typed as a D1Database.
//
// This is a script file on purpose (no top-level import/export): a top-level `interface`
// here is a global declaration, which merges with the adapter's declaration. Wrapping it in
// `declare global` would require the file to be a module instead.
/// <reference types="@cloudflare/workers-types" />

interface CloudflareEnv {
  /** D1 database binding declared in wrangler.jsonc (`d1_databases[].binding`). */
  DB: D1Database;
  /** Login/register limiter (`ratelimits[]` in wrangler.jsonc); absent in local dev. */
  RL_AUTH?: RateLimit;
  /** General API limiter; absent in local dev. */
  RL_API?: RateLimit;
}
