import { useState } from "react";
import { Link2, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Rule 38 (product-rules.md): every task/board detail view has a visible
 * copy-link affordance next to its title. `path` is the app-relative path
 * (e.g. `/boards/engineering/tasks/abc-123`) — resolved against
 * window.location.origin so it always copies a full, shareable URL.
 */
export function CopyLinkButton({ path, className }: { path: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — copy from the address bar instead");
    }
  }

  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      onClick={handleCopy}
      className={cn("shrink-0 text-muted-foreground", className)}
      title="Copy link"
    >
      {copied ? <Check className="size-3.5" /> : <Link2 className="size-3.5" />}
    </Button>
  );
}
