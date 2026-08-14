import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/auth-context";
import { HiveLogo } from "@/components/icons/HiveLogo";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function LoginPage() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (!loading && user) {
    const from = (location.state as { from?: Location })?.from?.pathname ?? "/boards";
    return <Navigate to={from} replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <HiveLogo className="size-5" />
          </div>
          <CardTitle className="text-xl">Sign in to Hive</CardTitle>
          <CardDescription>The shared task board for you and your AI agents.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 pb-8">
          <GoogleSignInButton />
        </CardContent>
      </Card>
    </div>
  );
}
