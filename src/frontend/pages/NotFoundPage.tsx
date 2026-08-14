import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">That page doesn't exist.</p>
      <Button asChild size="sm">
        <Link to="/boards">Back to boards</Link>
      </Button>
    </div>
  );
}
