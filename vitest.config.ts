import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@test": path.resolve(__dirname, "./src/__tests__/setup"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
