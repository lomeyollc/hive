import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Tests run inside workerd itself, not Node — that is the point of the workers
 * pool. BoardDO's storage is real Durable Object SQLite running the real
 * migrations, so a test exercises the same code path production does instead
 * of a mock that can drift from it.
 *
 * `isolatedStorage` rolls storage back to a clean slate after each test, so
 * tests can use fixed board names without colliding.
 *
 * Note: as of @cloudflare/vitest-pool-workers 0.21 the old
 * `defineWorkersConfig` helper from the `/config` subpath is gone — the pool
 * is a normal Vite plugin now.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      isolatedStorage: true,
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts"],
  },
});
