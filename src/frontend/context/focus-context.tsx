import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getFocus } from "@/lib/api";
import type { Focus } from "@/lib/types";
import { useWorkspace } from "@/context/workspace-context";

interface FocusContextValue {
  active: Focus | null;
  past: Focus[];
  loading: boolean;
  error: string | null;
  /** Re-fetches `GET /api/focus` for the current workspace. Call after any
   *  start/edit/metric/close mutation so the banner and /focus page agree. */
  refresh: () => Promise<void>;
}

const FocusContext = createContext<FocusContextValue | null>(null);

/**
 * One `GET /api/focus` per workspace change (per the task-2 brief), shared
 * by FocusBanner (every page, via AppShell) and FocusPage — neither fetches
 * on its own, both call `refresh()` after a mutation.
 */
export function FocusProvider({ children }: { children: ReactNode }) {
  const { current } = useWorkspace();
  const [active, setActive] = useState<Focus | null>(null);
  const [past, setPast] = useState<Focus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workspaceId = current?.id ?? null;

  // Guards against a fast workspace switch: if a slower response for an
  // earlier workspace/request lands after a newer one was already applied
  // (or the workspace changed again), it is dropped rather than overwriting
  // the current workspace's Focus.
  const requestIdRef = useRef(0);
  const workspaceIdRef = useRef(workspaceId);
  workspaceIdRef.current = workspaceId;

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    const requestWorkspaceId = workspaceId;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const data = await getFocus(requestWorkspaceId);
      if (requestId !== requestIdRef.current || workspaceIdRef.current !== requestWorkspaceId) {
        return;
      }
      setActive(data.active);
      setPast(data.past);
      setError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current || workspaceIdRef.current !== requestWorkspaceId) {
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load Focus");
    } finally {
      if (requestId === requestIdRef.current && workspaceIdRef.current === requestWorkspaceId) {
        setLoading(false);
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      requestIdRef.current++;
      setActive(null);
      setPast([]);
      return;
    }
    void refresh();
  }, [workspaceId, refresh]);

  // Banner freshness: agent-pushed metric numbers and days_left otherwise
  // only refresh on a workspace change or a local mutation. Poll while the
  // tab is visible, and refetch immediately whenever it becomes visible or
  // the window regains focus.
  useEffect(() => {
    if (!workspaceId) return;
    function onVisibilityOrFocus() {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }
    window.addEventListener("focus", onVisibilityOrFocus);
    document.addEventListener("visibilitychange", onVisibilityOrFocus);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }, 60_000);
    return () => {
      window.removeEventListener("focus", onVisibilityOrFocus);
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
      window.clearInterval(interval);
    };
  }, [workspaceId, refresh]);

  return (
    <FocusContext.Provider value={{ active, past, loading, error, refresh }}>{children}</FocusContext.Provider>
  );
}

export function useFocus(): FocusContextValue {
  const ctx = useContext(FocusContext);
  if (!ctx) {
    throw new Error("useFocus must be used within FocusProvider");
  }
  return ctx;
}
