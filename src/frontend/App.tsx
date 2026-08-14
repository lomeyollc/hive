import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/context/auth-context";
import { AppShell } from "@/components/layout/AppShell";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { LoginPage } from "@/pages/LoginPage";
import { BoardListPage } from "@/pages/BoardListPage";
import { BoardDetailPage } from "@/pages/BoardDetailPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { WorkspacePage } from "@/pages/WorkspacePage";
import { NeedsYouPage } from "@/pages/NeedsYouPage";
import { AcceptInvitePage } from "@/pages/AcceptInvitePage";
import { NotFoundPage } from "@/pages/NotFoundPage";

/**
 * Hive — root app component / router.
 *
 *   /login              - Google Sign-In screen (redirects to /boards if
 *                          already authenticated)
 *   /boards              - board list (protected)
 *   /boards/:slug         - board detail: tasks, create-task dialog, live
 *                          WebSocket updates, kanban/list view (protected)
 *   /boards/:slug/tasks/:taskId - same page, with that task's detail sheet
 *                          open. The URL is the task's stable address (Rule
 *                          38, product-rules.md) — copy-link buttons point
 *                          here, opening it directly reproduces the sheet.
 *   /needs-you           - every needs_human task across every board,
 *                          grouped by board (protected) — the nav badge's
 *                          landing page
 *   /workspace           - members list + invite dialog (protected)
 *   /invites/:token       - accept-invite landing page (PUBLIC — an invited
 *                          user has no session yet). Sign in with Google,
 *                          then auto-accepts if the signed-in email matches.
 *   /settings            - API Bearer token management (protected)
 *
 * Auth state comes from AuthProvider (src/context/auth-context.tsx), which
 * checks GET /auth/session once on mount. ProtectedRoute redirects to
 * /login when there's no session.
 */
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/invites/:token" element={<AcceptInvitePage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/boards" element={<BoardListPage />} />
            <Route path="/boards/:slug" element={<BoardDetailPage />} />
            <Route path="/boards/:slug/tasks/:taskId" element={<BoardDetailPage />} />
            <Route path="/workspace" element={<WorkspacePage />} />
            <Route path="/needs-you" element={<NeedsYouPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>

        <Route path="/" element={<Navigate to="/boards" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider>
  );
}
