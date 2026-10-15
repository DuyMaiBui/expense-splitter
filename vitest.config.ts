import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors tsconfig `paths` so route handlers can be imported with their "@/..." specifiers.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    // lib/: pure unit tests. tests/: API route handlers run against a real SQLite database
    // that is built from migrations/0001_init.sql (see tests/helpers/d1.ts).
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
  },
});
