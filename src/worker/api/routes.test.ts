import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createSessionCookie } from "../auth/session";
import { startFocus } from "../focus/focus";

/**
 * Drives the real worker (`SELF.fetch`, real `env.DB` with real migrations
 * — see vitest.config.ts / test-setup.ts) with a real, correctly-signed
 * session cookie, rather than calling `handleApiRequest`/handler functions
 * directly. That's deliberate: the review round-2 ask was specifically for
 * the REST membership check and 409 mapping to be exercised end-to-end,
 * cookie parsing and all — `focus.test.ts` and `mcp/tools.test.ts` already
 * cover the underlying D1 functions and the MCP-side gate in isolation.
 *
 * `SESSION_SECRET` is set to a fixed test-only value in vitest.config.ts's
 * `miniflare.bindings` (there is no `.dev.vars` in this worktree, and the
 * real secret is never committed) — `createSessionCookie` needs some value
 * to sign against, and this test process is the only thing that ever reads
 * this particular value.
 */

async function sessionCookie(email: string): Promise<string> {
  const setCookie = await createSessionCookie(email, env as unknown as Env, false);
  // The response-only attributes (Path, HttpOnly, ...) after the first ";"
  // are harmless to include in a request Cookie header too — readCookie()
  // just never matches them — but stripping them keeps the test request
  // honest about what a real client actually sends.
  return setCookie.split(";")[0];
}

async function makeWorkspace(id: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)`)
    .bind(id, id, new Date().toISOString())
    .run();
}

async function addMember(workspaceId: string, email: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO workspace_members (id, workspace_id, email, role, status, invited_by, invited_at, accepted_at)
     VALUES (?, ?, ?, 'owner', 'active', ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), workspaceId, email, email, new Date().toISOString(), new Date().toISOString())
    .run();
}

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const jsonHeaders = (cookie: string) => ({ Cookie: cookie, "Content-Type": "application/json" });

describe("GET /api/focus — membership gate", () => {
  it("refuses a workspace the caller isn't an active member of", async () => {
    await makeWorkspace("ws-get-refused");
    await addMember("ws-get-refused", "owner@lomeyo.com");
    const cookie = await sessionCookie("stranger@lomeyo.com");

    const res = await SELF.fetch(`https://hive.test/api/focus?workspace_id=ws-get-refused`, {
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringContaining("not a member") });
  });

  it("succeeds for an active member with no active focus yet", async () => {
    await makeWorkspace("ws-get-ok");
    await addMember("ws-get-ok", "member@lomeyo.com");
    const cookie = await sessionCookie("member@lomeyo.com");

    const res = await SELF.fetch(`https://hive.test/api/focus?workspace_id=ws-get-ok`, {
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ active: null, past: [] });
  });
});

describe("POST /api/focus — the one-active-per-workspace conflict", () => {
  it("starts a focus (201), then a second start while active is 409", async () => {
    await makeWorkspace("ws-post-conflict");
    await addMember("ws-post-conflict", "owner2@lomeyo.com");
    const cookie = await sessionCookie("owner2@lomeyo.com");

    const first = await SELF.fetch(`https://hive.test/api/focus`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ workspace_id: "ws-post-conflict", title: "Launch S&C", ends_at: future(7) }),
    });
    expect(first.status).toBe(201);

    const second = await SELF.fetch(`https://hive.test/api/focus`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ workspace_id: "ws-post-conflict", title: "Second focus", ends_at: future(7) }),
    });
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body).toMatchObject({ error: expect.stringContaining("already has an active focus") });
  });

  it("refuses to start in a workspace the caller isn't an active member of", async () => {
    await makeWorkspace("ws-post-refused");
    await addMember("ws-post-refused", "owner3@lomeyo.com");
    const cookie = await sessionCookie("stranger4@lomeyo.com");

    const res = await SELF.fetch(`https://hive.test/api/focus`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ workspace_id: "ws-post-refused", title: "x", ends_at: future(7) }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400, not 500, when metrics is not an array", async () => {
    await makeWorkspace("ws-post-bad-metrics");
    await addMember("ws-post-bad-metrics", "owner5@lomeyo.com");
    const cookie = await sessionCookie("owner5@lomeyo.com");

    const res = await SELF.fetch(`https://hive.test/api/focus`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        workspace_id: "ws-post-bad-metrics",
        title: "x",
        ends_at: future(7),
        metrics: { label: "not an array", target: 10 },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringContaining("metrics must be an array") });
  });
});

describe("PATCH /api/focus/:id — cross-workspace focus id is refused", () => {
  it("returns 404 when the focus belongs to a workspace the caller isn't in", async () => {
    await makeWorkspace("ws-patch-owner");
    await makeWorkspace("ws-patch-stranger");
    await addMember("ws-patch-owner", "owner4@lomeyo.com");
    await addMember("ws-patch-stranger", "stranger5@lomeyo.com");
    const focus = await startFocus(env.DB, "ws-patch-owner", { title: "owner's focus", endsAt: future(7) });

    const cookie = await sessionCookie("stranger5@lomeyo.com");
    const res = await SELF.fetch(`https://hive.test/api/focus/${focus.id}`, {
      method: "PATCH",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ title: "hijacked" }),
    });

    expect(res.status).toBe(404);
  });

  it("succeeds for an active member of the focus's own workspace", async () => {
    await makeWorkspace("ws-patch-ok");
    await addMember("ws-patch-ok", "member2@lomeyo.com");
    const focus = await startFocus(env.DB, "ws-patch-ok", { title: "before", endsAt: future(7) });

    const cookie = await sessionCookie("member2@lomeyo.com");
    const res = await SELF.fetch(`https://hive.test/api/focus/${focus.id}`, {
      method: "PATCH",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ title: "after" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { focus: { title: string } };
    expect(body.focus.title).toBe("after");
  });
});

describe("POST /api/focus/:id/close — cross-workspace focus id is refused", () => {
  it("returns 404 when the focus belongs to a workspace the caller isn't in", async () => {
    await makeWorkspace("ws-close-owner");
    await makeWorkspace("ws-close-stranger");
    await addMember("ws-close-owner", "owner5@lomeyo.com");
    await addMember("ws-close-stranger", "stranger6@lomeyo.com");
    const focus = await startFocus(env.DB, "ws-close-owner", { title: "owner's focus", endsAt: future(7) });

    const cookie = await sessionCookie("stranger6@lomeyo.com");
    const res = await SELF.fetch(`https://hive.test/api/focus/${focus.id}/close`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ status: "hit" }),
    });

    expect(res.status).toBe(404);
  });

  it("succeeds for an active member and frees the workspace's active slot", async () => {
    await makeWorkspace("ws-close-ok");
    await addMember("ws-close-ok", "member3@lomeyo.com");
    const focus = await startFocus(env.DB, "ws-close-ok", { title: "t", endsAt: future(7) });

    const cookie = await sessionCookie("member3@lomeyo.com");
    const res = await SELF.fetch(`https://hive.test/api/focus/${focus.id}/close`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ status: "hit", lesson: "shipped it" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { focus: { status: string } };
    expect(body.focus.status).toBe("hit");
  });
});

describe("unauthenticated requests", () => {
  it("401s without a session cookie", async () => {
    const res = await SELF.fetch(`https://hive.test/api/focus?workspace_id=anything`);
    expect(res.status).toBe(401);
  });
});
