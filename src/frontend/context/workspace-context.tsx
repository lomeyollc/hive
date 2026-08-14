import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { listWorkspaces as apiListWorkspaces } from "@/lib/api";
import type { Workspace } from "@/lib/types";

const STORAGE_KEY = "hive:workspace-id";

interface WorkspaceContextValue {
  workspaces: Workspace[] | null;
  /** The active workspace — persisted in localStorage so a switch survives reload. */
  current: Workspace | null;
  setCurrentId: (id: string) => void;
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [currentId, setCurrentIdState] = useState<string | null>(() =>
    typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null,
  );

  const refresh = useCallback(async () => {
    const data = await apiListWorkspaces();
    setWorkspaces(data);
    // If there's no valid current selection yet, default to the first workspace.
    setCurrentIdState((prev) => {
      if (prev && data.some((w) => w.id === prev)) return prev;
      return data[0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    refresh().catch(() => {
      // Swallow — pages that need workspaces already handle their own loading/error UI.
    });
  }, [refresh]);

  const setCurrentId = useCallback((id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    setCurrentIdState(id);
  }, []);

  const current = workspaces?.find((w) => w.id === currentId) ?? workspaces?.[0] ?? null;

  return (
    <WorkspaceContext.Provider value={{ workspaces, current, setCurrentId, refresh }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return ctx;
}
