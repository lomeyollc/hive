import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { acceptInvite, getInvite } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { HiveLogo } from "@/components/icons/HiveLogo";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/use-document-title";

/**
 * PUBLIC route (/invites/:token, outside ProtectedRoute in App.tsx) — an
 * invited user has no session yet. Flow: look up the invite (public GET),
 * show who it's for; once signed in as that exact email, accept it and
 * head to /boards. If signed in as a different email, offer to switch.
 */
export function AcceptInvitePage() {
  useDocumentTitle("Accept invite");
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();

  const [invite, setInvite] = useState<{ email: string; status: string; workspace_name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!token) return;
    getInvite(token)
      .then(setInvite)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Invite not found"));
  }, [token]);

  useEffect(() => {
    if (!token || !invite || authLoading || !user) return;
    if (user.email !== invite.email) return; // wrong account — show the mismatch UI instead
    setAccepting(true);
    acceptInvite(token)
      .then(() => {
        toast.success(`Joined ${invite.workspace_name}`);
        navigate("/boards");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to accept invite");
        setAccepting(false);
      });
  }, [token, invite, user, authLoading, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-neutral-950 text-white">
            <HiveLogo className="size-5" />
          </div>
          <CardTitle className="text-xl">
            {error ? "Invite not valid" : invite ? `Join ${invite.workspace_name}` : "Loading invite…"}
          </CardTitle>
          {invite && !error && <CardDescription>Invited as {invite.email}</CardDescription>}
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 pb-8">
          {error && <p className="text-center text-sm text-destructive">{error}</p>}

          {invite && !error && invite.status === "active" && (
            <p className="text-sm text-muted-foreground">This invite has already been accepted.</p>
          )}

          {invite && !error && invite.status === "invited" && !authLoading && !user && (
            <GoogleSignInButton />
          )}

          {invite && !error && invite.status === "invited" && user && user.email !== invite.email && (
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-sm text-muted-foreground">
                Signed in as {user.email} — this invite is for {invite.email}.
              </p>
              <Button size="sm" variant="outline" onClick={() => void signOut()}>
                Sign out and use {invite.email}
              </Button>
            </div>
          )}

          {accepting && <p className="text-sm text-muted-foreground">Joining…</p>}
        </CardContent>
      </Card>
    </div>
  );
}
