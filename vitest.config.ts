import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}", "extensions/*/tests/*.{test,spec}.{js,ts}"],
    environment: "node",
    testTimeout: 15_000,
    // Tests never call Claude for real (and never spend), even with a key in the shell.
    env: { ANTHROPIC_API_KEY: "" },
  },
});
