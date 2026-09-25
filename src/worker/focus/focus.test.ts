import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  ConflictError,
  closeFocus,
  focusProgress,
  getActiveFocus,
  setMetric,
  startFocus,
  toWire,
} from "./focus";

/**
 * Runs against real D1 with the real migrations applied by
 * `src/worker/test-setup.ts` (see vitest.config.ts). `isolatedStorage: true`
 * rolls D1 back to a clean slate after each test, so fixed workspace/board
 * ids below never collide across tests.
 */
const DB = () => env.DB;

async function makeWorkspace(id: string): Promise<void> {
  await DB()
    .prepare(`INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)`)
    .bind(id, id, new Date().toISOString())
    .run();
}

async function makeBoard(id: string, workspaceId: string): Promise<void> {
  await DB()
    .prepare(`INSERT INTO boards (id, name, created_at, workspace_id) VALUES (?, ?, ?, ?)`)
    .bind(id, id, new Date().toISOString(), workspaceId)
    .run();
}

async function makeTask(id: string, boardId: string, labels: string[], status = "open"): Promise<void> {
  await DB()
    .prepare(
      `INSERT INTO tasks_index (id, board_id, title, status, priority, labels, updated_at)
       VALUES (?, ?, ?, ?, 'normal', ?, ?)`,
    )
    .bind(id, boardId, id, status, JSON.stringify(labels), new Date().toISOString())
    .run();
}

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const past = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

