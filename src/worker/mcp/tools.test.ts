import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { startFocus } from "../focus/focus";
import type { AuthedToken } from "./auth";
import { resolveFocusForWrite, resolveWorkspace } from "./tools";
import type { McpEnv } from "./tools";

/**
 * Exercises the membership gate that closed the review's Critical findings
 * 1–2: `update_focus_metric` / `close_focus` previously called `setMetric`/
 * `closeFocus` with a bare `focus_id` and no check that the caller's token
 * owner is an active member of that Focus's workspace. `resolveFocusForWrite`
 * is the fix, tested directly here (rather than through the full MCP
 * transport) so the assertion is on the actual gate, not on HTTP plumbing.
 *
 * Runs against real D1 with the real migrations (see vitest.config.ts /
 * src/worker/test-setup.ts), same as focus.test.ts.
 */
const DB = () => env.DB;
const mcpEnv = (): McpEnv => ({ BOARD_DO: undefined as never, DB: DB() });

function token(createdBy: string | null): AuthedToken {
  return { id: "tok-1", name: "test-agent", createdBy };
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

describe("resolveWorkspace", () => {
  it("resolves the single active membership when workspace_id is omitted", async () => {
    await makeWorkspace("ws-single");
    await addMember("ws-single", "zakir@lomeyo.com");

    const resolved = await resolveWorkspace(mcpEnv(), token("zakir@lomeyo.com"), undefined, "test_tool");
    expect(resolved).toEqual({ workspaceId: "ws-single" });
  });

  it("errors when the token has no owner", async () => {
    const resolved = await resolveWorkspace(mcpEnv(), token(null), undefined, "test_tool");
    expect(resolved).toEqual({ error: expect.stringContaining("no owner") });
  });
});

describe("resolveFocusForWrite — the authz gate for update_focus_metric / close_focus", () => {
  it("refuses a focus_id belonging to a workspace the token owner is not a member of", async () => {
    await makeWorkspace("ws-owner");
    await makeWorkspace("ws-stranger");
    await addMember("ws-owner", "owner@lomeyo.com");
    await addMember("ws-stranger", "stranger@lomeyo.com");

    const focus = await startFocus(DB(), "ws-owner", { title: "owner's focus", endsAt: future(7) });

    // The token belongs to "stranger", who is not a member of ws-owner —
    // this is the exact gap findings 1-2 flagged: guessing/knowing a valid
    // focus_id from another workspace must not work.
    const resolved = await resolveFocusForWrite(
      mcpEnv(),
      token("stranger@lomeyo.com"),
      undefined,
      focus.id,
      "close_focus",
    );

    expect(resolved).toEqual({ error: expect.stringContaining(`focus "${focus.id}" not found`) });
    // Same text as a genuinely missing id — asserted separately below —
    // so a stranger can't distinguish "wrong workspace" from "doesn't exist".
  });

  it("gives the identical error text for a focus_id that truly doesn't exist", async () => {
    await makeWorkspace("ws-solo");
    await addMember("ws-solo", "solo@lomeyo.com");

    const resolved = await resolveFocusForWrite(
      mcpEnv(),
      token("solo@lomeyo.com"),
      undefined,
      "f-doesnotexist",
      "close_focus",
    );
    expect(resolved).toEqual({ error: 'close_focus failed: focus "f-doesnotexist" not found' });
  });

  it("allows an active member to act on their own workspace's focus by id", async () => {
    await makeWorkspace("ws-member");
    await addMember("ws-member", "member@lomeyo.com");
    const focus = await startFocus(DB(), "ws-member", { title: "t", endsAt: future(7) });

    const resolved = await resolveFocusForWrite(
      mcpEnv(),
      token("member@lomeyo.com"),
      undefined,
      focus.id,
      "close_focus",
    );
    expect("focus" in resolved && resolved.focus.id).toBe(focus.id);
  });

  it("rejects when a given workspace_id disagrees with the focus's real workspace", async () => {
    await makeWorkspace("ws-real");
    await makeWorkspace("ws-claimed");
    await addMember("ws-real", "both@lomeyo.com");
    await addMember("ws-claimed", "both@lomeyo.com");
    const focus = await startFocus(DB(), "ws-real", { title: "t", endsAt: future(7) });

    const resolved = await resolveFocusForWrite(
      mcpEnv(),
      token("both@lomeyo.com"),
      "ws-claimed",
      focus.id,
      "close_focus",
    );
    expect(resolved).toEqual({ error: expect.stringContaining("not found") });
  });

  it("with no focus_id, resolves to the active focus of the resolved workspace", async () => {
    await makeWorkspace("ws-active-only");
    await addMember("ws-active-only", "agent@lomeyo.com");
    const focus = await startFocus(DB(), "ws-active-only", { title: "t", endsAt: future(7) });

    const resolved = await resolveFocusForWrite(
      mcpEnv(),
      token("agent@lomeyo.com"),
      undefined,
      undefined,
      "update_focus_metric",
    );
    expect("focus" in resolved && resolved.focus.id).toBe(focus.id);
  });

  it("with no focus_id and no active focus, errors instead of silently doing nothing", async () => {
    await makeWorkspace("ws-no-active");
    await addMember("ws-no-active", "agent2@lomeyo.com");

    const resolved = await resolveFocusForWrite(
      mcpEnv(),
      token("agent2@lomeyo.com"),
      undefined,
      undefined,
      "update_focus_metric",
    );
    expect(resolved).toEqual({ error: expect.stringContaining("no active focus") });
  });
});
