// OpenNext Cloudflare adapter configuration.
// No incremental cache override: this app renders dynamically and stores no cacheable
// static/ISR output, so the R2 incremental cache is intentionally left disabled.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
