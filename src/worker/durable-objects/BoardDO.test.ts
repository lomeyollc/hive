import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { BoardDO } from "./BoardDO";

/**
 * These run against a real BoardDO inside workerd — real DO SQLite, real
 * migrations, the same `updateTask` production calls. The D1 index sync inside
 * `#afterWrite` is fire-and-forget with a `.catch`, so tests do not need D1
 * migrations applied for these assertions to be meaningful.
 */
async function withBoard<T>(name: string, fn: (board: BoardDO) => T | Promise<T>): Promise<T> {
  const stub = env.BOARD_DO.get(env.BOARD_DO.idFromName(name));
  return runInDurableObject(stub, (instance: BoardDO) => fn(instance));
}

describe("needs_human is cleared by the events that resolve it", () => {
  // Regression for the 2026-08-17 incident: archived and done tasks kept
  // paging Zakir because the flag was stored independently of archived_at and
  // status. See context/hive/incidents.md and production lesson 24.

  it("clears the flag when a task is archived", async () => {
    await withBoard("archive-clears", (board) => {
      const task = board.createTask({
        title: "flagged then archived",
        needsHuman: true,
        needsHumanReason: "stuck on something",
      });
      expect(task.needsHuman).toBe(true);

      const archived = board.updateTask(task.id, { archivedAt: new Date().toISOString() });

      expect(archived.needsHuman).toBe(false);
      expect(archived.needsHumanReason).toBeNull();
      expect(archived.archivedAt).not.toBeNull();
    });
  });

  it("clears the flag when a task moves to a done-role column", async () => {
    await withBoard("done-clears", (board) => {
      const task = board.createTask({
        title: "flagged then completed",
        needsHuman: true,
        needsHumanReason: "needs a decision",
      });

      const done = board.updateTask(task.id, { status: "done" });

      expect(done.needsHuman).toBe(false);
      expect(done.needsHumanReason).toBeNull();
      expect(done.status).toBe("done");
    });
  });

  it("leaves the flag alone on an ordinary edit", async () => {
    // The fix must not over-clear: a task that is still open and still stuck
    // has to keep paging, otherwise the escalation loop silently dies the
    // other way.
    await withBoard("edit-preserves", (board) => {
      const task = board.createTask({
        title: "still stuck",
        needsHuman: true,
        needsHumanReason: "waiting on Zakir",
      });

      const edited = board.updateTask(task.id, { title: "still stuck (renamed)" });

      expect(edited.needsHuman).toBe(true);
      expect(edited.needsHumanReason).toBe("waiting on Zakir");
    });
  });

  it("does not resurrect the flag by flagging an already-archived task", async () => {
    await withBoard("archived-stays-quiet", (board) => {
      const task = board.createTask({ title: "buried" });
      board.updateTask(task.id, { archivedAt: new Date().toISOString() });

      const reflagged = board.updateTask(task.id, {
        needsHuman: true,
        needsHumanReason: "an agent tried again",
      });

      // Archiving is the founder's "never again" — an agent re-flagging a
      // buried task must not put it back in the digest.
      expect(reflagged.needsHuman).toBe(false);
    });
  });

  it("keeps an archived task out of the flagged set entirely", async () => {
    // Belt and braces on top of the flag clearing: even if a stale row
    // survived, listTasks hides archived rows by default, so nothing that
    // reads the default list can page on buried work.
    await withBoard("flagged-list", (board) => {
      const stuck = board.createTask({ title: "genuinely stuck", needsHuman: true });
      const buried = board.createTask({ title: "archived but was flagged", needsHuman: true });
      board.updateTask(buried.id, { archivedAt: new Date().toISOString() });

      const flagged = board.listTasks().filter((t) => t.needsHuman);

      expect(flagged.map((t) => t.id)).toEqual([stuck.id]);
    });
  });
});

describe("claimNextTask is race-free", () => {
  // The concurrency guarantee was proven once by hand during the original
  // build and never pinned. A DO is single-threaded, so two concurrent claims
  // must hand back two different tasks — never the same one twice.

  it("never hands the same task to two claimants", async () => {
    await withBoard("claim-race", (board) => {
      board.createTask({ title: "task A" });
      board.createTask({ title: "task B" });

      const first = board.claimNextTask({}, "agent-1");
      const second = board.claimNextTask({}, "agent-2");
      const third = board.claimNextTask({}, "agent-3");

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(first!.id).not.toBe(second!.id);
      expect(first!.claimedBy).toBe("agent-1");
      expect(second!.claimedBy).toBe("agent-2");
      // Only two tasks existed, so the third claimant gets nothing rather
      // than a re-issued task.
      expect(third).toBeNull();
    });
  });

  it("never claims an archived task", async () => {
    await withBoard("claim-skips-archived", (board) => {
      const buried = board.createTask({ title: "archived work" });
      board.updateTask(buried.id, { archivedAt: new Date().toISOString() });

      expect(board.claimNextTask({}, "agent-1")).toBeNull();
    });
  });
});
