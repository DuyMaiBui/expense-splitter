import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only the pure unit tests under lib/ are run here; the API and pages are exercised
    // against a real D1 instance, not in this suite.
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
