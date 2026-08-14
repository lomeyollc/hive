import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { toast } from "sonner";

/**
 * Google Identity Services (GIS) "Sign in with Google" button.
 *
 * Fetches the OAuth Client ID (public, not the secret) from GET
 * /auth/config at runtime, which reads the Worker's GOOGLE_CLIENT_ID env
 * var server-side. This is deliberately NOT a frontend build-time env var
 * (e.g. VITE_GOOGLE_CLIENT_ID) — a self-hoster only has to run one
 * `wrangler secret put GOOGLE_CLIENT_ID` and the already-built static
 * assets pick it up immediately, no rebuild required. A Client ID is safe
 * to expose this way; it's the same value every Google Sign-In button on
 * the web embeds client-side.
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
  const [clientId, setClientId] = useState<string | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/auth/config")
      .then((res) => res.json() as Promise<{ googleClientId: string | null }>)
      .then((data) => {
        if (cancelled) return;
        setClientId(data.googleClientId);
        setConfigLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not reach /auth/config to load the Google Client ID.");
          setConfigLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!configLoaded) return;
    if (!clientId) {
      setError(
        "Google sign-in isn't configured yet. Set GOOGLE_CLIENT_ID with `wrangler secret put GOOGLE_CLIENT_ID` — see .dev.vars.example.",
      );
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
