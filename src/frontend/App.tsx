import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/context/auth-context";
import { AppShell } from "@/components/layout/AppShell";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { LoginPage } from "@/pages/LoginPage";
import { BoardListPage } from "@/pages/BoardListPage";
import { BoardDetailPage } from "@/pages/BoardDetailPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

/**
 * Hive — root app component / router.
 *
 *   /login              - Google Sign-In screen (redirects to /boards if
 *                          already authenticated)
 *   /boards              - board list (protected)
 *   /boards/:slug         - board detail: tasks, create-task dialog, live
 *                          WebSocket updates, task detail panel (protected)
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

        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/boards" element={<BoardListPage />} />
            <Route path="/boards/:slug" element={<BoardDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>

        <Route path="/" element={<Navigate to="/boards" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider>
  );
}
