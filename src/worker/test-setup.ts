import { applyD1Migrations, env } from "cloudflare:test";

/**
 * Runs once per worker instance before any test in this pool, inside
 * workerd. Applies the real `migrations/*.sql` files to the test `env.DB`
 * so D1-backed code (Focus, workspaces, boards index, ...) is exercised
 * against the same schema production runs, not a hand-maintained fixture
 * that can drift from it.
 *
 * `TEST_D1_MIGRATIONS` is a `vars` binding set only in `vitest.config.ts`
 * (via `readD1Migrations`, run in Node) — it does not exist in
 * `wrangler.jsonc` or `worker-configuration.d.ts`, hence the cast.
 */
const { TEST_D1_MIGRATIONS, DB } = env as unknown as {
  TEST_D1_MIGRATIONS: { name: string; queries: string[] }[];
  DB: D1Database;
};

await applyD1Migrations(DB, TEST_D1_MIGRATIONS);
