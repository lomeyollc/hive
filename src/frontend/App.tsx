/**
 * Hive — root app component.
 *
 * This is a scaffold. The next-phase agent wires up:
 *   - A router (board list / board detail / settings / sign-in views)
 *   - Google Identity Services "Sign in with Google" button + session check
 *   - Board detail: task list, create-task form, comments, live WebSocket
 *     updates from the board's BoardDO
 *   - Settings: generate/revoke API Bearer tokens for agents + MCP
 *
 * shadcn/ui components live in ./components/ui (added via `npx shadcn add`).
 */
export default function App() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Hive</h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          AI-agent-native task board — under construction.
        </p>
      </div>
    </main>
  );
}
