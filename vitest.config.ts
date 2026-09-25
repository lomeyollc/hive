import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
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
 *
 * D1 (`env.DB`) is not seeded automatically the way DO SQLite is — Focus's
 * tests are the first thing in this repo to need it applied. `readD1Migrations`
 * runs here in Node (it just reads the .sql files off disk) and the result is
 * handed to the worker as a binding; `src/worker/test-setup.ts` (declared as
 * a `setupFiles` entry below, so it runs once per worker instance, inside
 * workerd) is what actually calls `applyD1Migrations` against `env.DB`.
 */
const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      isolatedStorage: true,
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { TEST_D1_MIGRATIONS: migrations },
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/worker/test-setup.ts"],
  },
});
