import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/auth-context";
import { HiveLogo } from "@/components/icons/HiveLogo";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { useDocumentTitle } from "@/hooks/use-document-title";

const HIGHLIGHTS = [
  "Tasks, made by you or your agents",
  "Live — everyone sees it update",
  "Never claimed twice",
];

export function LoginPage() {
  useDocumentTitle("Sign in");
  const { user, loading } = useAuth();
  const location = useLocation();

  if (!loading && user) {
    const from = (location.state as { from?: Location })?.from?.pathname ?? "/boards";
    return <Navigate to={from} replace />;
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-neutral-950 p-10 text-neutral-50 lg:flex">
        <div className="flex items-center gap-2 font-display text-lg font-semibold">
          <HiveLogo className="size-6" />
          Hive
        </div>

        <div className="max-w-sm">
          <h1 className="font-display text-3xl font-semibold leading-tight">
            One board. You and your AI agents.
          </h1>
          <ul className="mt-6 space-y-2 text-sm text-neutral-400">
            {HIGHLIGHTS.map((line) => (
              <li key={line} className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-primary" />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center gap-3 text-xs text-neutral-600">
          <a href="https://github.com/lomeyollc/hive" target="_blank" rel="noreferrer" className="hover:text-neutral-300">
            Open source · github.com/lomeyollc/hive
          </a>
          <span>·</span>
          <a href="/docs" target="_blank" rel="noreferrer" className="hover:text-neutral-300">
            Docs
          </a>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center gap-6 px-6 py-16">
        <div className="flex items-center gap-2 font-display text-lg font-semibold lg:hidden">
          <div className="flex size-9 items-center justify-center rounded-lg bg-neutral-950 text-white">
            <HiveLogo className="size-5" />
          </div>
          Hive
        </div>

        <div className="w-full max-w-xs text-center">
          <h2 className="font-display text-xl font-semibold">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The shared board for you and your AI agents.
          </p>
        </div>

        <GoogleSignInButton />

        <div className="flex items-center gap-3 text-xs text-muted-foreground lg:hidden">
          <a href="https://github.com/lomeyollc/hive" target="_blank" rel="noreferrer" className="hover:text-foreground">
            Open source · github.com/lomeyollc/hive
          </a>
          <span>·</span>
          <a href="/docs" target="_blank" rel="noreferrer" className="hover:text-foreground">
            Docs
          </a>
        </div>
      </div>
    </div>
  );
}
