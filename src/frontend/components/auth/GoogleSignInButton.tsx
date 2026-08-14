import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { toast } from "sonner";

/**
 * Google Identity Services (GIS) "Sign in with Google" button.
 *
 * Needs the OAuth Client ID (public, not the secret) available to the
 * frontend build as `VITE_GOOGLE_CLIENT_ID` — this is a Vite env var, not
 * the `GOOGLE_CLIENT_ID` Worker secret (that one only exists server-side,
 * for verifying the token). Set it in `.dev.vars`/`.env.local` for `vite
 * dev`, or as a build-time env var for `vite build`/deploy.
 *
 * TODO(integration): confirm the exact field name the /auth/google/callback
 * route expects — GIS's callback gives us `credential`, and lib/api.ts's
 * signInWithGoogle() currently posts `{ credential }`.
 */
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
          prompt: () => void;
        };
      };
    };
  }
}

const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_SRC}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Identity Services")));
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(script);
  });
}

export function GoogleSignInButton() {
  const { signInWithGoogle } = useAuth();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

  useEffect(() => {
    if (!clientId) {
      setError("VITE_GOOGLE_CLIENT_ID is not set — see .dev.vars.example.");
      return;
    }
    let cancelled = false;

    loadGisScript()
      .then(() => {
        if (cancelled || !window.google || !buttonRef.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            signInWithGoogle(response.credential).catch((err: unknown) => {
              const message = err instanceof Error ? err.message : "Sign-in failed";
              toast.error(message);
            });
          },
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: "outline",
          size: "large",
          shape: "pill",
          width: 280,
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Google Sign-In");
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, signInWithGoogle]);

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  return <div ref={buttonRef} className="flex justify-center" />;
}
