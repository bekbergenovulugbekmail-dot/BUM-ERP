import { defineConfig } from "vitest/config";
import { testDatabaseUrl } from "./test/database-url.js";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl(),
    },
    // Hamma test fayllari bitta test bazasini tozalaydi — parallel ishlamasin
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