describe("startFocus", () => {
  it("starts a focus and toWire includes metrics, progress, days_left and task_label", async () => {
    await makeWorkspace("ws-start");
    const row = await startFocus(
      DB(),
      "ws-start",
      { title: "Launch S&C", why: "compounding channel", notList: ["cold email"], endsAt: future(14) },
      "zakir@lomeyo.com",
    );

    expect(row.id).toMatch(/^f-[0-9a-f]{8}$/);
    expect(row.status).toBe("active");

    const wire = await toWire(DB(), row);
    expect(wire.title).toBe("Launch S&C");
    expect(wire.not_list).toEqual(["cold email"]);
    expect(wire.metrics).toEqual([]);
    expect(wire.progress).toEqual({ total: 0, done: 0 });
    expect(wire.days_left).toBeGreaterThan(0);
    expect(wire.overdue).toBe(false);
    expect(wire.task_label).toBe(`focus:${row.id}`);
  });

  it("rejects ends_at before starts_at", async () => {
    await makeWorkspace("ws-bad-dates");
    await expect(
      startFocus(DB(), "ws-bad-dates", { title: "x", endsAt: past(1) }),
    ).rejects.toThrow(/ends_at must be after starts_at/);
  });

  it("a second start in the same workspace fails with ConflictError", async () => {
    await makeWorkspace("ws-conflict");
    await startFocus(DB(), "ws-conflict", { title: "First", endsAt: future(7) });

    await expect(startFocus(DB(), "ws-conflict", { title: "Second", endsAt: future(7) })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("starting in a different workspace succeeds even while another has an active focus", async () => {
    await makeWorkspace("ws-a");
    await makeWorkspace("ws-b");
    await startFocus(DB(), "ws-a", { title: "A", endsAt: future(7) });

    const b = await startFocus(DB(), "ws-b", { title: "B", endsAt: future(7) });
    expect(b.workspace_id).toBe("ws-b");
    expect((await getActiveFocus(DB(), "ws-a"))?.title).toBe("A");
    expect((await getActiveFocus(DB(), "ws-b"))?.title).toBe("B");
  });

  it("accepts metrics at creation time", async () => {
    await makeWorkspace("ws-metrics-create");
    const row = await startFocus(DB(), "ws-metrics-create", {
      title: "with metrics",
      endsAt: future(7),
      metrics: [{ label: "Signups", target: 20 }],
    });
    const wire = await toWire(DB(), row);
    expect(wire.metrics).toHaveLength(1);
    expect(wire.metrics[0]).toMatchObject({ label: "Signups", target: 20, current: 0 });
  });

  it("rejects duplicate metric labels with a validation error, not a false active-focus conflict", async () => {
    // Regression: this workspace has no active focus at all, so if the old
    // code path (catch-any-UNIQUE-violation) were still in place, this
    // would incorrectly surface as ConflictError("already has an active
    // focus") instead of the real problem — two metrics sharing a label.
    await makeWorkspace("ws-dup-labels");
    await expect(
      startFocus(DB(), "ws-dup-labels", {
        title: "dup metrics",
        endsAt: future(7),
        metrics: [
          { label: "Signups", target: 20 },
          { label: "Signups", target: 30 },
        ],
      }),
    ).rejects.toThrow(/duplicate metric label/);

    // And the workspace must still be free to start a focus afterward —
    // proof no row was left behind by the rejected attempt.
    expect(await getActiveFocus(DB(), "ws-dup-labels")).toBeNull();
  });

  it("a real active-focus conflict still maps to ConflictError, not a validation error", async () => {
    await makeWorkspace("ws-real-conflict");
    await startFocus(DB(), "ws-real-conflict", { title: "first", endsAt: future(7) });

    await expect(
      startFocus(DB(), "ws-real-conflict", { title: "second", endsAt: future(7) }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("setMetric", () => {
  it("creates a metric requiring a target, then updates current without needing target again", async () => {
    await makeWorkspace("ws-metric");
    const focus = await startFocus(DB(), "ws-metric", { title: "t", endsAt: future(7) });

    const created = await setMetric(DB(), focus.id, "Signups from strangers", { target: 50 }, "agent:seo");
    expect(created.target).toBe(50);
    expect(created.current).toBe(0);

    const updated = await setMetric(DB(), focus.id, "Signups from strangers", { current: 12 }, "agent:seo");
    expect(updated.current).toBe(12);
    expect(updated.target).toBe(50); // unchanged when omitted on update

    const retargeted = await setMetric(DB(), focus.id, "Signups from strangers", { target: 100 });
    expect(retargeted.target).toBe(100);
    expect(retargeted.current).toBe(12); // still unchanged
  });

  it("fails to create a metric with no target", async () => {
    await makeWorkspace("ws-metric-no-target");
    const focus = await startFocus(DB(), "ws-metric-no-target", { title: "t", endsAt: future(7) });
    await expect(setMetric(DB(), focus.id, "new metric", { current: 1 })).rejects.toThrow(/needs a target/);
  });

  it("rejects non-finite current/target — the guard REST's raw JSON body needs", async () => {
    await makeWorkspace("ws-metric-non-numeric");
    const focus = await startFocus(DB(), "ws-metric-non-numeric", { title: "t", endsAt: future(7) });

    // Simulates what a hand-typed PATCH /api/focus/:id body can send —
    // routes.ts forwards parsed JSON straight through, with no zod schema
    // in front of it the way the MCP tool has.
    await expect(
      setMetric(DB(), focus.id, "bad target", { target: "abc" as unknown as number }),
    ).rejects.toThrow(/finite number/);
    await expect(
      setMetric(DB(), focus.id, "bad target", { target: Number.NaN }),
    ).rejects.toThrow(/finite number/);
    await expect(
      setMetric(DB(), focus.id, "bad target", { target: null as unknown as number }),
    ).rejects.toThrow(/finite number/);

    await setMetric(DB(), focus.id, "ok target", { target: 10 });
    await expect(
      setMetric(DB(), focus.id, "ok target", { current: "12" as unknown as number }),
    ).rejects.toThrow(/finite number/);
  });
});

describe("focusProgress", () => {
  it("counts only labelled, non-archived tasks in the focus's workspace", async () => {
    await makeWorkspace("ws-progress");
    await makeWorkspace("ws-other");
    await makeBoard("board-progress", "ws-progress");
    await makeBoard("board-other", "ws-other");

    const focus = await startFocus(DB(), "ws-progress", { title: "t", endsAt: future(7) });
    const label = `focus:${focus.id}`;

    await makeTask("t1", "board-progress", [label], "done");
    await makeTask("t2", "board-progress", [label], "open");
    await makeTask("t3", "board-progress", ["unrelated"], "done"); // no label — excluded
    await makeTask("t4", "board-other", [label], "done"); // right label, wrong workspace — excluded

    // Archived task carrying the label must not count either.
    await DB()
      .prepare(`INSERT INTO tasks_index (id, board_id, title, status, priority, labels, updated_at, archived_at)
                VALUES (?, ?, ?, 'done', 'normal', ?, ?, ?)`)
      .bind("t5", "board-progress", "t5", JSON.stringify([label]), new Date().toISOString(), new Date().toISOString())
      .run();

    const progress = await focusProgress(DB(), "ws-progress", focus.id);
    expect(progress).toEqual({ total: 2, done: 1 });
  });
});

describe("closeFocus", () => {
  it("sets status and closed_at, and frees the workspace's active slot", async () => {
    await makeWorkspace("ws-close");
    const focus = await startFocus(DB(), "ws-close", { title: "t", endsAt: future(7) });

    const closed = await closeFocus(DB(), focus.id, "hit", "shipped it");
    expect(closed.status).toBe("hit");
    expect(closed.lesson).toBe("shipped it");
    expect(closed.closed_at).not.toBeNull();

    expect(await getActiveFocus(DB(), "ws-close")).toBeNull();

    // The slot is free again — starting a new one must succeed.
    const next = await startFocus(DB(), "ws-close", { title: "next", endsAt: future(7) });
    expect(next.status).toBe("active");
  });

  it("rejects an invalid status", async () => {
    await makeWorkspace("ws-close-bad-status");
    const focus = await startFocus(DB(), "ws-close-bad-status", { title: "t", endsAt: future(7) });
    // @ts-expect-error - intentionally invalid at the type level too
    await expect(closeFocus(DB(), focus.id, "done")).rejects.toThrow(/status must be one of/);
  });
});

describe("overdue", () => {
  it("is true once ends_at is in the past and the focus is still active", async () => {
    await makeWorkspace("ws-overdue");
    // startFocus enforces ends_at > starts_at, so backdate starts_at too.
    const row = await startFocus(DB(), "ws-overdue", {
      title: "t",
      startsAt: past(10),
      endsAt: past(1),
    });

    const wire = await toWire(DB(), row);
    expect(wire.overdue).toBe(true);
    expect(wire.days_left).toBeLessThan(0);
  });

  it("is false once the overdue focus is closed", async () => {
    await makeWorkspace("ws-overdue-closed");
    const row = await startFocus(DB(), "ws-overdue-closed", {
      title: "t",
      startsAt: past(10),
      endsAt: past(1),
    });
    const closed = await closeFocus(DB(), row.id, "missed");
    const wire = await toWire(DB(), closed);
    expect(wire.overdue).toBe(false);
  });
});
