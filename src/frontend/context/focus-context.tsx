import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
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

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const data = await getFocus(workspaceId);
      setActive(data.active);
      setPast(data.past);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Focus");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      setActive(null);
      setPast([]);
      return;
    }
    void refresh();
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
