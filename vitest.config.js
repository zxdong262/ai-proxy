import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["temp/**", "node_modules/**"],
    // Isolate module state between test files
    isolate: true,
  },
});
