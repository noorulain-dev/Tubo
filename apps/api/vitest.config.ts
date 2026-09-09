import { defineConfig } from "vitest/config";

export default defineConfig({
  // Vitest sets MODE=test, which is not a valid application mode. Tests run
  // against the deterministic sample providers, never live integrations.
  test: {
    env: { MODE: "sample" },
  },
});
